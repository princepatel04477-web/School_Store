import io
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from common.models import AuditLog
from schools.models import City, School

from .models import RetailStore, SchoolRequest

MEDIA = tempfile.mkdtemp()
UDISE = "24220100101"


def picture(fmt="PNG", size=(64, 64), name="logo.png"):
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buffer, format=fmt)
    content_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}[fmt]
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=content_type)


@override_settings(MEDIA_ROOT=MEDIA)
class RetailTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.surat = City.objects.create(name="Surat", code="SUR")
        cls.boss = User.objects.create_user(username="r_boss", password="x", role=User.Role.BOSS, is_superuser=True)
        cls.admin = User.objects.create_user(username="r_admin", password="x", role=User.Role.ADMIN, city=cls.surat)
        cls.parent = User.objects.create_user(username="r_parent", password="x", role=User.Role.PARENT)

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.store = self.make_store("shop1")

    def make_store(self, username):
        owner = User.objects.create_user(username=username, password="x", role=User.Role.RETAILER, city=self.surat)
        return RetailStore.objects.create(owner=owner, name=f"{username} Uniforms", address="Ring Road", phone="9876543210", city=self.surat)

    def client_for(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(user)['access']}")
        return client

    def send_request(self, store=None, **overrides):
        store = store or self.store
        data = {
            "name": "Shree Vidya  Mandir",
            "udise_code": UDISE,
            "address": "Adajan, Surat",
            "city": str(self.surat.id),
            "board": "GSEB",
            "pincode": "395009",
            "logo": picture(),
            **overrides,
        }
        return self.client_for(store.owner).post("/api/retail/school-requests/", data, format="multipart")

    # --- creating retailers -------------------------------------------------

    def test_boss_creates_a_retailer_with_their_shop(self):
        res = self.client_for(self.boss).post(
            "/api/retail/retailers/",
            {
                "username": "newshop",
                "password": "Secret@123",
                "store_name": "New Shop",
                "address": "Station Road",
                "phone": "9876500000",
                "gst_number": "24aaacb1234c1z5",
                "city": str(self.surat.id),
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        user = User.objects.get(username="newshop")
        self.assertEqual(user.role, User.Role.RETAILER)
        self.assertTrue(user.must_change_password)
        self.assertEqual(user.retail_store.gst_number, "24AAACB1234C1Z5")

    def test_only_boss_creates_retailers(self):
        for user in (self.admin, self.store.owner, self.parent):
            res = self.client_for(user).post("/api/retail/retailers/", {}, format="json")
            self.assertEqual(res.status_code, 403)

    # --- sending requests ---------------------------------------------------

    def test_retailer_sends_a_request(self):
        res = self.send_request()
        self.assertEqual(res.status_code, 201, res.data)
        request_obj = SchoolRequest.objects.get()
        self.assertEqual(request_obj.status, SchoolRequest.Status.PENDING)
        self.assertEqual(request_obj.name, "Shree Vidya Mandir")
        self.assertNotIn("logo", res.data)

    def test_request_fields_are_checked(self):
        res = self.send_request(udise_code="1234", pincode="012345")
        self.assertEqual(res.status_code, 400)
        self.assertIn("udise_code", res.data)
        self.assertIn("pincode", res.data)

    def test_logo_must_be_a_real_png_jpg_or_webp(self):
        self.assertEqual(self.send_request(logo=picture("JPEG", name="a.jpg")).status_code, 201)
        res = self.send_request(store=self.make_store("shop2"), logo=picture("GIF", name="a.gif"))
        self.assertEqual(res.status_code, 400)
        self.assertIn("logo", res.data)
        svg = SimpleUploadedFile("a.svg", b"<svg onload='alert(1)'></svg>", content_type="image/svg+xml")
        res = self.send_request(store=self.make_store("shop3"), logo=svg)
        self.assertEqual(res.status_code, 400)

    def test_logo_over_2mb_is_refused(self):
        big = SimpleUploadedFile("big.png", b"\x89PNG" + b"0" * (2 * 1024 * 1024 + 1), content_type="image/png")
        self.assertEqual(self.send_request(logo=big).status_code, 400)

    def test_same_school_twice_while_pending_is_refused(self):
        self.assertEqual(self.send_request().status_code, 201)
        res = self.send_request()
        self.assertEqual(res.status_code, 400)
        self.assertIn("udise_code", res.data)

    def test_only_retailers_send_requests(self):
        for user in (self.boss, self.admin, self.parent):
            res = self.client_for(user).post("/api/retail/school-requests/", {}, format="multipart")
            self.assertEqual(res.status_code, 403)

    def test_switched_off_shop_cannot_send_requests(self):
        self.store.active = False
        self.store.save()
        self.assertEqual(self.send_request().status_code, 403)

    def test_retailer_sees_only_their_own_requests(self):
        other = self.make_store("shop2")
        self.send_request()
        self.send_request(store=other)
        res = self.client_for(self.store.owner).get("/api/retail/school-requests/")
        self.assertEqual([row["store"] for row in res.data["results"]], [self.store.id])
        res = self.client_for(self.boss).get("/api/retail/school-requests/?status=PENDING")
        self.assertEqual(len(res.data["results"]), 2)

    def test_other_roles_see_no_requests(self):
        self.send_request()
        for user in (self.admin, self.parent):
            self.assertEqual(self.client_for(user).get("/api/retail/school-requests/").status_code, 403)

    # --- Boss decisions -----------------------------------------------------

    def approve(self, request_id, **body):
        return self.client_for(self.boss).post(f"/api/retail/school-requests/{request_id}/approve/", body, format="json")

    def test_approve_creates_a_hidden_school_and_gives_it_to_the_shop(self):
        request_id = self.send_request().data["id"]
        res = self.approve(request_id)
        self.assertEqual(res.status_code, 200, res.data)
        school = School.objects.get(udise_code=UDISE)
        self.assertEqual(school.name, "Shree Vidya Mandir")
        self.assertEqual(school.code, f"UDISE-{UDISE}")
        self.assertFalse(school.active)
        self.assertTrue(school.logo)
        self.assertIn(school, self.store.schools.all())
        self.assertEqual(res.data["status"], "APPROVED")
        self.assertTrue(AuditLog.objects.filter(action=AuditLog.Action.SCHOOL_REQUEST_APPROVED).exists())

    def test_second_shop_is_linked_to_the_same_school(self):
        first = self.send_request().data["id"]
        self.approve(first)
        other = self.make_store("shop2")
        second = self.send_request(store=other).data["id"]
        listed = self.client_for(self.boss).get("/api/retail/school-requests/?status=PENDING").data["results"]
        self.assertEqual(listed[0]["existing_school"]["name"], "Shree Vidya Mandir")
        self.assertEqual(self.approve(second, use_new_logo=False).status_code, 200)
        self.assertEqual(School.objects.filter(udise_code=UDISE).count(), 1)
        self.assertEqual(other.schools.get().udise_code, UDISE)

    def test_approve_can_link_an_older_school_without_a_udise_code(self):
        older = School.objects.create(name="Shree Vidya Mandir", code="SVM-SUR", city=self.surat)
        request_id = self.send_request().data["id"]
        self.assertEqual(self.approve(request_id, school=str(older.id)).status_code, 200)
        older.refresh_from_db()
        self.assertEqual(older.udise_code, UDISE)
        self.assertEqual(older.pincode, "395009")
        self.assertTrue(older.logo)
        self.assertEqual(School.objects.count(), 1)

    def test_cannot_link_a_school_that_has_another_udise_code(self):
        other = School.objects.create(name="Other", code="OTH", city=self.surat, udise_code="24220100999")
        request_id = self.send_request().data["id"]
        self.assertEqual(self.approve(request_id, school=str(other.id)).status_code, 400)
        self.assertEqual(SchoolRequest.objects.get().status, SchoolRequest.Status.PENDING)

    def test_reject_needs_a_reason_and_the_retailer_sees_it(self):
        request_id = self.send_request().data["id"]
        url = f"/api/retail/school-requests/{request_id}/reject/"
        self.assertEqual(self.client_for(self.boss).post(url, {"reason": " "}, format="json").status_code, 400)
        res = self.client_for(self.boss).post(url, {"reason": "UDISE code not found"}, format="json")
        self.assertEqual(res.status_code, 200)
        mine = self.client_for(self.store.owner).get("/api/retail/school-requests/").data["results"][0]
        self.assertEqual(mine["status"], "REJECTED")
        self.assertEqual(mine["reject_reason"], "UDISE code not found")
        self.assertFalse(School.objects.exists())

    def test_a_decided_request_cannot_be_decided_again(self):
        request_id = self.send_request().data["id"]
        self.approve(request_id)
        self.assertEqual(self.approve(request_id).status_code, 409)
        res = self.client_for(self.boss).post(f"/api/retail/school-requests/{request_id}/reject/", {"reason": "x"}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_only_boss_decides(self):
        request_id = self.send_request().data["id"]
        for user in (self.admin, self.store.owner):
            res = self.client_for(user).post(f"/api/retail/school-requests/{request_id}/approve/", {}, format="json")
            self.assertEqual(res.status_code, 403)

    def test_after_rejection_the_school_can_be_sent_again(self):
        request_id = self.send_request().data["id"]
        self.client_for(self.boss).post(f"/api/retail/school-requests/{request_id}/reject/", {"reason": "Blurry logo"}, format="json")
        self.assertEqual(self.send_request().status_code, 201)

    # --- logos and the shop -------------------------------------------------

    def test_request_logo_is_private_and_school_logo_is_public(self):
        request_id = self.send_request().data["id"]
        url = f"/api/retail/school-requests/{request_id}/logo/"
        self.assertEqual(self.client_for(self.store.owner).get(url).status_code, 200)
        self.assertEqual(self.client_for(self.boss).get(url).status_code, 200)
        self.assertEqual(self.client_for(self.make_store("shop2").owner).get(url).status_code, 404)
        self.assertEqual(APIClient().get(url).status_code, 401)

        self.approve(request_id)
        school = School.objects.get(udise_code=UDISE)
        res = APIClient().get(f"/api/public/schools/{school.id}/logo/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("max-age", res["Cache-Control"])

    def test_retailer_reads_the_active_cities(self):
        City.objects.create(name="Closed", code="CLO", active=False)
        res = self.client_for(self.store.owner).get("/api/retail/cities/")
        self.assertEqual([c["name"] for c in res.data], ["Surat"])
        self.assertEqual(self.client_for(self.parent).get("/api/retail/cities/").status_code, 403)

    def test_my_store_lists_approved_schools(self):
        self.approve(self.send_request().data["id"])
        res = self.client_for(self.store.owner).get("/api/retail/my-store/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["schools"][0]["udise_code"], UDISE)
        self.assertEqual(self.client_for(self.parent).get("/api/retail/my-store/").status_code, 403)
