import csv
import io
import shutil
import tempfile
from decimal import Decimal

from django.core.cache import cache
from django.db.models import Count, Q
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from common.models import ImportJob
from schools.models import School

from .models import Product, ProductVariant, SizeChartRow
from .size_chart_import import TEMPLATE_COLUMNS, validate_import

URL = "/api/size-chart-imports/"
SHIRT = ["DPS-SHIRT-28", "DPS-SHIRT-30", "DPS-SHIRT-32", "DPS-SHIRT-34"]


def login(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(user)['access']}")
    return client


def chart_row(sku, h_min, h_max, w_min="", w_max="", name="", size=""):
    return [sku, name, size, h_min, h_max, w_min, w_max, "", "", "", "", ""]


def shirt_rows(start=116):
    """A full, valid chart for the DPS shirt (4 sizes)."""
    return [chart_row(sku, start + i * 12, start + i * 12 + 11, 18 + i * 8, 26 + i * 8) for i, sku in enumerate(SHIRT)]


def csv_file(rows, columns=None):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(columns or TEMPLATE_COLUMNS)
    writer.writerows(rows)
    return SimpleUploadedFile("chart.csv", buffer.getvalue().encode("utf-8"), content_type="text/csv")


class SizeChartImportTestBase(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media_root = tempfile.mkdtemp(prefix="school-store-sizechart-")
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()

    @classmethod
    def tearDownClass(cls):
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)
        super().tearDownClass()

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.dps = School.objects.get(code="DPS-SUR")
        cls.fhs = School.objects.get(code="FHS-SUR")
        cls.boss = User.objects.get(username="boss")
        cls.school_admin = User.objects.get(username="school_admin_dps")
        cls.shirt = ProductVariant.objects.get(sku="DPS-SHIRT-28").product
        # Any second DPS product that comes in several sizes, with all of its
        # active SKUs (the seed's catalogue changes, so no SKU is named here).
        second = (
            Product.objects.filter(school=cls.dps)
            .exclude(pk=cls.shirt.pk)
            .annotate(sizes=Count("variants", filter=Q(variants__active=True)))
            .filter(sizes__gte=2)
            .order_by("name")
            .first()
        )
        cls.second_skus = list(
            second.variants.filter(active=True).order_by("sku").values_list("sku", flat=True)
        )

    def second_rows(self):
        """A full, valid chart for the second product, whatever its sizes are."""
        return [chart_row(sku, 100 + i * 10, 109 + i * 10) for i, sku in enumerate(self.second_skus)]

    def setUp(self):
        cache.clear()
        self.client = login(self.school_admin)

    def upload(self, rows, client=None, school=None, columns=None):
        url = URL + (f"?school={school}" if school else "")
        res = (client or self.client).post(url, {"file": csv_file(rows, columns)}, format="multipart")
        self.assertEqual(res.status_code, 202, res.data)
        return ImportJob.objects.get(pk=res.data["id"])

    def confirm(self, job, client=None):
        return (client or self.client).post(f"{URL}{job.id}/confirm/")


