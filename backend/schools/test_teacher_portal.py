"""Teacher ID card portal: classes, student forms and private ID card photos."""

import io
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user

from .models import City, School, SchoolBranch, Student

MEDIA = tempfile.mkdtemp(prefix="teacher-portal-media-")


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
