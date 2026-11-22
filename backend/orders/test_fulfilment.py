from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import User
from schools.models import City

from .models import Order, OrderStatusEvent, PaymentReview, Shipment
from .test_razorpay_checkout import RazorpayTestBase


class FulfilmentTests(RazorpayTestBase):
    def setUp(self):
        super().setUp()
        self.staff = APIClient()
        self.staff.force_authenticate(self.city_admin)

    def act(self, order, command, data=None, client=None):
        return (client or self.staff).post(
            reverse("fulfilment-action", args=[order.pk, command]), data or {}, format="json",
        )

    def pack(self, order):
        for command, values in (
            ("claim", {}),
            ("confirm", {"item_id": str(order.items.get().pk), "confirmed": True}),
            ("pack", {}),
        ):
            response = self.act(order, command, values)
            self.assertEqual(response.status_code, 200, response.json())

    def test_retries_and_case_only_correction_have_single_history_entries(self):
        order = self.make_order(payment_method=Order.PaymentMethod.CASH_ON_DELIVERY)
        self.pack(order)
        self.assertEqual(self.act(order, "pack").status_code, 200)
        booking = {"article_number": "AB-123", "receipt_confirmed": True}
        for _ in range(2):
            response = self.act(order, "handover", booking)
            self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(OrderStatusEvent.objects.filter(order=order, status=Order.Status.PACKED).count(), 1)
        self.assertEqual(OrderStatusEvent.objects.filter(order=order, status=Order.Status.DISPATCHED).count(), 1)

        corrected = self.act(order, "correct", {"article_number": "ab 123", "reason": "Staff-only receipt note"})
        self.assertEqual(corrected.status_code, 200, corrected.json())
        self.assertEqual(len(corrected.data["corrections"]), 1)
        parent = self.parent_client.get(reverse("order-detail", args=[order.pk])).json()
        self.assertEqual(parent["tracking"]["article_number"], "ab 123")
        self.assertNotIn("Staff-only receipt note", str(parent))
        self.assertTrue(all(set(event) == {"status", "timestamp"} for event in parent["status_events"]))
        self.assertNotIn("payment_reviews", parent)
        self.assertNotIn("razorpay_payment_id", parent)

    def test_handover_validation_and_duplicate_article_number(self):
        first = self.make_order(payment_method=Order.PaymentMethod.CASH_ON_DELIVERY)
        second = self.make_order(payment_method=Order.PaymentMethod.CASH_ON_DELIVERY)
        self.pack(first)
        self.pack(second)
        for values in (
            {"article_number": 12345},
            {"article_number": " "},
            {"article_number": "X" * 41},
            {"article_number": "AB123", "receipt_confirmed": "false"},
            {"article_number": "AB123", "booked_at": "2000-01-01"},
        ):
            response = self.act(first, "handover", {"receipt_confirmed": True, **values})
            self.assertEqual(response.status_code, 400, response.json())
        self.assertEqual(self.act(first, "handover", {
            "article_number": "AB-123", "receipt_confirmed": True,
        }).status_code, 200)
        duplicate = self.act(second, "handover", {"article_number": "ab 123", "receipt_confirmed": True})
        self.assertEqual(duplicate.status_code, 409, duplicate.json())
        self.assertEqual(duplicate.data["code"], "DUPLICATE_ARTICLE_NUMBER")
        second.refresh_from_db()
        self.assertEqual(second.status, Order.Status.PACKED)
        self.assertEqual(Shipment.objects.count(), 1)

    def test_packing_gate_scope_claim_and_pickup(self):
        unpaid = self.make_order()
        response = self.act(unpaid, "claim")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "PAYMENT_NOT_PAID")
        pickup = self.make_order(
            payment_status=Order.PaymentStatus.PAID,
            fulfillment_type=Order.FulfillmentType.SCHOOL_PICKUP,
        )
        review = PaymentReview.objects.create(order=pickup, reason=PaymentReview.Reason.REFUND_AFTER_RELEASE)
        self.assertEqual(self.act(pickup, "claim").data["code"], "PAYMENT_REVIEW_OPEN")
        review.delete()

        outsider = APIClient()
        other_city = City.objects.create(name="Other fulfilment city", code="OTF")
        outsider.force_authenticate(User.objects.create_user(username="other-city-staff", role="ADMIN", city=other_city))
        self.assertEqual(self.act(pickup, "claim", client=outsider).status_code, 404)
        self.assertEqual(outsider.get(reverse("fulfilment-queue")).data["results"], [])
        self.assertEqual(self.act(pickup, "claim").status_code, 200)
        self.assertEqual(self.act(pickup, "claim").status_code, 200)
        outsider.force_authenticate(self.boss)
        self.assertEqual(self.act(pickup, "claim", client=outsider).status_code, 409)
        self.pack(pickup)
        self.assertEqual(self.act(pickup, "pickup").status_code, 200)
        self.assertEqual(self.act(pickup, "pickup").status_code, 200)
        parent = self.parent_client.get(reverse("order-detail", args=[pickup.pk])).json()
        self.assertEqual(parent["status"], Order.Status.DELIVERED)
        self.assertIsNone(parent["tracking"])

        shipped = self.make_order(status=Order.Status.SHIPPED)
        sent = self.staff.get(reverse("fulfilment-queue"), {"tab": "sent"}).json()["results"]
        self.assertIn(str(shipped.pk), {str(row["id"]) for row in sent})
