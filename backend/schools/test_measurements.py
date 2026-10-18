"""Children's measurements for uniform sizing (Prompt 20): who may see and save them."""

from datetime import timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from orders.fit_retention import purge_old_measurements

from .models import City, School, Student, StudentMeasurement


def login(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(user)['access']}")
    return client


def url(student, latest=False):
    return f"/api/students/{student.id}/measurements/{'latest/' if latest else ''}"


GOOD = {"height_cm": 132.4, "weight_kg": 29, "shoulder_cm": 31.26, "shoulder_confidence": 0.81, "source": "CAMERA"}


class MeasurementTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.surat = City.objects.create(name="Surat", code="SUR")
        cls.ahmedabad = City.objects.create(name="Ahmedabad", code="AMD")
        cls.school = School.objects.create(city=cls.surat, name="Alpha School", code="ALPHA")
        cls.other_school = School.objects.create(city=cls.ahmedabad, name="Beta School", code="BETA")

        def user(username, role, **extra):
            return User.objects.create_user(username=f"m_{username}", password="x", role=role, **extra)

        cls.parent = user("parent_a", User.Role.PARENT)
        cls.other_parent = user("parent_b", User.Role.PARENT)
        cls.teacher = user("teacher_a", User.Role.TEACHER, school=cls.school, city=cls.surat)
        cls.other_teacher = user("teacher_b", User.Role.TEACHER, school=cls.other_school, city=cls.ahmedabad)
        cls.school_admin = user("sa_a", User.Role.SCHOOL_ADMIN, school=cls.school, city=cls.surat)
        cls.admin = user("admin_sur", User.Role.ADMIN, city=cls.surat)
        cls.other_admin = user("admin_amd", User.Role.ADMIN, city=cls.ahmedabad)
        cls.boss = user("boss", User.Role.BOSS)

        cls.child = Student.objects.create(
            name="Aarav", gr_number="GR1", class_name="5", section="A", school=cls.school, parent=cls.parent
        )
        cls.other_child = Student.objects.create(
            name="Diya", gr_number="GR2", class_name="5", section="A", school=cls.other_school, parent=cls.other_parent
        )


