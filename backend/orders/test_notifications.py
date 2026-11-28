"""Tests for FCM push notification tokens, status triggers, and opt-out preferences."""

import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from orders.fcm import format_notification, send_order_push
from orders.models import DeviceToken, Order, OrderItem
from orders.status import change_order_status
from schools.models import City, School, Student


class PushNotificationTests(TestCase):
    def setUp(self):
        uid = uuid.uuid4().hex[:6]
        self.city = City.objects.create(name=f"City_{uid}", code=f"C{uid[:3].upper()}")
        self.school = School.objects.create(name=f"School_{uid}", code=f"S{uid[:3].upper()}", city=self.city)
        self.admin = User.objects.create_user(
            username=f"admin_notif_{uid}", password="Pass123456!", role="ADMIN", city=self.city
        )
        self.parent = User.objects.create_user(
            username=f"parent_notif_{uid}",
            password="Pass123456!",
            role="PARENT",
            city=self.city,
            school=self.school,
            notify_order_updates=True,
        )
        self.student = Student.objects.create(
            name="Rahul Sharma",
            gr_number=f"GR-{uid}",
            class_name="5",
            section="B",
            school=self.school,
            parent=self.parent,
        )
        category = Category.objects.create(name="Shirts", slug="shirts")
        product = Product.objects.create(
            name="Uniform Shirt",
            category=category,
            school=self.school,
            cost_price=Decimal("150.00"),
            selling_price=Decimal("300.00"),
        )
        self.variant = ProductVariant.objects.create(
            product=product, sku="SHIRT-5", size="30", school=self.school
        )

        self.client = APIClient()

    def make_order(self, number="SS-9001", fulfillment=Order.FulfillmentType.SCHOOL_PICKUP):
        order = Order.objects.create(
            order_number=number,
            student=self.student,
            placed_by=self.parent,
            parent=self.parent,
            payer=self.parent,
            school=self.school,
            city=self.city,
            subtotal=Decimal("300.00"),
            total=Decimal("300.00"),
            status=Order.Status.CONFIRMED,
            payment_method=Order.PaymentMethod.CASH_ON_DELIVERY,
            fulfillment_type=fulfillment,
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant,
            category=self.variant.product.category,
            quantity=1,
            unit_price_snapshot=Decimal("300.00"),
            unit_cost_snapshot=Decimal("150.00"),
        )
        return order

    def test_device_token_registration_and_update(self):
        self.client.force_authenticate(user=self.parent)
        url = reverse("device-token-create")

        # 1. Register new token
        resp = self.client.post(url, {"token": "fcm_token_alpha_123", "platform": "android"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(DeviceToken.objects.filter(token="fcm_token_alpha_123", user=self.parent).exists())

        # 2. Re-registering same token is idempotent
        resp2 = self.client.post(url, {"token": "fcm_token_alpha_123", "platform": "android"}, format="json")
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        self.assertEqual(DeviceToken.objects.filter(token="fcm_token_alpha_123").count(), 1)

    def test_device_token_deletion(self):
        DeviceToken.objects.create(user=self.parent, token="fcm_token_to_delete", platform="android")
        self.client.force_authenticate(user=self.parent)

        # Delete by detail url
        url = reverse("device-token-detail", kwargs={"token": "fcm_token_to_delete"})
        resp = self.client.delete(url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(DeviceToken.objects.filter(token="fcm_token_to_delete").exists())

    def test_notification_formatting_no_child_measurements(self):
        order = self.make_order(number="SS-1042", fulfillment=Order.FulfillmentType.SCHOOL_PICKUP)

        # Test pickup notification
        title, body = format_notification(order, Order.Status.DISPATCHED)
        self.assertEqual(title, "Ready for Pickup")
        self.assertIn(f"ready for pickup at {self.school.name}", body)
        self.assertIn("SS-1042", body)

        # Strictly verify no height, weight, shoulder, or sensitive fit data is present
        for forbidden in ["height", "weight", "shoulder", "cm", "kg", "photo"]:
            self.assertNotIn(forbidden, title.lower())
            self.assertNotIn(forbidden, body.lower())

    def test_order_status_trigger_sends_push(self):
        order = self.make_order()
        DeviceToken.objects.create(user=self.parent, token="parent_active_token", platform="android")

        with patch("orders.tasks.send_order_status_push.delay") as mock_delay:
            with self.captureOnCommitCallbacks(execute=True):
                change_order_status(Order.objects.filter(id=order.id), Order.Status.PROCESSING, self.admin)
            mock_delay.assert_called_with(str(order.id), Order.Status.PROCESSING)

    def test_invalid_fcm_token_cleanup(self):
        order = self.make_order()
        DeviceToken.objects.create(user=self.parent, token="invalid_stale_token", platform="android")

        mock_send_response = MagicMock()
        mock_resp_item = MagicMock()
        mock_resp_item.success = False
        mock_resp_item.exception = Exception("registration-token-not-registered")
        mock_send_response.responses = [mock_resp_item]
        mock_send_response.success_count = 0
        mock_send_response.failure_count = 1

        with patch("orders.fcm.get_firebase_app", return_value=MagicMock()), \
             patch("firebase_admin.messaging.send_each_for_multicast", return_value=mock_send_response):
            result = send_order_push(str(order.id), Order.Status.CONFIRMED)
            self.assertEqual(result["status"], "sent")
            self.assertEqual(result["dropped_tokens"], 1)
            # The stale token must have been deleted
            self.assertFalse(DeviceToken.objects.filter(token="invalid_stale_token").exists())

    def test_user_opt_out_preference(self):
        order = self.make_order()
        DeviceToken.objects.create(user=self.parent, token="parent_token_optout", platform="android")

        # Parent opts out via /api/auth/me/
        self.client.force_authenticate(user=self.parent)
        me_url = reverse("auth_me")
        patch_resp = self.client.patch(me_url, {"notify_order_updates": False}, format="json")
        self.assertEqual(patch_resp.status_code, status.HTTP_200_OK)
        self.parent.refresh_from_db()
        self.assertFalse(self.parent.notify_order_updates)

        # Triggering push must detect opt out
        result = send_order_push(str(order.id), Order.Status.DELIVERED)
        self.assertEqual(result["status"], "opted_out")
