import csv
import io
import shutil
import tempfile

from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from common.models import ImportJob
from orders.models import Order

from .import_service import TEMPLATE_COLUMNS, commit_import, validate_import
from .models import School, Student

BASE_SCHOOL_A_STUDENTS = 0  # filled in setUpTestData


def login(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(user)['access']}")
    return client


def csv_upload(rows, columns=None):
    from django.core.files.uploadedfile import SimpleUploadedFile

    columns = columns or TEMPLATE_COLUMNS
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(columns)
    for row in rows:
        writer.writerow(row)
    return SimpleUploadedFile(
        "students.csv", buffer.getvalue().encode("utf-8"), content_type="text/csv"
    )


def xlsx_upload(rows, columns=None):
    from django.core.files.uploadedfile import SimpleUploadedFile
    from openpyxl import Workbook

    columns = columns or TEMPLATE_COLUMNS
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(columns)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return SimpleUploadedFile(
        "students.xlsx",
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def row(name, gr, klass="5", section="A", gender="M", dob="", phone=""):
    return [name, gr, klass, section, gender, dob, phone]


class StudentManagementTestBase(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media_root = tempfile.mkdtemp(prefix="school-store-tests-")
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
        cls.school_a = School.objects.get(code="DPS-SUR")
        cls.school_b = School.objects.get(code="FHS-SUR")
        cls.boss = User.objects.get(username="boss")
        cls.admin_surat = User.objects.get(username="admin_surat")
        cls.school_admin_a = User.objects.get(username="school_admin_dps")
        cls.teacher_a = User.objects.get(username="teacher_dps")
        cls.parent_a = User.objects.get(username="parent_rahul")
        cls.parent_b = User.objects.get(username="parent_priya")
        # A School Admin for School B (used to prove cross-school isolation)
        cls.school_admin_b = User.objects.create_user(
            username="school_admin_fhs_schools",
            password="Password@123",
            role=User.Role.SCHOOL_ADMIN,
            city=cls.school_b.city,
            school=cls.school_b,
        )

    def setUp(self):
        # Throttle counters live in Redis, so reset them between tests.
        cache.clear()
        self.base_school_a = Student.objects.filter(school=self.school_a).count()


class StudentCrudTests(StudentManagementTestBase):
    def test_teacher_adds_student_by_form_in_own_school(self):
        client = login(self.teacher_a)
        res = client.post(
            "/api/students/",
            {
                "name": "Ishaan Mehta",
                "gr_number": "GR-NEW-001",
                "class_name": "5",
                "section": "C",
                "gender": "MALE",
                "date_of_birth": "2015-06-11",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(str(res.data["school"]), str(self.school_a.id))
        self.assertEqual(res.data["source"], "STAFF")
        self.assertEqual(res.data["approval_status"], "APPROVED")

    def test_staff_cannot_add_student_to_another_school(self):
        client = login(self.school_admin_a)
        res = client.post(
            "/api/students/",
            {
                "name": "Wrong School",
                "gr_number": "GR-B-999",
                "class_name": "5",
                "section": "A",
                "gender": "MALE",
                "school": str(self.school_b.id),
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_parent_cannot_create_students_through_crud_endpoint(self):
        client = login(self.parent_a)
        res = client.post(
            "/api/students/",
            {
                "name": "Sneaky",
                "gr_number": "GR-X-1",
                "class_name": "5",
                "section": "A",
                "gender": "MALE",
                "school": str(self.school_a.id),
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_duplicate_gr_number_in_same_school_rejected(self):
        client = login(self.school_admin_a)
        payload = {
            "name": "First",
            "gr_number": "GR-DUP-1",
            "class_name": "5",
            "section": "A",
            "gender": "MALE",
        }
        self.assertEqual(client.post("/api/students/", payload, format="json").status_code, 201)
        payload["name"] = "Second"
        res = client.post("/api/students/", payload, format="json")
        self.assertEqual(res.status_code, 400)

    def test_update_and_delete_are_scoped(self):
        student_b = Student.objects.create(
            name="School B Child",
            gr_number="GR-B-100",
            class_name="4",
            section="A",
            gender=Student.Gender.FEMALE,
            school=self.school_b,
            city=self.school_b.city,
        )
        client = login(self.school_admin_a)
        self.assertEqual(
            client.patch(
                f"/api/students/{student_b.id}/", {"name": "Nope"}, format="json"
            ).status_code,
            404,
        )
        self.assertEqual(client.delete(f"/api/students/{student_b.id}/").status_code, 404)
        student_b.refresh_from_db()
        self.assertEqual(student_b.name, "School B Child")


class StudentListTests(StudentManagementTestBase):
    def test_list_is_paginated_at_50_per_page(self):
        Student.objects.bulk_create(
            [
                Student(
                    name=f"Paged Child {i:03d}",
                    gr_number=f"GR-PAGE-{i:03d}",
                    class_name="5",
                    section="A",
                    gender=Student.Gender.MALE,
                    school=self.school_a,
                    city=self.school_a.city,
                )
                for i in range(60)
            ]
        )
        expected_total = self.base_school_a + 60
        client = login(self.school_admin_a)
        page1 = client.get("/api/students/")
        self.assertEqual(page1.status_code, 200)
        self.assertEqual(page1.data["count"], expected_total)
        self.assertEqual(len(page1.data["results"]), 50)
        page2 = client.get("/api/students/?page=2")
        self.assertEqual(len(page2.data["results"]), min(50, expected_total - 50))

    def test_search_by_name_and_gr_number_and_filters(self):
        Student.objects.bulk_create(
            [
                Student(
                    name="Qtestaarav Sharma",
                    gr_number="GR-5001",
                    class_name="5",
                    section="A",
                    gender=Student.Gender.MALE,
                    school=self.school_a,
                    city=self.school_a.city,
                ),
                Student(
                    name="Diya Patel",
                    gr_number="GR-6002",
                    class_name="6",
                    section="B",
                    gender=Student.Gender.FEMALE,
                    school=self.school_a,
                    city=self.school_a.city,
                ),
                Student(
                    name="Qtestaarohi Shah",
                    gr_number="GR-7003",
                    class_name="6",
                    section="A",
                    gender=Student.Gender.FEMALE,
                    school=self.school_a,
                    city=self.school_a.city,
                ),
            ]
        )
        client = login(self.school_admin_a)

        by_name = client.get("/api/students/?search=qtestaar")
        self.assertEqual(
            sorted(r["name"] for r in by_name.data["results"]),
            ["Qtestaarav Sharma", "Qtestaarohi Shah"],
        )

        # case-insensitive prefix search
        by_name_upper = client.get("/api/students/?search=QTESTAARAV")
        self.assertEqual(
            [r["gr_number"] for r in by_name_upper.data["results"]], ["GR-5001"]
        )

        by_gr = client.get("/api/students/?search=GR-6002")
        self.assertEqual([r["gr_number"] for r in by_gr.data["results"]], ["GR-6002"])

        by_class = client.get("/api/students/?class_name=6")
        self.assertEqual(sorted(r["gr_number"] for r in by_class.data["results"]), ["GR-6002", "GR-7003"])

        by_section_and_class = client.get("/api/students/?class_name=6&section=A")
        self.assertEqual(
            [r["gr_number"] for r in by_section_and_class.data["results"]], ["GR-7003"]
        )

    def test_class_and_section_filter_plan_uses_composite_index(self):
        """Rule P3: the (school, class, section) filter is an indexed lookup."""
        Student.objects.bulk_create(
            [
                Student(
                    name=f"Indexed Child {i:04d}",
                    gr_number=f"GR-IDX-{i:04d}",
                    class_name=str(i % 12 + 1),
                    section="ABCD"[i % 4],
                    gender=Student.Gender.MALE,
                    school=self.school_a,
                    city=self.school_a.city,
                )
                for i in range(4000)
            ]
        )
        with connection.cursor() as cursor:
            cursor.execute("ANALYZE schools_student")
            cursor.execute("SET LOCAL enable_seqscan = off")
            cursor.execute(
                """
                EXPLAIN
                SELECT id FROM schools_student
                WHERE school_id = %s AND "class" = %s AND section = %s
                ORDER BY school_id, "class", section, name
                LIMIT 50;
                """,
                [str(self.school_a.id), "5", "A"],
            )
            plan = "\n".join(r[0] for r in cursor.fetchall())
        # The (school, class, section) prefix is served by the composite index.
        # `idx_student_school_roster` extends it with name + id so the admin
        # roster's cursor ordering needs no sort; either one satisfies rule P3.
        self.assertTrue(
            "idx_student_school_cls_sec" in plan
            or "idx_student_school_roster" in plan,
            plan,
        )

    def test_search_plan_uses_expression_index(self):
        Student.objects.bulk_create(
            [
                Student(
                    name=f"Searchable Child {i:04d}",
                    gr_number=f"GR-SRC-{i:04d}",
                    class_name="5",
                    section="A",
                    gender=Student.Gender.MALE,
                    school=self.school_a,
                    city=self.school_a.city,
                )
                for i in range(2000)
            ]
        )
        with connection.cursor() as cursor:
            cursor.execute("ANALYZE schools_student")
            cursor.execute("SET LOCAL enable_seqscan = off")
            cursor.execute(
                "EXPLAIN SELECT id FROM schools_student WHERE UPPER(name) LIKE UPPER(%s);",
                ["Searchable%"],
            )
            plan = "\n".join(r[0] for r in cursor.fetchall())
        self.assertIn("idx_student_name_upper", plan)


class StudentBulkImportTests(StudentManagementTestBase):
    def _upload(self, client, upload, school=None):
        payload = {"file": upload}
        if school is not None:
            payload["school"] = str(school.id)
        return client.post("/api/student-imports/", payload, format="multipart")

    def test_upload_returns_job_id_immediately_and_previews_buckets(self):
        Student.objects.create(
            name="Existing Child",
            gr_number="GR-EXIST-1",
            class_name="5",
            section="A",
            gender=Student.Gender.MALE,
            school=self.school_a,
            city=self.school_a.city,
        )
        rows = [
            row("Child One", "GR-IMP-1", "5", "A", "M", "2015-01-01"),
            row("Child Two", "GR-IMP-2", "5", "B", "F"),
            row("Child Three", "GR-IMP-3", "6", "A", "Male"),
            row("Duplicate In File", "GR-IMP-1", "5", "A", "M"),
            row("", "GR-IMP-4", "5", "A", "M"),  # missing name
            row("Existing Child", "GR-EXIST-1", "6", "A", "M"),  # already in DB -> update
        ]
        client = login(self.school_admin_a)
        res = self._upload(client, csv_upload(rows))
        self.assertEqual(res.status_code, 202, res.data)
        self.assertIn("id", res.data)
        self.assertEqual(res.data["status"], ImportJob.Status.PREVIEW_READY)

        job = ImportJob.objects.get(pk=res.data["id"])
        self.assertEqual(job.total_rows, 6)
        # 3 new + 1 update of a student already on the roster
        self.assertEqual(job.valid_count, 4)
        self.assertEqual(job.duplicate_count, 1)
        self.assertEqual(job.error_count, 1)
        self.assertEqual(job.preview["summary"]["new"], 3)
        self.assertEqual(job.preview["summary"]["updated"], 1)
        self.assertEqual(len(job.preview["updates"]), 1)
        self.assertEqual(len(job.preview["duplicates"]), 1)
        self.assertEqual(len(job.preview["errors"]), 1)
        self.assertEqual(job.preview["errors"][0]["errors"]["name"], "name is required.")
        self.assertFalse(job.error_message)
        self.assertEqual(job.status, ImportJob.Status.PREVIEW_READY)

    def test_duplicate_detection_is_one_query_for_the_whole_file(self):
        rows = [row(f"Child {i:03d}", f"GR-ONE-{i:03d}") for i in range(300)]
        client = login(self.school_admin_a)
        res = self._upload(client, csv_upload(rows))
        job = ImportJob.objects.get(pk=res.data["id"])
        job.status = ImportJob.Status.PENDING
        job.save(update_fields=["status"])

        with CaptureQueriesContext(connection) as ctx:
            validate_import(job)

        # The GR-number lookup is one query for the whole file. (A second,
        # separate COUNT reports how many roster students are not in the file.)
        student_selects = [
            q["sql"]
            for q in ctx.captured_queries
            if "SELECT" in q["sql"].upper()
            and "schools_student" in q["sql"]
            and "COUNT(" not in q["sql"].upper()
        ]
        self.assertEqual(
            len(student_selects),
            1,
            f"Existing-GR detection must use ONE query per file, got {len(student_selects)}",
        )
        self.assertIn("gr_number", student_selects[0])
        self.assertIn("school_id", student_selects[0])
        self.assertEqual(job.valid_count, 300)

    def test_confirm_inserts_in_batches_of_500_with_on_conflict(self):
        rows = [row(f"Batch Child {i:04d}", f"GR-BATCH-{i:04d}") for i in range(1200)]
        client = login(self.school_admin_a)
        res = self._upload(client, csv_upload(rows))
        job = ImportJob.objects.get(pk=res.data["id"])
        self.assertEqual(job.valid_count, 1200)

        with CaptureQueriesContext(connection) as ctx:
            confirm = client.post(f"/api/student-imports/{job.id}/confirm/")
        self.assertEqual(confirm.status_code, 202, confirm.data)

        job.refresh_from_db()
        self.assertEqual(job.status, ImportJob.Status.COMPLETED)
        self.assertEqual(job.result["inserted"], 1200)
        self.assertEqual(job.result["batch_size"], 500)
        self.assertEqual(job.result["batches"], 3)
        self.assertEqual(
            Student.objects.filter(school=self.school_a).count(),
            self.base_school_a + 1200,
        )

        inserts = [
            q["sql"] for q in ctx.captured_queries if q["sql"].upper().startswith("INSERT")
        ]
        self.assertEqual(len(inserts), 3, "1200 rows must insert as 3 batches of 500")
        self.assertTrue(all("ON CONFLICT" in sql.upper() for sql in inserts))
        self.assertFalse(
            any(Student.objects.filter(gr_number=f"GR-BATCH-{i:04d}").count() > 1 for i in range(1200))
        )

    def test_reimporting_updates_existing_students(self):
        """The yearly upload promotes students instead of skipping them."""
        rows = [row(f"Repeat Child {i}", f"GR-REP-{i}", "5") for i in range(5)]
        client = login(self.school_admin_a)
        first = self._upload(client, csv_upload(rows))
        client.post(f"/api/student-imports/{first.data['id']}/confirm/")
        self.assertEqual(
            Student.objects.filter(school=self.school_a).count(), self.base_school_a + 5
        )

        promoted = [row(f"Repeat Child {i}", f"GR-REP-{i}", "6", "B") for i in range(5)]
        second = self._upload(client, csv_upload(promoted))
        job = ImportJob.objects.get(pk=second.data["id"])
        self.assertEqual(job.valid_count, 5)
        self.assertEqual(job.duplicate_count, 0)
        self.assertEqual(job.preview["summary"]["updated"], 5)
        self.assertEqual(job.preview["summary"]["new"], 0)

        res = client.post(f"/api/student-imports/{job.id}/confirm/")
        self.assertEqual(res.status_code, 202, res.data)
        job.refresh_from_db()
        self.assertEqual(job.result["inserted"], 0)
        self.assertEqual(job.result["updated"], 5)
        self.assertEqual(
            Student.objects.filter(school=self.school_a).count(), self.base_school_a + 5
        )
        child = Student.objects.get(school=self.school_a, gr_number="GR-REP-0")
        self.assertEqual(child.class_name, "Class 6")
        self.assertEqual(child.grade.name, "Class 6")
        self.assertEqual(child.section, "B")

    def test_complete_list_marks_missing_students_as_left(self):
        client = login(self.school_admin_a)
        first = self._upload(client, csv_upload([row(f"Kid {i}", f"GR-LEFT-{i}") for i in range(3)]))
        client.post(f"/api/student-imports/{first.data['id']}/confirm/")
        active_before = Student.objects.filter(school=self.school_a, active=True).count()

        # A partial file (no flag) never deactivates anyone
        partial = self._upload(client, csv_upload([row("Kid 0", "GR-LEFT-0")]))
        client.post(f"/api/student-imports/{partial.data['id']}/confirm/")
        self.assertEqual(
            Student.objects.filter(school=self.school_a, active=True).count(), active_before
        )

        # The school's complete list: everyone not in it is marked as left
        full = self._upload(client, csv_upload([row("Kid 0", "GR-LEFT-0"), row("Kid 1", "GR-LEFT-1")]))
        job = ImportJob.objects.get(pk=full.data["id"])
        self.assertEqual(job.preview["summary"]["not_in_file"], active_before - 2)
        res = client.post(
            f"/api/student-imports/{job.id}/confirm/",
            {"mark_missing_as_left": True},
            format="json",
        )
        self.assertEqual(res.status_code, 202, res.data)
        job.refresh_from_db()
        self.assertEqual(job.result["marked_left"], active_before - 2)
        self.assertFalse(Student.objects.get(school=self.school_a, gr_number="GR-LEFT-2").active)
        self.assertTrue(Student.objects.get(school=self.school_a, gr_number="GR-LEFT-1").active)

    def test_parent_phone_column_is_optional_and_forgiving(self):
        client = login(self.school_admin_a)
        res = self._upload(
            client,
            csv_upload(
                [
                    row("Phone Kid", "GR-PH-1", phone="+91 98200 11223"),
                    row("Bad Phone Kid", "GR-PH-2", phone="12345"),
                    row("No Phone Kid", "GR-PH-3"),
                ]
            ),
        )
        job = ImportJob.objects.get(pk=res.data["id"])
        self.assertEqual(job.valid_count, 3)
        self.assertEqual(job.error_count, 0)
        self.assertEqual(job.preview["summary"]["parent_phones"], 1)
        self.assertEqual(job.preview["summary"]["parent_phones_ignored"], 1)
        client.post(f"/api/student-imports/{job.id}/confirm/")
        self.assertEqual(Student.objects.get(gr_number="GR-PH-1").roster_phone, "9820011223")
        self.assertEqual(Student.objects.get(gr_number="GR-PH-2").roster_phone, "")


    def test_xlsx_upload_supported(self):
        client = login(self.school_admin_a)
        res = self._upload(
            client, xlsx_upload([row("Excel Child", "GR-XLSX-1", "7", "B", "Female")])
        )
        self.assertEqual(res.status_code, 202, res.data)
        job = ImportJob.objects.get(pk=res.data["id"])
        self.assertEqual(job.valid_count, 1)

    def test_upload_rejects_bad_extension_and_oversized_file(self):
        client = login(self.school_admin_a)
        from django.core.files.uploadedfile import SimpleUploadedFile

        bad = SimpleUploadedFile("students.txt", b"name,gr_number\nA,1\n")
        self.assertEqual(self._upload(client, bad).status_code, 400)

        with override_settings(STUDENT_IMPORT_MAX_BYTES=512):
            big = csv_upload([row(f"N{i}", f"G{i}") for i in range(200)])
            res = self._upload(client, big)
        self.assertEqual(res.status_code, 400)
        self.assertIn("too large", str(res.data).lower())

    def test_row_cap_fails_the_job_not_the_request(self):
        client = login(self.school_admin_a)
        with override_settings(STUDENT_IMPORT_MAX_ROWS=10):
            res = self._upload(
                client, csv_upload([row(f"C{i}", f"GR-CAP-{i}") for i in range(25)])
            )
        self.assertEqual(res.status_code, 202)
        job = ImportJob.objects.get(pk=res.data["id"])
        self.assertEqual(job.status, ImportJob.Status.FAILED)
        self.assertIn("more than 10 rows", job.error_message)

    def test_missing_columns_fail_the_job_with_a_clear_message(self):
        client = login(self.school_admin_a)
        bad = csv_upload(
            [["Only Name", "GR-1"]], columns=["name", "gr_number"]
        )
        res = self._upload(client, bad)
        job = ImportJob.objects.get(pk=res.data["id"])
        self.assertEqual(job.status, ImportJob.Status.FAILED)
        self.assertIn("Missing required column", job.error_message)
        self.assertIn("class", job.error_message)

    def test_downloadable_template_has_exact_columns(self):
        client = login(self.school_admin_a)

        csv_res = client.get("/api/student-imports/template/?format=csv")
        self.assertEqual(csv_res.status_code, 200)
        self.assertIn("attachment", csv_res["Content-Disposition"])
        header = csv_res.content.decode().strip().splitlines()[0]
        self.assertEqual(header.split(","), TEMPLATE_COLUMNS)

        xlsx_res = client.get("/api/student-imports/template/?format=xlsx")
        self.assertEqual(xlsx_res.status_code, 200)
        from openpyxl import load_workbook

        workbook = load_workbook(io.BytesIO(xlsx_res.content))
        self.assertEqual(
            [c.value for c in workbook["Students"][1]], TEMPLATE_COLUMNS
        )

    def test_import_jobs_are_scoped_and_report_downloadable(self):
        rows = [
            row("Good Child", "GR-RPT-1"),
            row("Bad Child", "GR-RPT-2", "5", "A", "X"),  # invalid gender
        ]
        client_a = login(self.school_admin_a)
        res = client_a.post(
            "/api/student-imports/",
            {"file": csv_upload(rows), "school": str(self.school_a.id)},
            format="multipart",
        )
        job_id = res.data["id"]

        # another school cannot see or confirm the job
        client_b = login(self.school_admin_b)
        self.assertEqual(client_b.get(f"/api/student-imports/{job_id}/").status_code, 404)

        report = client_a.get(f"/api/student-imports/{job_id}/report/")
        self.assertEqual(report.status_code, 200)
        self.assertIn("gender must be one of", report.content.decode())


class ParentChildLinkingTests(StudentManagementTestBase):
    def setUp(self):
        super().setUp()
        self.roster_child = Student.objects.create(
            name="Roster Child",
            gr_number="GR-CLAIM-1",
            class_name="5",
            section="A",
            gender=Student.Gender.MALE,
            date_of_birth="2015-04-01",
            school=self.school_a,
            city=self.school_a.city,
        )

    def test_claim_with_class_and_section(self):
        client = login(self.parent_a)
        res = client.post(
            "/api/students/claim/",
            {
                "school": str(self.school_a.id),
                "gr_number": "GR-CLAIM-1",
                "class_name": "5",
                "section": "A",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.roster_child.refresh_from_db()
        self.assertEqual(self.roster_child.parent_id, self.parent_a.id)

    def test_claim_with_date_of_birth(self):
        client = login(self.parent_a)
        res = client.post(
            "/api/students/claim/",
            {
                "school": str(self.school_a.id),
                "gr_number": "GR-CLAIM-1",
                "date_of_birth": "2015-04-01",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.roster_child.refresh_from_db()
        self.assertEqual(self.roster_child.parent_id, self.parent_a.id)

    def test_wrong_verification_details_do_not_match(self):
        client = login(self.parent_a)
        for payload in (
            {"class_name": "9", "section": "Z"},
            {"date_of_birth": "2011-01-01"},
        ):
            res = client.post(
                "/api/students/claim/",
                {"school": str(self.school_a.id), "gr_number": "GR-CLAIM-1", **payload},
                format="json",
            )
            self.assertEqual(res.status_code, 400)
            self.assertNotIn("Roster Child", str(res.data))
        self.roster_child.refresh_from_db()
        self.assertIsNone(self.roster_child.parent_id)

    def test_claim_requires_a_second_check(self):
        client = login(self.parent_a)
        res = client.post(
            "/api/students/claim/",
            {"school": str(self.school_a.id), "gr_number": "GR-CLAIM-1"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("date of birth", str(res.data))

    def test_claim_lookup_is_a_single_indexed_query(self):
        client = login(self.parent_a)
        with CaptureQueriesContext(connection) as ctx:
            res = client.post(
                "/api/students/claim/",
                {
                    "school": str(self.school_a.id),
                    "gr_number": "GR-CLAIM-1",
                    "class_name": "5",
                    "section": "A",
                },
                format="json",
            )
        self.assertEqual(res.status_code, 200)
        student_selects = [
            q["sql"]
            for q in ctx.captured_queries
            if "schools_student" in q["sql"] and q["sql"].strip().upper().startswith("SELECT")
        ]
        self.assertEqual(len(student_selects), 1, student_selects)
        self.assertIn("school_id", student_selects[0])
        self.assertIn("gr_number", student_selects[0])

    def test_child_can_only_be_linked_to_one_parent(self):
        first = login(self.parent_a)
        payload = {
            "school": str(self.school_a.id),
            "gr_number": "GR-CLAIM-1",
            "class_name": "5",
            "section": "A",
        }
        self.assertEqual(first.post("/api/students/claim/", payload, format="json").status_code, 200)

        second = login(self.parent_b)
        blocked = second.post("/api/students/claim/", payload, format="json")
        self.assertEqual(blocked.status_code, 409)
        self.roster_child.refresh_from_db()
        self.assertEqual(self.roster_child.parent_id, self.parent_a.id)

    def test_school_admin_override_reassigns_the_parent_link(self):
        teacher_order = Order.objects.create(
            order_number="ORD-PARENT-LINK-TEST",
            placed_by=self.teacher_a,
            placed_by_role=User.Role.TEACHER,
            student=self.roster_child,
            school=self.school_a,
            city=self.school_a.city,
            subtotal="0.00",
            total="0.00",
        )
        self.assertIsNone(teacher_order.parent_id)

        self.roster_child.parent = self.parent_a
        self.roster_child.save(update_fields=["parent"])
        teacher_order.refresh_from_db()
        self.assertEqual(teacher_order.parent_id, self.parent_a.id)

        client = login(self.school_admin_a)
        res = client.post(
            f"/api/students/{self.roster_child.id}/assign-parent/",
            {"parent": str(self.parent_b.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.roster_child.refresh_from_db()
        self.assertEqual(self.roster_child.parent_id, self.parent_b.id)

        # the old parent can no longer claim the child
        old_parent = login(self.parent_a)
        payload = {
            "school": str(self.school_a.id),
            "gr_number": "GR-CLAIM-1",
            "class_name": "5",
            "section": "A",
        }
        self.assertEqual(old_parent.post("/api/students/claim/", payload, format="json").status_code, 409)

        # unlink is also an admin action
        unlink = client.post(
            f"/api/students/{self.roster_child.id}/assign-parent/",
            {"parent": None},
            format="json",
        )
        self.assertEqual(unlink.status_code, 200)
        self.roster_child.refresh_from_db()
        self.assertIsNone(self.roster_child.parent_id)

    def test_teacher_cannot_override_parent_link(self):
        client = login(self.teacher_a)
        res = client.post(
            f"/api/students/{self.roster_child.id}/assign-parent/",
            {"parent": str(self.parent_b.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_claim_endpoint_is_rate_limited(self):
        client = login(self.parent_a)
        payload = {
            "school": str(self.school_a.id),
            "gr_number": "GR-GUESS-999",  # deliberately wrong: guessing must be throttled
            "class_name": "5",
            "section": "A",
        }
        with override_settings(
            REST_FRAMEWORK={
                **__import__("django.conf", fromlist=["settings"]).settings.REST_FRAMEWORK,
                "DEFAULT_THROTTLE_RATES": {
                    "student_claim_user": "2/hour",
                    "student_claim_ip": "100/hour",
                },
            }
        ):
            statuses = [
                client.post("/api/students/claim/", payload, format="json").status_code
                for _ in range(3)
            ]
        self.assertEqual(statuses[:2], [400, 400])
        self.assertEqual(statuses[2], 429, statuses)


class ParentManualAddAndApprovalTests(StudentManagementTestBase):
    def test_parent_manual_add_stays_pending_until_approved(self):
        client = login(self.parent_a)
        res = client.post(
            "/api/students/manual-add/",
            {
                "school": str(self.school_a.id),
                "name": "Manually Added",
                "gr_number": "GR-MANUAL-1",
                "class_name": "3",
                "section": "B",
                "gender": "FEMALE",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["approval_status"], "PENDING")
        self.assertEqual(res.data["source"], "PARENT_MANUAL")
        student_id = res.data["id"]

        # the parent sees the pending child, another parent does not
        self.assertEqual(
            client.get(f"/api/students/{student_id}/").status_code, 200
        )
        other = login(self.parent_b)
        self.assertEqual(other.get(f"/api/students/{student_id}/").status_code, 404)

        # school admin sees it in the pending queue and approves it
        admin_client = login(self.school_admin_a)
        pending = admin_client.get("/api/students/?pending=1")
        self.assertIn(
            str(student_id), [r["id"] for r in pending.data["results"]]
        )
        approve = admin_client.post(f"/api/students/{student_id}/approve/", {}, format="json")
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(approve.data["approval_status"], "APPROVED")

    def test_manual_add_rejected_when_roster_already_has_the_gr_number(self):
        Student.objects.create(
            name="On Roster",
            gr_number="GR-ROSTER-9",
            class_name="4",
            section="C",
            gender=Student.Gender.MALE,
            school=self.school_a,
            city=self.school_a.city,
        )
        client = login(self.parent_a)
        res = client.post(
            "/api/students/manual-add/",
            {
                "school": str(self.school_a.id),
                "name": "Duplicate Attempt",
                "gr_number": "GR-ROSTER-9",
                "class_name": "4",
                "section": "C",
                "gender": "MALE",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("claim", str(res.data).lower())

    def test_approve_requires_school_staff(self):
        student = Student.objects.create(
            name="Pending Child",
            gr_number="GR-PEND-1",
            class_name="2",
            section="A",
            gender=Student.Gender.FEMALE,
            school=self.school_a,
            city=self.school_a.city,
            parent=self.parent_a,
            approval_status=Student.ApprovalStatus.PENDING,
            source=Student.Source.PARENT_MANUAL,
        )
        parent_client = login(self.parent_a)
        self.assertEqual(
            parent_client.post(f"/api/students/{student.id}/approve/", {}, format="json").status_code,
            403,
        )
        # a teacher from another school cannot approve it either (scoped 404)
        other = login(self.school_admin_b)
        self.assertEqual(
            other.post(f"/api/students/{student.id}/approve/", {}, format="json").status_code,
            404,
        )


class ParentWriteRestrictionTests(StudentManagementTestBase):
    """
    Test suite proving every write request from a Parent to student, school,
    or order data is rejected with HTTP 403.
    """

    def setUp(self):
        super().setUp()
        self.parent_client = login(self.parent_a)
        self.student = Student.objects.filter(parent=self.parent_a).first()
        if not self.student:
            self.student = Student.objects.filter(school=self.school_a).first()

    def test_parent_cannot_create_student_via_standard_endpoint(self):
        res = self.parent_client.post(
            "/api/students/",
            {
                "name": "Intruder Kid",
                "gr_number": "GR-99999",
                "class_name": "5",
                "section": "A",
                "gender": "MALE",
                "school": str(self.school_a.id),
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_parent_cannot_update_student_via_put(self):
        res = self.parent_client.put(
            f"/api/students/{self.student.id}/",
            {
                "name": "Modified Child Name",
                "gr_number": self.student.gr_number,
                "class_name": "6",
                "section": "B",
                "gender": "MALE",
                "school": str(self.school_a.id),
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("Contact your school to correct this", str(res.data))

    def test_parent_cannot_patch_student(self):
        res = self.parent_client.patch(
            f"/api/students/{self.student.id}/",
            {"name": "Hacked Child Name"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("Contact your school to correct this", str(res.data))

    def test_parent_cannot_delete_student(self):
        res = self.parent_client.delete(f"/api/students/{self.student.id}/")
        self.assertEqual(res.status_code, 403)
        self.assertIn("Contact your school to correct this", str(res.data))

    def test_parent_cannot_create_or_modify_school(self):
        # Create school
        res_create = self.parent_client.post(
            "/api/schools/",
            {
                "name": "Parent School",
                "code": "PS-1",
                "city": str(self.school_a.city_id),
            },
            format="json",
        )
        self.assertEqual(res_create.status_code, 403)

        # Update school
        res_patch = self.parent_client.patch(
            f"/api/schools/{self.school_a.id}/",
            {"commission_rate": "0.50"},
            format="json",
        )
        self.assertEqual(res_patch.status_code, 403)

        # Delete school
        res_delete = self.parent_client.delete(f"/api/schools/{self.school_a.id}/")
        self.assertEqual(res_delete.status_code, 403)

    def test_parent_cannot_update_or_delete_placed_order(self):
        # Pick or create an order placed by this parent
        order = Order.objects.filter(parent=self.parent_a).first()
        if not order:
            from products.models import ProductVariant
            variant = ProductVariant.objects.first()
            order = Order.objects.create(
                parent=self.parent_a,
                student=self.student,
                school=self.school_a,
                city=self.school_a.city,
                subtotal=500,
                total=500,
            )

        res_patch = self.parent_client.patch(
            f"/api/orders/{order.id}/",
            {"status": "DELIVERED"},
            format="json",
        )
        self.assertEqual(res_patch.status_code, 403)
        self.assertIn("cannot edit or cancel an order", str(res_patch.data).lower())

        res_delete = self.parent_client.delete(f"/api/orders/{order.id}/")
        self.assertEqual(res_delete.status_code, 403)
        self.assertIn("cannot edit or cancel an order", str(res_delete.data).lower())


class RosterPhoneLinkingTests(StudentManagementTestBase):
    """A parent whose OTP-verified number is on the roster sees the child with no form."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.child = Student.objects.create(
            name="Roster Phone Child",
            gr_number="GR-RP-1",
            class_name="4",
            section="B",
            gender=Student.Gender.MALE,
            date_of_birth="2016-08-14",
            school=self.school_a,
            city=self.school_a.city,
            roster_phone="9820011223",
        )

    def test_otp_sign_in_creates_parent_and_links_roster_child(self):
        anon = APIClient()
        cache.set("otp:9820011223", "123456", timeout=300)
        res = anon.post(
            "/api/auth/otp/verify/", {"phone": "+91 98200 11223", "otp": "123456"}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["created"])
        self.assertEqual(res.data["children_linked"], 1)
        self.assertTrue(res.data["user"]["phone_verified"])
        self.child.refresh_from_db()
        self.assertEqual(str(self.child.parent_id), res.data["user"]["id"])

        # Signing in again returns the same account
        cache.set("otp:9820011223", "654321", timeout=300)
        again = anon.post("/api/auth/otp/verify/", {"phone": "9820011223", "otp": "654321"}, format="json")
        self.assertEqual(again.status_code, 200, again.data)
        self.assertFalse(again.data["created"])
        self.assertEqual(again.data["user"]["id"], res.data["user"]["id"])

    def test_wrong_otp_is_rejected_and_burned_after_five_tries(self):
        anon = APIClient()
        cache.set("otp:9820011223", "123456", timeout=300)
        # Four wrong tries already made; the fifth burns the code
        cache.set("otp_attempts:9820011223", 4, timeout=300)
        res = anon.post("/api/auth/otp/verify/", {"phone": "9820011223", "otp": "000000"}, format="json")
        self.assertEqual(res.status_code, 400)
        # The right code no longer works once it has been burned
        res = anon.post("/api/auth/otp/verify/", {"phone": "9820011223", "otp": "123456"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.child.refresh_from_db()
        self.assertIsNone(self.child.parent_id)

    def test_unverified_number_never_links(self):
        # Same number, but registered with a password (never confirmed by OTP)
        impostor = User.objects.create_user(
            username="impostor", password="x" * 12, role=User.Role.PARENT, phone="9820011223"
        )
        res = login(impostor).get("/api/students/")
        self.assertEqual(res.status_code, 200)
        self.child.refresh_from_db()
        self.assertIsNone(self.child.parent_id)

    def test_verified_parent_sees_child_on_list(self):
        parent = User.objects.create_user(
            username="verified_parent",
            password="x" * 12,
            role=User.Role.PARENT,
            phone="+919820011223",
            phone_verified=True,
        )
        res = login(parent).get("/api/students/")
        self.assertEqual(res.status_code, 200)
        names = [s["name"] for s in res.data["results"]]
        self.assertIn("Roster Phone Child", names)

    def test_child_already_linked_is_not_taken_over(self):
        self.child.parent = self.parent_a
        self.child.save()
        parent = User.objects.create_user(
            username="second_parent",
            password="x" * 12,
            role=User.Role.PARENT,
            phone="9820011223",
            phone_verified=True,
        )
        login(parent).get("/api/students/")
        self.child.refresh_from_db()
        self.assertEqual(self.child.parent_id, self.parent_a.id)

    def test_claim_by_gr_and_date_of_birth_still_works(self):
        res = login(self.parent_a).post(
            "/api/students/claim/",
            {"school": str(self.school_a.id), "gr_number": "GR-RP-1", "date_of_birth": "2016-08-14"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.child.refresh_from_db()
        self.assertEqual(self.child.parent_id, self.parent_a.id)