class TemplateTests(SizeChartImportTestBase):
    def test_template_lists_the_schools_skus_with_empty_measurements(self):
        res = self.client.get(URL + "template/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("size-chart-DPS-SUR.csv", res["Content-Disposition"])
        rows = list(csv.reader(io.StringIO(res.content.decode("utf-8"))))
        self.assertEqual(rows[0], TEMPLATE_COLUMNS)
        by_sku = {r[0]: r for r in rows[1:]}
        self.assertEqual(by_sku["DPS-SHIRT-30"][1:3], [self.shirt.name, "30 (Class 4-6)"])
        self.assertTrue(all(cell == "" for cell in by_sku["DPS-SHIRT-30"][3:]))
        # Only this school's products, and only ones that come in several sizes.
        self.assertNotIn("FHS-POLO-S", by_sku)
        for sku in by_sku:
            variant = ProductVariant.objects.get(sku=sku)
            self.assertEqual(variant.product.school_id, self.dps.id)
            self.assertGreater(variant.product.variants.filter(active=True).count(), 1)

    def test_filled_in_template_imports(self):
        res = self.client.get(URL + "template/")
        rows = list(csv.reader(io.StringIO(res.content.decode("utf-8"))))[1:]
        values = {r[0]: r for r in shirt_rows()}
        filled = [r[:3] + values[r[0]][3:] if r[0] in values else r for r in rows]
        job = self.upload(filled)
        self.assertEqual(job.preview["summary"]["products_accepted"], 1)
        self.assertEqual(job.preview["summary"]["adds"], 4)
        self.assertEqual(job.preview["rejected"], [])

    def test_formula_like_names_are_neutralised(self):
        self.shirt.name = "=HYPERLINK(1)"
        self.shirt.save()
        res = self.client.get(URL + "template/")
        self.assertIn("'=HYPERLINK(1)", res.content.decode("utf-8"))
        # ...and the guarded name still matches on the way back in.
        job = self.upload([r[:1] + ["'=HYPERLINK(1)"] + r[2:] for r in shirt_rows()])
        self.assertEqual(job.preview["summary"]["products_accepted"], 1)


class DryRunAndCommitTests(SizeChartImportTestBase):
    def test_nothing_is_written_until_confirm(self):
        job = self.upload(shirt_rows())
        self.assertEqual(job.status, ImportJob.Status.PREVIEW_READY)
        self.assertEqual(job.preview["products"][0]["adds"], 4)
        self.assertEqual(SizeChartRow.objects.count(), 0)

        res = self.confirm(job)
        self.assertEqual(res.status_code, 202, res.data)
        job.refresh_from_db()
        self.assertEqual(job.status, ImportJob.Status.COMPLETED)
        self.assertEqual(job.result["rows_written"], 4)
        row = SizeChartRow.objects.get(variant__sku="DPS-SHIRT-30")
        self.assertEqual((row.height_cm_min, row.height_cm_max), (Decimal("128.0"), Decimal("139.0")))

    def test_reimport_counts_adds_replaces_unchanged_and_deletes(self):
        self.confirm(self.upload(shirt_rows()))
        # Switch one size off: its row is no longer required, and is deleted.
        ProductVariant.objects.filter(sku="DPS-SHIRT-34").update(active=False)
        rows = shirt_rows()[:3]
        rows[0] = chart_row("DPS-SHIRT-28", 110, 127, 18, 26)  # changed
        job = self.upload(rows)
        product = job.preview["products"][0]
        self.assertEqual(
            (product["adds"], product["replaces"], product["unchanged"], product["deletes"]),
            (0, 1, 2, ["DPS-SHIRT-34"]),
        )
        self.confirm(job)
        self.assertEqual(
            sorted(SizeChartRow.objects.values_list("variant__sku", flat=True)), SHIRT[:3]
        )

    def test_products_not_in_the_file_keep_their_chart(self):
        self.confirm(self.upload(shirt_rows()))
        self.confirm(self.upload(self.second_rows()))
        self.assertEqual(SizeChartRow.objects.filter(variant__sku__in=SHIRT).count(), 4)
        self.assertEqual(SizeChartRow.objects.filter(variant__sku__in=self.second_skus).count(), len(self.second_skus))

    def test_whole_file_is_checked_with_a_fixed_number_of_queries(self):
        job = self.upload(shirt_rows())
        job.status = ImportJob.Status.PENDING
        job.save(update_fields=["status"])
        with CaptureQueriesContext(connection) as small:
            validate_import(job)
        job = self.upload(shirt_rows() + self.second_rows())
        job.status = ImportJob.Status.PENDING
        job.save(update_fields=["status"])
        with CaptureQueriesContext(connection) as large:
            validate_import(job)
        self.assertEqual(len(small.captured_queries), len(large.captured_queries))


class RejectionTests(SizeChartImportTestBase):
    def test_partial_product_is_rejected_and_lists_missing_skus(self):
        rows = shirt_rows()[:2] + self.second_rows()
        job = self.upload(rows)
        rejected = job.preview["rejected"]
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0]["product_name"], self.shirt.name)
        self.assertEqual(rejected[0]["missing_skus"], ["DPS-SHIRT-32", "DPS-SHIRT-34"])
        self.assertEqual(job.preview["summary"]["products_accepted"], 1)

        self.confirm(job)
        self.assertEqual(SizeChartRow.objects.filter(variant__sku__in=SHIRT).count(), 0)
        self.assertEqual(SizeChartRow.objects.filter(variant__sku__in=self.second_skus).count(), len(self.second_skus))

        report = self.client.get(f"{URL}{job.id}/report/").content.decode("utf-8")
        self.assertIn("DPS-SHIRT-32", report)
        self.assertIn("Missing from the file", report)

    def test_blank_template_rows_do_not_put_a_product_in_the_file(self):
        rows = [chart_row(sku, "", "") for sku in SHIRT] + [
            *self.second_rows()
        ]
        job = self.upload(rows)
        self.assertEqual(job.preview["rejected"], [])
        self.assertEqual(job.preview["summary"]["products_accepted"], 1)

    def test_row_errors_reject_the_product(self):
        cases = {
            "min above max": chart_row("DPS-SHIRT-30", 140, 128),
            "missing height": chart_row("DPS-SHIRT-30", "", "", 20, 30),
            "not a number": chart_row("DPS-SHIRT-30", "abc", 140),
            "out of range": chart_row("DPS-SHIRT-30", 128, 900),
            "wrong size": chart_row("DPS-SHIRT-30", 128, 139, size="32"),
            "wrong product": chart_row("DPS-SHIRT-30", 128, 139, name="Some Other Shirt"),
        }
        for label, bad in cases.items():
            with self.subTest(label):
                rows = shirt_rows()
                rows[1] = bad
                job = self.upload(rows)
                self.assertEqual(job.preview["summary"]["products_accepted"], 0, label)
                self.assertEqual(len(job.preview["rejected"]), 1, label)
                self.assertTrue(job.preview["rejected"][0]["row_errors"], label)
                self.assertEqual(self.confirm(job).status_code, 400, label)

    def test_duplicate_sku_rejects_the_product(self):
        job = self.upload(shirt_rows() + [chart_row("DPS-SHIRT-28", 100, 110)])
        self.assertEqual(job.duplicate_count, 1)
        self.assertEqual(job.preview["summary"]["products_accepted"], 0)

    def test_unknown_and_other_school_skus_are_reported_without_blocking(self):
        job = self.upload(shirt_rows() + [chart_row("NOPE-1", 100, 110), chart_row("FHS-POLO-S", 100, 110)])
        errors = {e["sku"]: e["errors"]["sku"] for e in job.preview["errors"]}
        self.assertEqual(errors["NOPE-1"], "No product has this SKU.")
        self.assertEqual(errors["FHS-POLO-S"], "This SKU is not in your catalogue.")
        self.assertEqual(job.preview["summary"]["products_accepted"], 1)

    def test_sku_case_and_header_spellings_are_tolerated(self):
        columns = ["SKU", "Product Name", "Size", "Height min (cm)", "Height max (cm)",
                   "Weight min (kg)", "Weight max (kg)", "Shoulder min", "Shoulder max",
                   "Chest min", "Chest max", "Length"]
        rows = [[r[0].lower(), *r[1:]] for r in shirt_rows()]
        job = self.upload(rows, columns=columns)
        self.assertEqual(job.preview["summary"]["products_accepted"], 1)

    def test_file_without_required_columns_fails(self):
        job = self.upload([["DPS-SHIRT-28", 100]], columns=["sku", "height_cm_min"])
        self.assertEqual(job.status, ImportJob.Status.FAILED)
        self.assertIn("height_cm_max", job.error_message)


