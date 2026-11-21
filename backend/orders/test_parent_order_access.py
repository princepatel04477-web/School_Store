"""
What a parent's account page reads (ported from the website line, review 2026-11-21):
the order list says which child each order is for, and a child carries the
campus city name.
"""

from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from orders.models import Order
from schools.models import City, School, Student


class ParentOrderListTests(TestCase):
    def setUp(self):
        self.city = City.objects.create(name="Pune", code="PNQ")
        self.school = School.objects.create(name="DPS Pune", code="DPS-PNQ", city=self.city)
        self.parent_a = User.objects.create_user(
            username="parent_a_pnq", password="Pass123456!", role="PARENT", city=self.city, school=self.school
        )
        self.parent_b = User.objects.create_user(
            username="parent_b_pnq", password="Pass123456!", role="PARENT", city=self.city, school=self.school
        )
        self.child_a = Student.objects.create(
            name="Child A", gr_number="PNQ-A1", class_name="4", section="A", school=self.school, parent=self.parent_a
        )
        self.child_b = Student.objects.create(
            name="Child B", gr_number="PNQ-B1", class_name="5", section="B", school=self.school, parent=self.parent_b
        )
        self.order_a = Order.objects.create(
            order_number="SS-PNQ-A1", student=self.child_a, placed_by=self.parent_a,
            subtotal=Decimal("300.00"), total=Decimal("300.00"),
        )
        self.order_b = Order.objects.create(
            order_number="SS-PNQ-B1", student=self.child_b, placed_by=self.parent_b,
            subtotal=Decimal("200.00"), total=Decimal("200.00"),
        )

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_order_list_names_the_child_and_only_shows_own_orders(self):
        res = self._client(self.parent_a).get("/api/orders/")
        self.assertEqual(res.status_code, 200)
        results = res.data["results"] if isinstance(res.data, dict) else res.data
        numbers = {row["order_number"] for row in results}
        self.assertIn(self.order_a.order_number, numbers)
        self.assertNotIn(self.order_b.order_number, numbers)
        row = next(r for r in results if r["order_number"] == self.order_a.order_number)
        # The account page matches an order to the child it is for on this field
        self.assertEqual(str(row["student"]), str(self.child_a.id))

    def test_children_carry_city_name(self):
        res = self._client(self.parent_a).get("/api/students/")
        self.assertEqual(res.status_code, 200)
        rows = res.data["results"]
        self.assertEqual({str(r["id"]) for r in rows}, {str(self.child_a.id)})
        self.assertEqual(rows[0]["city_name"], "Pune")
