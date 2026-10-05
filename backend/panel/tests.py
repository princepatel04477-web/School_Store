"""
School Admin panel tests.

Each test maps to one of the eight panel requirements:
  1  dashboard totals come from the rollup tables, not from scanning orders
  2  orders table: filters + 50-row server-side pagination, no COUNT(*)
  3  per-student view: units + order count for one child
  4  Excel export runs as a background job and is never built in the request
  5  student management: view / add / edit / bulk import / approve
  6  teacher accounts: create + deactivate
  7  commission reads `School.commission_rate` and says "not set" when empty
  8  no COUNT(*) over large filtered sets: cursor pagination + rollup counts
"""

import csv
import io
import shutil
import tempfile
import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from analytics.models import DailySalesSummary, DailySchoolTotal
from analytics.services import refresh_sales_summary
from catalog.models import Category, ProductVariant
from common.models import ImportJob
from orders.models import Order, OrderItem
from schools.models import School, Student

from .models import ExportJob
from .tasks import build_export


def login(user):
    from rest_framework.test import APIClient

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(user)['access']}")
    return client


def csv_upload(rows, columns=None):
    columns = columns or ["name", "gr_number", "class", "section", "gender", "date_of_birth"]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(columns)
    for row in rows:
        writer.writerow(row)
    return SimpleUploadedFile("students.csv", buffer.getvalue().encode("utf-8"), content_type="text/csv")


