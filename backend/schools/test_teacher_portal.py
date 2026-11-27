"""Teacher ID card portal: classes, student forms and private ID card photos."""

import io
import shutil
import tempfile
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user

from .models import City, School, SchoolBranch, Student

MEDIA = Path(tempfile.mkdtemp(prefix="teacher-portal-media-"))


def login(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(user)['access']}")
    return client


def jpeg(name="kid.jpg", size=(60, 80)):
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 180, 160)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=MEDIA)
class TeacherPortalTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.city = City.objects.create(name="Surat", code="SUR")
        cls.school = School.objects.create(city=cls.city, name="Alpha School", code="ALPHA")
        cls.other_school = School.objects.create(city=cls.city, name="Beta School", code="BETA")
        cls.branch = SchoolBranch.objects.create(school=cls.school, city=cls.city, name="North")
        cls.other_branch = SchoolBranch.objects.create(school=cls.school, city=cls.city, name="South")

        def user(username, role, **extra):
            return User.objects.create_user(username=f"tp_{username}", password="x", role=role, **extra)

        cls.boss = user("boss", User.Role.BOSS)
        cls.teacher = user("teacher", User.Role.TEACHER, school=cls.school, city=cls.city, branch=cls.branch)
        cls.other_teacher = user("other", User.Role.TEACHER, school=cls.other_school, city=cls.city)
        cls.parent = user("parent", User.Role.PARENT)
        cls.child = Student.objects.create(
            name="Aarav", gr_number="GR1", class_name="1", section="A",
            school=cls.school, branch=cls.branch, city=cls.city, parent=cls.parent,
        )

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def photo_url(self, student=None):
        return f"/api/students/{(student or self.child).id}/photo/"

    def test_boss_creates_teacher_with_six_digit_login(self):
        res = login(self.boss).post(
            "/api/auth/users/create-teacher/",
            {"first_name": "Ramesh", "school": str(self.school.id), "branch": str(self.branch.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(len(res.data["username"]), 6)
        self.assertEqual(len(res.data["issued_password"]), 6)
        token = APIClient().post(
            "/api/auth/token/",
            {"username": res.data["username"], "password": res.data["issued_password"]},
            format="json",
        )
        self.assertEqual(token.status_code, 200)

    def test_teacher_adds_sections_and_duplicate_is_refused(self):
        client = login(self.teacher)
        for section in ("A", "b"):
            res = client.post("/api/classes/", {"class_name": "1", "section": section}, format="json")
            self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["label"], "1B")
        self.assertEqual(res.data["branch"], self.branch.id)
        again = client.post("/api/classes/", {"class_name": "1", "section": "A"}, format="json")
        self.assertEqual(again.status_code, 400)
        labels = [row["label"] for row in client.get("/api/classes/").data["results"]]
        self.assertEqual(labels, ["1A", "1B"])
        self.assertEqual(login(self.other_teacher).get("/api/classes/").data["results"], [])

    def test_teacher_fills_the_form_of_an_existing_student(self):
        res = login(self.teacher).patch(
            f"/api/students/{self.child.id}/",
            {"blood_group": "B+", "father_or_guardian_name": "Mahesh", "address": "Adajan, Surat"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.child.refresh_from_db()
        self.assertEqual(self.child.blood_group, "B+")
        other = login(self.other_teacher).patch(f"/api/students/{self.child.id}/", {"address": "x"}, format="json")
        self.assertEqual(other.status_code, 404)

    def test_photo_needs_parent_consent_tick(self):
        res = login(self.teacher).post(self.photo_url(), {"photo": jpeg()}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertIn("consent", res.data)

    def test_photo_upload_is_private_and_viewable_in_scope(self):
        teacher = login(self.teacher)
        res = teacher.post(self.photo_url(), {"photo": jpeg("Aarav GR1.jpg"), "consent": "1"}, format="multipart")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["photo_url"].startswith(f"/api/students/{self.child.id}/photo/"))
        self.assertIsNotNone(res.data["photo_consent_at"])
        self.child.refresh_from_db()
        self.assertNotIn("Aarav", self.child.photo.name)
        self.assertEqual(self.child.photo_consent_by_id, self.teacher.id)

        shown = teacher.get(self.photo_url())
        self.assertEqual(shown.status_code, 200)
        self.assertEqual(shown["Content-Type"], "image/jpeg")
        # Never kept in the browser cache of a shared school phone.
        self.assertIn("no-store", shown["Cache-Control"])
        self.assertEqual(login(self.parent).get(self.photo_url()).status_code, 200)
        self.assertEqual(login(self.other_teacher).get(self.photo_url()).status_code, 404)
        self.assertEqual(APIClient().get(self.photo_url()).status_code, 401)

    def test_replacing_a_photo_removes_the_old_file(self):
        teacher = login(self.teacher)
        teacher.post(self.photo_url(), {"photo": jpeg(), "consent": "1"}, format="multipart")
        self.child.refresh_from_db()
        first = self.child.photo.name
        teacher.post(self.photo_url(), {"photo": jpeg(), "consent": "1"}, format="multipart")
        self.child.refresh_from_db()
        self.assertNotEqual(first, self.child.photo.name)
        self.assertFalse(self.child.photo.storage.exists(first))

    def test_bad_files_are_refused(self):
        teacher = login(self.teacher)
        fake = SimpleUploadedFile("x.jpg", b"not an image", content_type="image/jpeg")
        self.assertEqual(teacher.post(self.photo_url(), {"photo": fake, "consent": "1"}, format="multipart").status_code, 400)
        pdf = SimpleUploadedFile("x.pdf", b"%PDF-1.4", content_type="application/pdf")
        self.assertEqual(teacher.post(self.photo_url(), {"photo": pdf, "consent": "1"}, format="multipart").status_code, 400)

    def test_parent_cannot_change_photo_but_staff_can_remove_it(self):
        teacher = login(self.teacher)
        teacher.post(self.photo_url(), {"photo": jpeg(), "consent": "1"}, format="multipart")
        self.assertEqual(
            login(self.parent).post(self.photo_url(), {"photo": jpeg(), "consent": "1"}, format="multipart").status_code,
            403,
        )
        removed = teacher.delete(self.photo_url())
        self.assertEqual(removed.status_code, 200)
        self.assertIsNone(removed.data["photo_url"])
        self.assertEqual(teacher.get(self.photo_url()).status_code, 404)

    def test_parent_photo_delete_request_also_removes_id_card_photo(self):
        login(self.teacher).post(self.photo_url(), {"photo": jpeg(), "consent": "1"}, format="multipart")
        res = login(self.parent).post("/api/orders/photo-consent/delete/", {"student_id": str(self.child.id)}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.child.refresh_from_db()
        self.assertFalse(self.child.photo)
        self.assertIsNone(self.child.photo_consent_at)

    def presign(self, client, **extra):
        return client.post(
            "/api/orders/customisation-upload-url/",
            {"content_type": "image/jpeg", "file_size": 400000, "student_id": str(self.child.id),
             "purpose": "ID_CARD", **extra},
            format="json",
        )

    def test_teacher_id_card_order_photo_needs_school_consent_once(self):
        teacher = login(self.teacher)
        self.assertEqual(self.presign(teacher).status_code, 403)
        first = self.presign(teacher, school_consent=True)
        self.assertEqual(first.status_code, 200, first.data)
        self.child.refresh_from_db()
        self.assertEqual(self.child.photo_consent_by_id, self.teacher.id)
        self.assertEqual(self.presign(teacher).status_code, 200)

    def test_teacher_outside_scope_cannot_get_upload_url(self):
        self.assertEqual(self.presign(login(self.other_teacher), school_consent=True).status_code, 403)
        sibling = User.objects.create_user(
            username="tp_branch2", password="x", role=User.Role.TEACHER,
            school=self.school, city=self.city, branch=self.other_branch,
        )
        self.assertEqual(self.presign(login(sibling), school_consent=True).status_code, 403)


@override_settings(MEDIA_ROOT=MEDIA, CUSTOMISATION_LOCAL_DIR=MEDIA / "customisations")
class TeacherPortalPolishTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        TeacherPortalTests.setUpTestData.__func__(cls)

    def test_class_tiles_show_student_and_photo_counts(self):
        teacher = login(self.teacher)
        teacher.post("/api/classes/", {"class_name": "1", "section": "A"}, format="json")
        teacher.post("/api/classes/", {"class_name": "2", "section": "A"}, format="json")
        Student.objects.create(
            name="Bina", gr_number="GR9", class_name="Class 1", section="A",
            school=self.school, branch=self.branch, city=self.city,
        )
        rows = {r["label"]: r for r in teacher.get("/api/classes/").data["results"]}
        self.assertEqual(rows["1A"]["student_count"], 2)
        self.assertEqual(rows["1A"]["photo_count"], 0)
        self.assertEqual(rows["2A"]["student_count"], 0)

    def test_class_with_students_cannot_be_removed_but_empty_one_can(self):
        teacher = login(self.teacher)
        full = teacher.post("/api/classes/", {"class_name": "1", "section": "A"}, format="json").data
        empty = teacher.post("/api/classes/", {"class_name": "3", "section": "C"}, format="json").data
        self.assertEqual(teacher.delete(f"/api/classes/{full['id']}/").status_code, 400)
        self.assertEqual(teacher.delete(f"/api/classes/{empty['id']}/").status_code, 204)
        labels = [r["label"] for r in teacher.get("/api/classes/").data["results"]]
        self.assertEqual(labels, ["1A"])

    def test_removing_a_student_with_an_order_hides_them_without_crashing(self):
        teacher = login(self.teacher)
        res = teacher.delete(f"/api/students/{self.child.id}/")
        self.assertEqual(res.status_code, 204)
        self.child.refresh_from_db()
        self.assertFalse(self.child.active)
        self.assertEqual(teacher.get("/api/students/?class=1").data["count"], 0)

    def test_removing_a_student_deletes_their_id_card_photo(self):
        teacher = login(self.teacher)
        teacher.post(f"/api/students/{self.child.id}/photo/", {"photo": jpeg(), "consent": "1"}, format="multipart")
        self.child.refresh_from_db()
        stored = self.child.photo.name
        self.assertTrue(self.child.photo.storage.exists(stored))
        self.assertEqual(teacher.delete(f"/api/students/{self.child.id}/").status_code, 204)
        self.child.refresh_from_db()
        self.assertFalse(self.child.photo)
        self.assertIsNone(self.child.photo_consent_at)
        self.assertFalse(self.child.photo.storage.exists(stored))

    def test_student_rows_carry_city_name(self):
        row = login(self.teacher).get(f"/api/students/{self.child.id}/").data
        self.assertEqual(row["city_name"], "Surat")

    def test_order_reuses_the_photo_from_the_students_form(self):
        teacher = login(self.teacher)
        url = "/api/orders/customisation-from-student-photo/"
        body = {"student_id": str(self.child.id), "purpose": "ID_CARD"}
        self.assertEqual(teacher.post(url, body, format="json").status_code, 400)
        teacher.post(f"/api/students/{self.child.id}/photo/", {"photo": jpeg(), "consent": "1"}, format="multipart")
        res = teacher.post(url, body, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data["file_key"].startswith("customisations/"))
        self.assertEqual(login(self.other_teacher).post(url, body, format="json").status_code, 403)
        self.assertEqual(login(self.parent).post(url, body, format="json").status_code, 403)

    def _token_pair(self, user):
        from accounts.serializers import build_tokens_for_user
        return build_tokens_for_user(user)

    def test_pausing_a_teacher_signs_them_out_everywhere(self):
        import time
        tokens = self._token_pair(self.teacher)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(client.get("/api/classes/").status_code, 200)
        time.sleep(1.1)
        res = login(self.boss).patch(f"/api/auth/users/{self.teacher.id}/", {"is_active": False}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(client.get("/api/classes/").status_code, 401)
        refresh = APIClient().post("/api/auth/token/refresh/", {"refresh": tokens["refresh"]}, format="json")
        self.assertEqual(refresh.status_code, 401)

    def test_new_password_ends_old_sessions_but_new_login_works(self):
        import time
        old = self._token_pair(self.teacher)
        time.sleep(1.1)
        res = login(self.boss).post(f"/api/auth/users/{self.teacher.id}/regenerate-password/")
        self.assertEqual(res.status_code, 200, res.data)
        stale = APIClient()
        stale.credentials(HTTP_AUTHORIZATION=f"Bearer {old['access']}")
        self.assertEqual(stale.get("/api/classes/").status_code, 401)
        self.assertEqual(
            APIClient().post("/api/auth/token/refresh/", {"refresh": old["refresh"]}, format="json").status_code, 401
        )
        time.sleep(1.1)
        fresh = APIClient().post(
            "/api/auth/token/", {"username": self.teacher.username, "password": res.data["issued_password"]}, format="json"
        )
        self.assertEqual(fresh.status_code, 200)
        ok = APIClient()
        ok.credentials(HTTP_AUTHORIZATION=f"Bearer {fresh.data['access']}")
        self.assertEqual(ok.get("/api/classes/").status_code, 200)