class SaveAndReadTests(MeasurementTestBase):
    def test_parent_saves_and_history_is_kept(self):
        client = login(self.parent)
        first = client.post(url(self.child), GOOD, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        body = first.json()  # numbers, not strings, in the JSON the phone reads
        self.assertEqual(body["height_cm"], 132.4)
        self.assertEqual(body["shoulder_cm"], 31.3)
        self.assertEqual(body["shoulder_confidence"], 0.81)
        self.assertEqual(first.data["measured_by_role"], "PARENT")

        second = client.post(url(self.child), {**GOOD, "shoulder_cm": 33, "shoulder_edited": True}, format="json")
        self.assertEqual(second.status_code, 201)
        self.assertEqual(StudentMeasurement.objects.filter(student=self.child).count(), 2)

        latest = client.get(url(self.child, latest=True))
        self.assertEqual(latest.data["id"], second.data["id"])
        self.assertTrue(latest.data["shoulder_edited"])

        history = client.get(url(self.child))
        self.assertEqual([row["id"] for row in history.data["results"]], [second.data["id"], first.data["id"]])

    def test_row_copies_the_childs_scope(self):
        login(self.parent).post(url(self.child), GOOD, format="json")
        row = StudentMeasurement.objects.get()
        self.assertEqual((row.school_id, row.city_id, row.parent_id), (self.school.id, self.surat.id, self.parent.id))
        self.assertEqual(row.measured_by, self.parent)

    def test_latest_is_empty_before_any_measurement(self):
        self.assertEqual(login(self.parent).get(url(self.child, latest=True)).status_code, 204)

    def test_teacher_of_the_school_saves_for_the_child(self):
        res = login(self.teacher).post(url(self.child), {**GOOD, "source": "MANUAL"}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        row = StudentMeasurement.objects.get()
        self.assertEqual((row.measured_by, row.measured_by_role), (self.teacher, "TEACHER"))

    def test_rows_cannot_be_edited_or_deleted_through_the_api(self):
        res = login(self.parent).post(url(self.child), GOOD, format="json")
        for method in ("put", "patch", "delete"):
            response = getattr(login(self.parent), method)(f"{url(self.child)}{res.data['id']}/", GOOD, format="json")
            self.assertIn(response.status_code, (403, 404, 405))
        self.assertEqual(StudentMeasurement.objects.count(), 1)


class ScopeTests(MeasurementTestBase):
    def test_who_can_read_the_childs_measurements(self):
        login(self.parent).post(url(self.child), GOOD, format="json")
        allowed = [self.parent, self.teacher, self.school_admin, self.admin, self.boss]
        denied = [self.other_parent, self.other_teacher, self.other_admin]
        for user in allowed:
            self.assertEqual(login(user).get(url(self.child)).status_code, 200, user.username)
        for user in denied:
            self.assertEqual(login(user).get(url(self.child)).status_code, 404, user.username)
            self.assertEqual(login(user).post(url(self.child), GOOD, format="json").status_code, 404, user.username)

    def test_anonymous_is_refused(self):
        self.assertEqual(APIClient().get(url(self.child)).status_code, 401)

    def test_parent_still_cannot_edit_the_student_record(self):
        res = login(self.parent).patch(f"/api/students/{self.child.id}/", {"name": "X"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_a_new_parent_link_moves_the_measurements(self):
        login(self.parent).post(url(self.child), GOOD, format="json")
        self.child.parent = self.other_parent
        self.child.save()
        self.assertEqual(StudentMeasurement.objects.get().parent, self.other_parent)
        self.assertEqual(login(self.parent).get(url(self.child)).status_code, 404)
        self.assertEqual(login(self.other_parent).get(url(self.child)).status_code, 200)

    def test_scoped_manager_filters_by_role(self):
        login(self.parent).post(url(self.child), GOOD, format="json")
        login(self.other_parent).post(url(self.other_child), GOOD, format="json")
        self.assertEqual(StudentMeasurement.objects.for_user(self.parent).count(), 1)
        self.assertEqual(StudentMeasurement.objects.for_user(self.admin).count(), 1)
        self.assertEqual(StudentMeasurement.objects.for_user(self.teacher).count(), 1)
        self.assertEqual(StudentMeasurement.objects.for_user(self.boss).count(), 2)


class ValidationTests(MeasurementTestBase):
    def post(self, body):
        return login(self.parent).post(url(self.child), body, format="json")

    def test_height_and_weight_limits(self):
        self.assertEqual(self.post({**GOOD, "height_cm": 69}).data["height_cm"], ["OUT_OF_RANGE"])
        self.assertEqual(self.post({**GOOD, "height_cm": 70}).status_code, 201)
        self.assertEqual(self.post({**GOOD, "weight_kg": 121}).data["weight_kg"], ["OUT_OF_RANGE"])
        self.assertEqual(self.post({**GOOD, "weight_kg": ""}).data["weight_kg"], ["REQUIRED"])
        self.assertEqual(self.post({**GOOD, "height_cm": "tall"}).data["height_cm"], ["NOT_A_NUMBER"])

    def test_camera_needs_a_shoulder_width(self):
        res = self.post({"height_cm": 130, "weight_kg": 28, "source": "CAMERA"})
        self.assertEqual(res.data["shoulder_cm"], ["REQUIRED"])
        self.assertEqual(self.post({**GOOD, "shoulder_cm": 90}).data["shoulder_cm"], ["OUT_OF_RANGE"])
        self.assertEqual(self.post({**GOOD, "shoulder_confidence": 2}).data["shoulder_confidence"], ["OUT_OF_RANGE"])

    def test_typed_measurement_may_skip_the_shoulder(self):
        res = self.post({"height_cm": 130, "weight_kg": 28, "source": "MANUAL"})
        self.assertEqual(res.status_code, 201, res.data)
        self.assertIsNone(res.data["shoulder_cm"])
        typed = self.post({"height_cm": 130, "weight_kg": 28, "shoulder_cm": 30, "source": "MANUAL", "shoulder_edited": True})
        self.assertIsNone(typed.data["shoulder_confidence"])
        self.assertFalse(typed.data["shoulder_edited"])

    def test_unknown_source(self):
        self.assertEqual(self.post({**GOOD, "source": "GUESS"}).data["source"], ["INVALID"])


@override_settings(MEASUREMENT_RETENTION_DAYS=365)
class RetentionTests(MeasurementTestBase):
    def test_old_measurements_are_deleted(self):
        now = timezone.now()
        old = StudentMeasurement.objects.create(
            student=self.child, height_cm=Decimal("120"), weight_kg=Decimal("24"), measured_at=now - timedelta(days=366)
        )
        fresh = StudentMeasurement.objects.create(
            student=self.child, height_cm=Decimal("130"), weight_kg=Decimal("27"), measured_at=now - timedelta(days=10)
        )
        self.assertEqual(purge_old_measurements(now=now, dry_run=True), 1)
        self.assertEqual(purge_old_measurements(now=now), 1)
        self.assertFalse(StudentMeasurement.objects.filter(pk=old.pk).exists())
        self.assertTrue(StudentMeasurement.objects.filter(pk=fresh.pk).exists())