class CatalogueChangeTests(SizeChartImportTestBase):
    def test_new_size_after_preview_stops_the_whole_write(self):
        self.confirm(self.upload(shirt_rows()))
        before = list(SizeChartRow.objects.order_by("variant__sku").values_list("variant__sku", "height_cm_min"))

        rows = shirt_rows(start=100) + self.second_rows()
        job = self.upload(rows)
        self.assertEqual(job.preview["summary"]["products_accepted"], 2)
        ProductVariant.objects.create(product=self.shirt, size="36 (Class 12)", sku="DPS-SHIRT-36")

        self.confirm(job)
        job.refresh_from_db()
        self.assertEqual(job.status, ImportJob.Status.FAILED)
        self.assertIn("catalogue changed", job.error_message)
        # One transaction: the pinafore was not written either, the shirt is untouched.
        after = list(SizeChartRow.objects.order_by("variant__sku").values_list("variant__sku", "height_cm_min"))
        self.assertEqual(before, after)

    def test_confirming_twice_is_refused(self):
        job = self.upload(shirt_rows())
        self.confirm(job)
        self.assertEqual(self.confirm(job).status_code, 400)


class ScopeTests(SizeChartImportTestBase):
    def test_school_admin_cannot_pick_another_school(self):
        res = self.client.get(URL + f"template/?school={self.fhs.id}")
        self.assertEqual(res.status_code, 403)
        res = self.client.post(URL + f"?school={self.fhs.id}", {"file": csv_file(shirt_rows())}, format="multipart")
        self.assertEqual(res.status_code, 403)

    def test_school_admin_only_sees_own_jobs(self):
        boss = login(self.boss)
        other = self.upload([chart_row("FHS-POLO-S", 100, 110)], client=boss, school=self.fhs.id)
        own = self.upload(shirt_rows())
        ids = {job["id"] for job in self.client.get(URL).data["results"]}
        self.assertEqual(ids, {str(own.id)})
        self.assertEqual(self.client.get(f"{URL}{other.id}/").status_code, 404)

    def test_teachers_and_parents_are_refused(self):
        for username in ("teacher_dps", "parent_rahul", "admin_surat"):
            with self.subTest(username):
                res = login(User.objects.get(username=username)).get(URL + "template/")
                self.assertEqual(res.status_code, 403)

    def test_boss_must_choose_a_scope(self):
        boss = login(self.boss)
        self.assertEqual(boss.get(URL + "template/").status_code, 400)
        self.assertEqual(boss.get(URL + "template/?school=not-a-uuid").status_code, 400)

    def test_boss_can_chart_generic_products(self):
        boss = login(self.boss)
        product = (
            Product.objects.filter(school__isnull=True, variants__active=True)
            .distinct()
            .order_by("name")
            .first()
        )
        skus = list(product.variants.filter(active=True).values_list("sku", flat=True))
        rows = [chart_row(sku, 100 + i * 10, 109 + i * 10) for i, sku in enumerate(skus)]
        template = boss.get(URL + "template/?school=generic").content.decode("utf-8")
        if len(skus) > 1:
            self.assertIn(skus[0], template)
        self.assertNotIn("DPS-SHIRT-28", template)

        job = self.upload(rows, client=boss, school="generic")
        self.assertIsNone(job.school_id)
        self.assertEqual(job.preview["summary"]["products_accepted"], 1)
        # A school admin can't chart a product shared by every school.
        job = self.upload(rows)
        self.assertEqual(job.preview["summary"]["products_accepted"], 0)