class PanelTestBase(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media_root = tempfile.mkdtemp(prefix="school-store-panel-tests-")
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
        cls.school = School.objects.get(code="DPS-SUR")
        cls.other_school = School.objects.get(code="FHS-SUR")
        cls.admin = User.objects.get(username="school_admin_dps")
        cls.other_admin = User.objects.get(username="parent_priya")
        cls.parent = User.objects.get(username="parent_rahul")
        cls.teacher = User.objects.get(username="teacher_dps")
        cls.category = Category.objects.first()

        # Start from a clean sales slate: the panel assertions below count
        # only the orders each test creates.
        Order.objects.all().delete()
        DailySalesSummary.objects.all().delete()
        DailySchoolTotal.objects.all().delete()

        cls.student = Student.objects.filter(school=cls.school, approval_status="APPROVED").first()
        cls.variant = (
            ProductVariant.objects.select_related("product")
            .filter(product__category=cls.category)
            .first()
        )

    # -- helpers --------------------------------------------------------- #
    def make_order(self, *, student=None, variant=None, quantity=2, days_ago=1,
                   placed_by=None, role="PARENT", status=Order.Status.CONFIRMED):
        student = student or self.student
        variant = variant or self.variant
        placed_by = placed_by or (self.teacher if role == "TEACHER" else self.parent)
        created = timezone.now() - timedelta(days=days_ago)
        stamp = uuid.uuid4().hex[:12]
        order = Order.objects.create(
            order_number=f"ORD-T-{stamp}",
            idempotency_key=f"key-{stamp}",
            placed_by=placed_by,
            placed_by_role=role,
            payer=placed_by,
            student=student,
            parent_id=student.parent_id,
            school_id=student.school_id,
            city_id=student.city_id,
            status=status,
            payment_status=Order.PaymentStatus.PAID,
            subtotal=Decimal("100.00"),
            total=Decimal("100.00"),
            created_at=created,
        )
        OrderItem.objects.create(
            order=order,
            variant=variant,
            category_id=variant.product.category_id,
            quantity=quantity,
            unit_price_snapshot=Decimal("50.00"),
            unit_cost_snapshot=Decimal("30.00"),
        )
        Order.objects.filter(pk=order.pk).update(created_at=created)
        return order

    def rollup(self):
        refresh_sales_summary(None)


# --------------------------------------------------------------------------- #
# Requirement 1 + 7: dashboard & commission
# --------------------------------------------------------------------------- #
class DashboardTests(PanelTestBase):
    def test_dashboard_totals_come_from_the_rollup_not_the_orders_table(self):
        self.make_order(quantity=2, days_ago=1)
        self.make_order(quantity=3, days_ago=2, role="TEACHER")
        self.rollup()

        client = login(self.admin)
        today = timezone.localdate()
        response = client.get(
            "/api/panel/dashboard/",
            {"date_from": (today - timedelta(days=7)).isoformat(), "date_to": today.isoformat()},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["totals"]["orders"], 2)
        self.assertEqual(payload["totals"]["units"], 5)
        self.assertEqual(Decimal(payload["totals"]["gross_sales"]), Decimal("250.00"))

    def test_dashboard_reflects_the_summary_rows_even_when_orders_disagree(self):
        """
        Proves the panel never scans orders: change only the rollup and the
        dashboard follows, while the orders table is untouched.
        """
        self.make_order(quantity=1, days_ago=0)
        self.rollup()
        DailySchoolTotal.objects.update(units=4242, orders=17, revenue=Decimal("99999.00"))

        today = timezone.localdate()
        payload = login(self.admin).get(
            "/api/panel/dashboard/",
            {"date_from": today.isoformat(), "date_to": today.isoformat()},
        ).json()
        self.assertEqual(payload["totals"]["units"], 4242)
        self.assertEqual(payload["totals"]["orders"], 17)
        # The orders table was never touched - only the rollup changed.
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(
            sum(item.quantity for item in OrderItem.objects.all()), 1
        )

    def test_school_day_total_is_not_the_sum_of_category_orders(self):
        """
        One order spanning two categories must be counted once in the school
        total and once per category - the reason DailySchoolTotal exists.
        """
        other_variant = (
            ProductVariant.objects.select_related("product")
            .exclude(product__category=self.category)
            .first()
        )
        order = self.make_order(quantity=1, days_ago=0)
        OrderItem.objects.create(
            order=order,
            variant=other_variant,
            category_id=other_variant.product.category_id,
            quantity=1,
            unit_price_snapshot=Decimal("50.00"),
            unit_cost_snapshot=Decimal("30.00"),
        )
        self.rollup()

        today = timezone.localdate()
        total = DailySchoolTotal.objects.get(school=self.school, date=today)
        category_orders = sum(
            row.orders for row in DailySalesSummary.objects.filter(school=self.school, date=today)
        )
        self.assertEqual(category_orders, 2)
        self.assertEqual(total.orders, 1)

    def test_category_breakdown_sums_to_gross_sales(self):
        self.make_order(quantity=2, days_ago=1)
        self.rollup()
        today = timezone.localdate()
        payload = login(self.admin).get(
            "/api/panel/dashboard/",
            {"date_from": (today - timedelta(days=1)).isoformat(), "date_to": today.isoformat()},
        ).json()
        self.assertTrue(payload["categories"])
        total = sum(Decimal(row["gross_sales"]) for row in payload["categories"])
        self.assertEqual(total, Decimal(payload["totals"]["gross_sales"]))

    def test_date_range_filter_is_inclusive_and_bounded(self):
        self.make_order(days_ago=0)
        self.make_order(days_ago=200, role="TEACHER")
        self.rollup()
        today = timezone.localdate()
        client = login(self.admin)
        wide = client.get(
            "/api/panel/dashboard/",
            {"date_from": (today - timedelta(days=365)).isoformat(), "date_to": today.isoformat()},
        ).json()
        narrow = client.get(
            "/api/panel/dashboard/",
            {"date_from": today.isoformat(), "date_to": today.isoformat()},
        ).json()
        self.assertEqual(wide["totals"]["orders"], 2)
        self.assertEqual(narrow["totals"]["orders"], 1)

        too_wide = client.get(
            "/api/panel/dashboard/",
            {"date_from": "2000-01-01", "date_to": today.isoformat()},
        )
        self.assertEqual(too_wide.status_code, 400)

    def test_dashboard_is_scoped_to_one_school(self):
        other_student = Student.objects.filter(school=self.other_school).first()
        self.make_order(student=other_student, quantity=7, days_ago=0)
        self.make_order(quantity=1, days_ago=0)
        self.rollup()
        today = timezone.localdate()
        payload = login(self.admin).get(
            "/api/panel/dashboard/",
            {"date_from": today.isoformat(), "date_to": today.isoformat()},
        ).json()
        self.assertEqual(payload["school"]["code"], "DPS-SUR")
        self.assertEqual(payload["totals"]["units"], 1)


class CommissionTests(PanelTestBase):
    def test_commission_uses_the_rate_stored_on_the_school(self):
        self.school.commission_rate = Decimal("12.5")
        self.school.save(update_fields=["commission_rate"])
        self.make_order(quantity=2, days_ago=0)  # 2 x 50.00 = 100.00
        self.rollup()

        today = timezone.localdate()
        payload = login(self.admin).get(
            "/api/panel/commission/",
            {"date_from": today.isoformat(), "date_to": today.isoformat()},
        ).json()
        self.assertEqual(Decimal(payload["gross_sales"]), Decimal("100.00"))
        commission = payload["commission"]
        self.assertTrue(commission["rate_set"])
        self.assertEqual(Decimal(commission["rate"]), Decimal("12.5"))
        self.assertEqual(Decimal(commission["commission_amount"]), Decimal("12.50"))

    def test_commission_reports_not_set_when_the_rate_is_empty(self):
        self.school.commission_rate = None
        self.school.save(update_fields=["commission_rate"])
        self.make_order(quantity=2, days_ago=0)
        self.rollup()

        today = timezone.localdate()
        payload = login(self.admin).get(
            "/api/panel/commission/",
            {"date_from": today.isoformat(), "date_to": today.isoformat()},
        ).json()
        commission = payload["commission"]
        self.assertFalse(commission["rate_set"])
        self.assertIsNone(commission["rate"])
        self.assertIsNone(commission["commission_amount"])
        self.assertEqual(commission["rate_display"], "Not set")
        self.assertIn("not set", (commission["note"] or "").lower())
        # Gross sales are still reported, only the commission is unknown.
        self.assertEqual(Decimal(payload["gross_sales"]), Decimal("100.00"))

    def test_rate_is_never_hard_coded(self):
        """Two different rates produce two different amounts."""
        self.make_order(quantity=2, days_ago=0)
        self.rollup()
        today = timezone.localdate()
        client = login(self.admin)
        amounts = []
        for rate in ("5.00", "20.00"):
            self.school.commission_rate = Decimal(rate)
            self.school.save(update_fields=["commission_rate"])
            payload = client.get(
                "/api/panel/commission/",
                {"date_from": today.isoformat(), "date_to": today.isoformat()},
            ).json()
            amounts.append(Decimal(payload["commission"]["commission_amount"]))
        self.assertEqual(amounts, [Decimal("5.00"), Decimal("20.00")])


# --------------------------------------------------------------------------- #
# Requirement 2 + 8: orders table
# --------------------------------------------------------------------------- #
class OrdersTableTests(PanelTestBase):
    def test_orders_table_shows_student_class_items_units_amount_and_placer(self):
        order = self.make_order(quantity=3, days_ago=1, role="TEACHER")
        payload = login(self.admin).get("/api/panel/orders/").json()
        row = next(r for r in payload["results"] if r["id"] == str(order.id))
        self.assertEqual(row["student_name"], self.student.name)
        self.assertEqual(row["student_class"], self.student.class_name)
        self.assertEqual(row["units"], 3)
        self.assertEqual(Decimal(row["amount"]), Decimal("100.00"))
        self.assertEqual(row["placed_by_role"], "TEACHER")
        self.assertEqual(row["placed_by_role_label"], "Teacher")
        self.assertEqual(row["items"][0]["product"], self.variant.product.name)
        self.assertEqual(row["status"], Order.Status.CONFIRMED)

    def test_filters_by_class_category_date_and_role(self):
        parent_order = self.make_order(quantity=1, days_ago=0, role="PARENT")
        teacher_order = self.make_order(quantity=1, days_ago=2, role="TEACHER")
        other_class_student = Student.objects.create(
            name="Other Class Child",
            gr_number="DPS-99-1",
            class_name="99",
            section="Z",
            gender="MALE",
            school=self.school,
            city_id=self.school.city_id,
            approval_status=Student.ApprovalStatus.APPROVED,
        )
        other_class = self.make_order(student=other_class_student, quantity=1, days_ago=3)

        client = login(self.admin)
        base = client.get("/api/panel/orders/").json()
        ids = {row["id"] for row in base["results"]}
        self.assertTrue({str(parent_order.id), str(teacher_order.id)} <= ids)

        by_role = client.get("/api/panel/orders/", {"placed_by_role": "TEACHER"}).json()
        self.assertEqual({row["id"] for row in by_role["results"]} & ids, {str(teacher_order.id)})

        by_class = client.get("/api/panel/orders/", {"class_name": self.student.class_name}).json()
        self.assertNotIn(str(other_class.id), {row["id"] for row in by_class["results"]})

        by_category = client.get(
            "/api/panel/orders/", {"category": str(self.variant.product.category_id)}
        ).json()
        self.assertIn(str(parent_order.id), {row["id"] for row in by_category["results"]})

        today = timezone.localdate()
        by_date = client.get(
            "/api/panel/orders/",
            {"date_from": today.isoformat(), "date_to": today.isoformat()},
        ).json()
        self.assertEqual({row["id"] for row in by_date["results"]} & ids, {str(parent_order.id)})

    def test_orders_are_paginated_50_rows_at_a_time_with_no_count(self):
        for index in range(120):
            self.make_order(quantity=1, days_ago=(index % 10) + 1)
        client = login(self.admin)
        first = client.get("/api/panel/orders/").json()
        self.assertEqual(len(first["results"]), 50)
        # Requirement 8: no COUNT(*) over the filtered set.
        self.assertNotIn("count", first)
        second = client.get(first["next"].replace("http://testserver", "")).json()
        self.assertEqual(len(second["results"]), 50)
        self.assertFalse({row["id"] for row in first["results"]} & {row["id"] for row in second["results"]})
        third = client.get(second["next"].replace("http://testserver", "")).json()
        self.assertEqual(len(third["results"]), 20)

    def test_orders_are_scoped_to_the_school(self):
        other_student = Student.objects.filter(school=self.other_school).first()
        mine = self.make_order(quantity=1, days_ago=1)
        theirs = self.make_order(student=other_student, quantity=1, days_ago=1)
        ids = {row["id"] for row in login(self.admin).get("/api/panel/orders/").json()["results"]}
        self.assertIn(str(mine.id), ids)
        self.assertNotIn(str(theirs.id), ids)

    def test_parents_and_teachers_cannot_open_the_panel(self):
        for user in (self.parent, self.teacher):
            self.assertEqual(login(user).get("/api/panel/orders/").status_code, 403)

    def test_boss_and_admin_pick_a_school_explicitly(self):
        self.make_order(quantity=1, days_ago=1)
        client = login(User.objects.get(username="boss"))
        payload = client.get("/api/panel/orders/", {"school": str(self.school.id)}).json()
        self.assertEqual(len(payload["results"]), 1)
        # Without ?school= Boss gets the first school in scope, never both.
        default = client.get("/api/panel/orders/").json()
        self.assertTrue(default["results"])
        other = client.get("/api/panel/orders/", {"school": str(self.other_school.id)}).json()
        self.assertEqual(other["results"], [])


# --------------------------------------------------------------------------- #
# Requirement 3: per-student view
# --------------------------------------------------------------------------- #
class StudentOrdersTests(PanelTestBase):
    def test_per_student_view_returns_orders_units_and_order_count(self):
        first = self.make_order(quantity=2, days_ago=1)
        self.make_order(quantity=3, days_ago=5)
        other_student = Student.objects.filter(school=self.school).exclude(pk=self.student.pk).first()
        self.make_order(student=other_student, quantity=9, days_ago=1)

        payload = login(self.admin).get(f"/api/panel/students/{self.student.id}/orders/").json()
        self.assertEqual(payload["student"]["name"], self.student.name)
        self.assertEqual(payload["totals"]["orders"], 2)
        self.assertEqual(payload["totals"]["units"], 5)
        self.assertEqual(Decimal(payload["totals"]["gross_sales"]), Decimal("250.00"))
        self.assertEqual({row["id"] for row in payload["results"]}, {str(first.id), str(payload["results"][1]["id"])})
        self.assertNotIn(str(other_student.id), {row["student"] for row in payload["results"]})

    def test_per_student_view_is_bounded_by_the_year(self):
        self.make_order(quantity=1, days_ago=1)
        old = self.make_order(quantity=5, days_ago=400, role="TEACHER")
        old_order_id = str(old.id)
        payload = login(self.admin).get(f"/api/panel/students/{self.student.id}/orders/").json()
        self.assertNotIn(old_order_id, {row["id"] for row in payload["results"]})

    def test_student_from_another_school_is_not_visible(self):
        other = Student.objects.filter(school=self.other_school).first()
        response = login(self.admin).get(f"/api/panel/students/{other.id}/orders/")
        self.assertEqual(response.status_code, 404)


# --------------------------------------------------------------------------- #
# Requirement 4: background Excel export
# --------------------------------------------------------------------------- #
class ExportJobTests(PanelTestBase):
    def test_requesting_an_export_returns_202_and_builds_nothing_yet(self):
        for index in range(3):
            self.make_order(quantity=1, days_ago=1)
        client = login(self.admin)

        with patch("panel.views.build_export.delay") as queued:
            response = client.post(
                "/api/panel/exports/",
                {"job_type": "ORDERS", "filters": {"class_name": self.student.class_name}},
                format="json",
            )
            self.assertEqual(response.status_code, 202)
            self.assertTrue(queued.called)

        job_id = response.json()["id"]
        job = ExportJob.objects.get(pk=job_id)
        self.assertEqual(job.status, ExportJob.Status.QUEUED)
        self.assertFalse(job.file)  # Requirement 4: nothing built in the request

    def test_worker_builds_the_file_and_the_link_serves_it(self):
        for index in range(4):
            self.make_order(quantity=2, days_ago=1)
        client = login(self.admin)
        job_id = client.post(
            "/api/panel/exports/", {"job_type": "ORDERS", "filters": {}}, format="json"
        ).json()["id"]

        build_export.run(job_id)  # runs the task body directly
        job = ExportJob.objects.get(pk=job_id)
        self.assertEqual(job.status, ExportJob.Status.READY)
        self.assertTrue(job.file)
        self.assertEqual(job.row_count, 4)
        self.assertTrue(job.result["rows"] == 4)

        detail = client.get(f"/api/panel/exports/{job_id}/").json()
        self.assertEqual(detail["status"], "READY")
        self.assertTrue(detail["download_url"])

        download = client.get(detail["download_url"])
        self.assertEqual(download.status_code, 200)
        self.assertIn("spreadsheetml", download["Content-Type"])
        from openpyxl import load_workbook

        workbook = load_workbook(io.BytesIO(b"".join(download.streaming_content)))
        sheet = workbook[workbook.sheetnames[0]]
        self.assertEqual(sheet.max_row, 5)  # header + 4 orders
        self.assertEqual(sheet["A1"].value, "Order number")

    def test_export_is_scoped_to_the_school_and_keeps_the_filters(self):
        other_student = Student.objects.filter(school=self.other_school).first()
        self.make_order(student=other_student, quantity=1, days_ago=1)
        self.make_order(quantity=1, days_ago=1)
        client = login(self.admin)
        job_id = client.post(
            "/api/panel/exports/", {"job_type": "ORDERS", "filters": {}}, format="json"
        ).json()["id"]
        build_export.run(job_id)
        job = ExportJob.objects.get(pk=job_id)
        self.assertEqual(job.row_count, 1)

    def test_student_export_job(self):
        client = login(self.admin)
        job_id = client.post(
            "/api/panel/exports/", {"job_type": "STUDENTS", "filters": {}}, format="json"
        ).json()["id"]
        build_export.run(job_id)
        job = ExportJob.objects.get(pk=job_id)
        self.assertEqual(job.status, ExportJob.Status.READY)
        self.assertEqual(job.row_count, Student.objects.filter(school=self.school).count())

    def test_exports_of_another_school_are_not_listed(self):
        client = login(self.admin)
        job_id = client.post("/api/panel/exports/", {"job_type": "ORDERS"}, format="json").json()["id"]
        build_export.run(job_id)
        listed = {row["id"] for row in client.get("/api/panel/exports/").json()["results"]}
        self.assertIn(job_id, listed)


# --------------------------------------------------------------------------- #
# Requirement 5: student management
# --------------------------------------------------------------------------- #
class StudentManagementTests(PanelTestBase):
    def test_roster_is_scoped_paginated_and_searchable(self):
        client = login(self.admin)
        payload = client.get("/api/panel/students/").json()
        self.assertNotIn("count", payload)  # requirement 8
        self.assertTrue(payload["results"])
        self.assertTrue(
            all(row["school_code"] == "DPS-SUR" for row in payload["results"])
        )

        found = client.get("/api/panel/students/", {"search": self.student.name[:5]}).json()
        self.assertIn(str(self.student.id), {row["id"] for row in found["results"]})

    def test_add_and_edit_a_student(self):
        client = login(self.admin)
        created = client.post(
            "/api/panel/students/",
            {
                "name": "New Panel Student",
                "gr_number": "PANEL-001",
                "class_name": "4",
                "section": "B",
                "gender": "FEMALE",
                "school": str(self.school.id),
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        student_id = created.json()["id"]
        self.assertEqual(
            Student.objects.get(pk=student_id).school_id, self.school.id
        )

        updated = client.patch(
            f"/api/panel/students/{student_id}/",
            {"class_name": "5", "section": "C"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200, updated.content)
        student = Student.objects.get(pk=student_id)
        self.assertEqual(student.class_name, "5")
        self.assertEqual(student.section, "C")

    def test_cannot_add_a_student_to_another_school(self):
        client = login(self.admin)
        response = client.post(
            "/api/panel/students/",
            {
                "name": "Wrong School",
                "gr_number": "PANEL-002",
                "class_name": "4",
                "section": "B",
                "gender": "MALE",
                "school": str(self.other_school.id),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_approve_a_parent_added_child(self):
        pending = Student.objects.create(
            name="Pending Child",
            gr_number="DPS-PENDING-1",
            class_name="2",
            section="A",
            gender="FEMALE",
            school=self.school,
            city_id=self.school.city_id,
            parent=self.parent,
            approval_status=Student.ApprovalStatus.PENDING,
            source=Student.Source.PARENT_MANUAL,
        )
        client = login(self.admin)
        queue = client.get("/api/panel/students/pending/").json()
        self.assertIn(str(pending.id), {row["id"] for row in queue["results"]})

        approved = client.post(
            f"/api/panel/students/{pending.id}/approve/",
            {"class_name": "3", "section": "B"},
            format="json",
        )
        self.assertEqual(approved.status_code, 200)
        pending.refresh_from_db()
        self.assertEqual(pending.approval_status, Student.ApprovalStatus.APPROVED)
        self.assertEqual(pending.class_name, "3")

    def test_bulk_import_runs_as_two_background_jobs(self):
        client = login(self.admin)
        upload = client.post(
            "/api/panel/student-imports/",
            {
                "file": csv_upload(
                    [
                        ["Bulk One", "BULK-1", "3", "A", "M", ""],
                        ["Bulk Two", "BULK-2", "3", "B", "F", ""],
                        ["Broken Row", "", "3", "B", "M", ""],
                    ]
                )
            },
            format="multipart",
        )
        self.assertEqual(upload.status_code, 202)
        job_id = upload.json()["id"]
        job = ImportJob.objects.get(pk=job_id)
        self.assertEqual(job.school_id, self.school.id)

        # Celery runs eagerly in tests, so the validation job already finished.
        self.assertEqual(job.status, ImportJob.Status.PREVIEW_READY)
        self.assertEqual(job.valid_count, 2)
        self.assertEqual(job.error_count, 1)

        confirm = client.post(f"/api/panel/student-imports/{job_id}/confirm/")
        self.assertIn(confirm.status_code, (200, 202))
        job.refresh_from_db()
        self.assertEqual(job.status, ImportJob.Status.COMPLETED)
        self.assertEqual(job.result["inserted"], 2)
        self.assertTrue(Student.objects.filter(school=self.school, gr_number="BULK-1").exists())

    def test_import_template_is_downloadable(self):
        response = login(self.admin).get("/api/panel/student-imports/template/?format=xlsx")
        self.assertEqual(response.status_code, 200)
        self.assertIn("spreadsheet", response["Content-Type"])


# --------------------------------------------------------------------------- #
# Requirement 6: teacher accounts
# --------------------------------------------------------------------------- #
class TeacherAccountTests(PanelTestBase):
    def test_list_teachers_of_the_school(self):
        payload = login(self.admin).get("/api/panel/teachers/").json()
        usernames = {row["username"] for row in payload["results"]}
        self.assertIn("teacher_dps", usernames)
        self.assertTrue(all(row["role"] == "TEACHER" for row in payload["results"]))

    def test_create_a_teacher_login_for_this_school(self):
        response = login(self.admin).post(
            "/api/panel/teachers/",
            {"first_name": "New", "last_name": "Teacher", "email": "new.teacher@dps.test"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertTrue(body["temporary_password"])
        self.assertTrue(body["must_change_password"])
        user = User.objects.get(pk=body["id"])
        self.assertEqual(user.role, User.Role.TEACHER)
        self.assertEqual(user.school_id, self.school.id)
        self.assertEqual(user.city_id, self.school.city_id)
        self.assertTrue(user.check_password(body["temporary_password"]))

    def test_deactivate_and_reactivate(self):
        client = login(self.admin)
        created = client.post(
            "/api/panel/teachers/", {"first_name": "Soon", "last_name": "Gone"}, format="json"
        ).json()
        teacher_id = created["id"]
        self.assertFalse(
            client.post(f"/api/panel/teachers/{teacher_id}/deactivate/").json()["is_active"]
        )
        self.assertTrue(
            client.post(f"/api/panel/teachers/{teacher_id}/activate/").json()["is_active"]
        )

    def test_teachers_are_deactivated_not_deleted(self):
        client = login(self.admin)
        created = client.post("/api/panel/teachers/", {"first_name": "Keep", "last_name": "Me"}, format="json").json()
        self.assertEqual(client.delete(f"/api/panel/teachers/{created['id']}/").status_code, 403)
        self.assertTrue(User.objects.filter(pk=created["id"]).exists())

    def test_teachers_of_another_school_are_out_of_scope(self):
        other_teacher = User.objects.create_user(
            username="other_school_teacher",
            password="Password@123",
            role=User.Role.TEACHER,
            school=self.other_school,
            city_id=self.other_school.city_id,
        )
        client = login(self.admin)
        self.assertEqual(client.get(f"/api/panel/teachers/{other_teacher.id}/").status_code, 404)
        self.assertEqual(
            client.post(f"/api/panel/teachers/{other_teacher.id}/deactivate/").status_code, 404
        )


# --------------------------------------------------------------------------- #
# Requirement 8: no row counts over large filtered sets
# --------------------------------------------------------------------------- #
class NoCountTests(PanelTestBase):
    def test_cursor_paginated_endpoints_never_return_a_count(self):
        client = login(self.admin)
        for endpoint in ("/api/panel/orders/", "/api/panel/students/"):
            payload = client.get(endpoint).json()
            self.assertNotIn("count", payload, endpoint)
            self.assertIn("next", payload, endpoint)

    def test_pending_counter_uses_the_school_approval_index(self):
        Student.objects.create(
            name="Pending One",
            gr_number="PEND-1",
            class_name="1",
            section="A",
            gender="MALE",
            school=self.school,
            city_id=self.school.city_id,
            approval_status=Student.ApprovalStatus.PENDING,
            source=Student.Source.PARENT_MANUAL,
        )
        payload = login(self.admin).get("/api/panel/dashboard/").json()
        self.assertEqual(payload["pending_students"], 1)


# --------------------------------------------------------------------------- #
# Rollup plumbing used by the dashboard
# --------------------------------------------------------------------------- #
class RollupTests(PanelTestBase):
    def test_rollup_writes_both_grains_and_excludes_cancelled_orders(self):
        self.make_order(quantity=2, days_ago=0)
        cancelled = self.make_order(quantity=4, days_ago=0, role="TEACHER")
        cancelled.status = Order.Status.CANCELLED
        cancelled.save(update_fields=["status"])
        self.rollup()

        today = timezone.localdate()
        total = DailySchoolTotal.objects.get(school=self.school, date=today)
        self.assertEqual(total.orders, 1)
        self.assertEqual(total.units, 2)
        self.assertTrue(DailySalesSummary.objects.filter(school=self.school, date=today).exists())

    def test_backfill_command_rebuilds_the_rollups(self):
        self.make_order(quantity=2, days_ago=0)
        DailySchoolTotal.objects.all().delete()
        call_command("backfill_sales_summaries", date=timezone.localdate().isoformat())
        self.assertTrue(DailySchoolTotal.objects.filter(school=self.school).exists())

    def test_denormalised_class_stays_in_sync(self):
        order = self.make_order(quantity=1, days_ago=0)
        self.assertEqual(order.student_class, self.student.class_name)
        self.student.class_name = "12"
        self.student.save()
        order.refresh_from_db()
        self.assertEqual(order.student_class, "12")
