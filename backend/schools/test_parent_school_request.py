import uuid
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from schools.models import City, ParentSchoolRequest

User = get_user_model()


class ParentSchoolRequestTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.city_surat = City.objects.filter(code="SUR").first() or City.objects.create(name="Surat", code="SUR", state="Gujarat", active=True)
        self.city_ahmedabad = City.objects.filter(code="AMD").first() or City.objects.create(name="Ahmedabad", code="AMD", state="Gujarat", active=True)

        self.boss_user = User.objects.filter(role=User.Role.BOSS).first()
        if not self.boss_user:
            self.boss_user = User.objects.create_user(
                username="boss_test_user_8",
                phone="9825990001",
                role="BOSS",
            )

        self.admin_surat = User.objects.filter(role=User.Role.ADMIN, city=self.city_surat).first()
        if not self.admin_surat:
            self.admin_surat = User.objects.create_user(
                username="admin_surat_test_8",
                phone="9825990002",
                role="ADMIN",
                city=self.city_surat,
            )

        self.admin_ahmedabad = User.objects.filter(role=User.Role.ADMIN, city=self.city_ahmedabad).first()
        if not self.admin_ahmedabad:
            self.admin_ahmedabad = User.objects.create_user(
                username="admin_amd_test_8",
                phone="9825990003",
                role="ADMIN",
                city=self.city_ahmedabad,
            )

        self.parent_user = User.objects.filter(role=User.Role.PARENT).first()
        if not self.parent_user:
            self.parent_user = User.objects.create_user(
                username="parent_test_user_8",
                phone="9825990004",
                role="PARENT",
            )

    def test_public_submission_success_and_city_linking(self):
        payload = {
            "parent_name": "Meera Patel",
            "phone": "9825012345",
            "email": "meera@example.com",
            "school_name": "St. Xavier's High School",
            "city_name": "Surat",
            "grade_or_class": "Class 4",
            "remarks": "Please add our sports uniform as well.",
        }
        res = self.client.post("/api/schools/request-school/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["school_name"], "St. Xavier's High School")
        self.assertEqual(res.data["city_name"], "Surat")
        self.assertEqual(res.data["status"], "PENDING")

        req = ParentSchoolRequest.objects.get(id=res.data["id"])
        self.assertEqual(req.parent_name, "Meera Patel")
        self.assertEqual(req.phone, "9825012345")
        self.assertEqual(req.city, self.city_surat)
        self.assertEqual(req.state_name, "Gujarat")
        self.assertEqual(req.status, ParentSchoolRequest.Status.PENDING)

    def test_public_submission_validation_errors(self):
        # Missing school_name
        res = self.client.post("/api/schools/request-school/", {"phone": "9825012345", "city_name": "Surat"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Invalid phone
        res = self.client.post("/api/schools/request-school/", {
            "school_name": "DPS",
            "city_name": "Surat",
            "phone": "123",
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("phone", res.data)

    def test_staff_role_scoping_and_review(self):
        req_surat = ParentSchoolRequest.objects.create(
            parent_name="Parent 1",
            phone="9825011111",
            school_name="Surat Model School",
            city_name="Surat",
            city=self.city_surat,
        )
        req_amd = ParentSchoolRequest.objects.create(
            parent_name="Parent 2",
            phone="9825022222",
            school_name="Ahmedabad Central School",
            city_name="Ahmedabad",
            city=self.city_ahmedabad,
        )

        # 1. Parent role has no access
        self.client.force_authenticate(user=self.parent_user)
        res = self.client.get("/api/panel/parent-school-requests/")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Boss sees both
        self.client.force_authenticate(user=self.boss_user)
        res = self.client.get("/api/panel/parent-school-requests/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [item["id"] for item in res.data["results"]] if isinstance(res.data, dict) and "results" in res.data else [item["id"] for item in res.data]
        self.assertIn(str(req_surat.id), ids)
        self.assertIn(str(req_amd.id), ids)

        # 3. City Admin for Surat sees only Surat
        self.client.force_authenticate(user=self.admin_surat)
        res = self.client.get("/api/panel/parent-school-requests/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        surat_ids = [item["id"] for item in res.data["results"]] if isinstance(res.data, dict) and "results" in res.data else [item["id"] for item in res.data]
        self.assertIn(str(req_surat.id), surat_ids)
        self.assertNotIn(str(req_amd.id), surat_ids)

        # 4. Review request
        patch_res = self.client.patch(
            f"/api/panel/parent-school-requests/{req_surat.id}/",
            {"status": "CONTACTED", "notes": "Spoke with principal, meeting scheduled."},
            format="json",
        )
        self.assertEqual(patch_res.status_code, status.HTTP_200_OK)
        req_surat.refresh_from_db()
        self.assertEqual(req_surat.status, "CONTACTED")
        self.assertEqual(req_surat.notes, "Spoke with principal, meeting scheduled.")
        self.assertEqual(req_surat.reviewed_by, self.admin_surat)
        self.assertIsNotNone(req_surat.reviewed_at)


class SupervisorReviewTests(TestCase):
    """Fixes added in the supervisor review of tasks 6 to 8."""

    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.client = APIClient()

    def tearDown(self):
        from django.core.cache import cache
        cache.clear()

    def test_school_request_is_rate_limited_per_ip(self):
        payload = {"phone": "9876500001", "school_name": "Test School", "city_name": "Surat"}
        codes = [self.client.post("/api/schools/request-school/", payload, format="json").status_code for _ in range(6)]
        self.assertEqual(codes[:5], [201] * 5)
        self.assertEqual(codes[5], 429)
        self.assertEqual(ParentSchoolRequest.objects.count(), 5)

    def test_basket_check_rejects_bad_quantities_without_crashing(self):
        bad = [{"variant": str(uuid.uuid4()), "quantity": "lots"}, {"variant": str(uuid.uuid4()), "quantity": 0}]
        resp = self.client.post("/api/cart/validate/", {"items": bad}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["valid"])
        self.assertIn("Quantity must be a whole number.", resp.data["errors"])
        self.assertIn("Quantity must be between 1 and 20.", resp.data["errors"])

    def test_basket_check_caps_line_count(self):
        many = [{"variant": str(uuid.uuid4()), "quantity": 1}] * 51
        resp = self.client.post("/api/cart/validate/", {"items": many}, format="json")
        self.assertEqual(resp.status_code, 400)