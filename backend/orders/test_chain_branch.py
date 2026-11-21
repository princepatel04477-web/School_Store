import uuid

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import ProductVariant
from inventory.models import StockBalance
from schools.models import City, School, SchoolBranch, Student

from .models import Order

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM)
class ChainSchoolBranchOrderTests(TestCase):
    """
    A chain school (one uniform, a campus in many cities) has no city of its own.
    The parent picks a campus in the shop, so the order must use that campus's
    city for stock and price, even when the child was added without a campus.
    """

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.parent = User.objects.get(username="parent_rahul")
        cls.variant = ProductVariant.objects.filter(
            product__category__slug="school-shoes",
            product__school__isnull=True,
            active=True,
        ).first()
        assert cls.variant is not None, "seed data needs a shared school-shoes variant"

        cls.stocked_city = City.objects.create(name="Chainpur", code="CHN-T1", state="Uttar Pradesh")
        cls.other_city = City.objects.create(name="Otherpur", code="CHN-T2", state="Uttar Pradesh")
        cls.chain = School.objects.create(name="Test Chain Vidyalaya", code="TCV-TEST", city=None)
        cls.stocked_branch = SchoolBranch.objects.create(
            school=cls.chain, city=cls.stocked_city, name="Test Chain Vidyalaya Chainpur"
        )
        cls.other_branch = SchoolBranch.objects.create(
            school=cls.chain, city=cls.other_city, name="Test Chain Vidyalaya Otherpur"
        )
        # The catalogue shows stock for the Chainpur campus only.
        StockBalance.objects.create(city=cls.stocked_city, variant=cls.variant, stock_quantity=5)

        cls.other_school_branch = SchoolBranch.objects.create(
            school=School.objects.exclude(pk=cls.chain.pk).filter(city__isnull=False).first(),
            city=cls.stocked_city,
            name="Some other school Chainpur",
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        token = build_tokens_for_user(self.parent)["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        # Added by the parent by hand: school known, campus not.
        self.student = Student.objects.create(
            name="Chain Child",
            gr_number=f"TCV-{uuid.uuid4().hex[:8]}",
            class_name="5",
            section="A",
            gender=Student.Gender.MALE,
            school=self.chain,
            parent=self.parent,
            source=Student.Source.PARENT_MANUAL,
        )
        assert self.student.branch_id is None and self.student.city_id is None

    def _post(self, **extra):
        payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student.id),
            "fulfillment_type": "SCHOOL_PICKUP",
            "payment_method": "COD",
            "items": [{"variant": str(self.variant.id), "quantity": 1}],
            **extra,
        }
        return self.client.post("/api/orders/", payload, format="json")

    def _stock(self, city):
        return StockBalance.objects.get(city=city, variant=self.variant).stock_quantity

    def test_order_for_chain_school_uses_the_picked_campus(self):
        res = self._post(branch=str(self.stocked_branch.id))
        self.assertEqual(res.status_code, 201, res.json())
        order = Order.objects.get(pk=res.json()["id"])
        self.assertEqual(order.city_id, self.stocked_city.id)
        self.assertEqual(order.branch_id, self.stocked_branch.id)
        self.assertEqual(self._stock(self.stocked_city), 4)
        # The child is now recorded at that campus, so later orders and the
        # city admin see the right city.
        self.student.refresh_from_db()
        self.assertEqual(self.student.branch_id, self.stocked_branch.id)
        self.assertEqual(self.student.city_id, self.stocked_city.id)

    def test_chain_school_order_without_a_campus_is_refused_cleanly(self):
        res = self._post()
        self.assertEqual(res.status_code, 400, res.json())
        self.assertIn("branch", res.json())
        self.assertEqual(self._stock(self.stocked_city), 5)

    def test_campus_of_another_school_is_refused(self):
        res = self._post(branch=str(self.other_school_branch.id))
        self.assertEqual(res.status_code, 400, res.json())
        self.assertIn("branch", res.json())
        self.student.refresh_from_db()
        self.assertIsNone(self.student.branch_id)

    def test_campus_that_differs_from_the_childs_campus_is_refused(self):
        self.student.branch = self.other_branch
        self.student.save()
        res = self._post(branch=str(self.stocked_branch.id))
        self.assertEqual(res.status_code, 400, res.json())
        self.assertIn("branch", res.json())
        self.student.refresh_from_db()
        self.assertEqual(self.student.branch_id, self.other_branch.id)
        self.assertEqual(self._stock(self.stocked_city), 5)

    def test_campus_matching_the_childs_campus_is_accepted(self):
        self.student.branch = self.stocked_branch
        self.student.save()
        res = self._post(branch=str(self.stocked_branch.id))
        self.assertEqual(res.status_code, 201, res.json())
        self.assertEqual(Order.objects.get(pk=res.json()["id"]).city_id, self.stocked_city.id)

    def test_inactive_campus_is_refused(self):
        SchoolBranch.objects.filter(pk=self.stocked_branch.pk).update(active=False)
        res = self._post(branch=str(self.stocked_branch.id))
        self.assertEqual(res.status_code, 400, res.json())
        self.assertIn("branch", res.json())
        self.assertEqual(self._stock(self.stocked_city), 5)

    def test_campus_recorded_after_validation_is_rechecked(self):
        # Another first order recorded a different campus between this
        # request's validate() and create().
        from types import SimpleNamespace

        from rest_framework.exceptions import ValidationError

        from .serializers import OrderCreateSerializer

        serializer = OrderCreateSerializer(
            data={
                "idempotency_key": str(uuid.uuid4()),
                "student": str(self.student.id),
                "branch": str(self.stocked_branch.id),
                "fulfillment_type": "SCHOOL_PICKUP",
                "payment_method": "COD",
                "items": [{"variant": str(self.variant.id), "quantity": 1}],
            },
            context={"request": SimpleNamespace(user=self.parent)},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        other = Student.objects.get(pk=self.student.pk)
        other.branch = self.other_branch
        other.save()
        with self.assertRaises(ValidationError) as caught:
            serializer.save()
        self.assertIn("branch", caught.exception.detail)
        self.student.refresh_from_db()
        self.assertEqual(self.student.branch_id, self.other_branch.id)
        self.assertEqual(self._stock(self.stocked_city), 5)
        self.assertFalse(Order.objects.filter(student=self.student).exists())

    def test_failed_order_does_not_record_the_campus(self):
        StockBalance.objects.filter(city=self.stocked_city, variant=self.variant).update(stock_quantity=0)
        res = self._post(branch=str(self.stocked_branch.id))
        self.assertEqual(res.status_code, 400, res.json())
        self.student.refresh_from_db()
        self.assertIsNone(self.student.branch_id)


@override_settings(CACHES=LOCMEM)
class SchoolWithCityOrderTests(TestCase):
    """A school with its own city keeps working with or without a campus in the payload."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.parent = User.objects.get(username="parent_rahul")
        cls.student = Student.objects.get(gr_number="DPS-2026-001")  # DPS Surat
        cls.variant = ProductVariant.objects.filter(
            product__category__slug="school-shoes", active=True
        ).first()

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        token = build_tokens_for_user(self.parent)["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def _post(self, **extra):
        payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student.id),
            "fulfillment_type": "SCHOOL_PICKUP",
            "payment_method": "COD",
            "items": [{"variant": str(self.variant.id), "quantity": 1}],
            **extra,
        }
        return self.client.post("/api/orders/", payload, format="json")

    def test_order_without_branch_is_unchanged(self):
        before = Student.objects.get(pk=self.student.pk)
        res = self._post()
        self.assertEqual(res.status_code, 201, res.json())
        order = Order.objects.get(pk=res.json()["id"])
        expected_city = before.city_id or before.school.city_id
        self.assertEqual(order.city_id, expected_city)
        after = Student.objects.get(pk=self.student.pk)
        self.assertEqual(after.branch_id, before.branch_id)
        self.assertEqual(after.city_id, before.city_id)

    def test_null_branch_is_the_same_as_no_branch(self):
        res = self._post(branch=None)
        self.assertEqual(res.status_code, 201, res.json())
