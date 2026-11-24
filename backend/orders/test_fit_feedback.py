from datetime import timedelta
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from catalog.models import Category, Product, ProductVariant, SizeChartRow, SizingSample
from catalog.shoulder_estimate import check_size_chart_biases, fetch_training_data, get_size_advice_accuracy_report
from orders.fit_retention import clear_fit_data
from orders.models import Order, OrderItem, OrderItemExchange, OrderStatusEvent
from schools.models import City, School, Student

User = get_user_model()


class FitFeedbackTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.parent = User.objects.create_user(
            username="parent1", phone="+919876543210", role="PARENT"
        )
        self.other_parent = User.objects.create_user(
            username="parent2", phone="+919876543211", role="PARENT"
        )
        self.boss = User.objects.create_user(
            username="boss1", phone="+919876543212", role="BOSS"
        )

        self.city = City.objects.create(name="Ahmedabad", code="AMD")
        self.school = School.objects.create(name="Delhi Public School", code="DPS", city=self.city)
        self.student = Student.objects.create(
            name="Aarav Shah",
            school=self.school,
            city=self.city,
            parent=self.parent,
            student_class="5",
            gender="boy",
        )
        self.category = Category.objects.create(name="Uniforms", slug="uniforms")
        self.product = Product.objects.create(
            name="Regular Shirt",
            category=self.category,
            school=self.school,
            city=self.city,
            gender="boy",
            cost_price=Decimal("300.00"),
            selling_price=Decimal("500.00"),
        )
        self.variant30 = ProductVariant.objects.create(
            product=self.product,
            size="30",
            sku="DPS-SHT-30",
        )
        self.variant32 = ProductVariant.objects.create(
            product=self.product,
            size="32",
            sku="DPS-SHT-32",
        )
        self.chart_row = SizeChartRow.objects.create(
            variant=self.variant30,
            height_cm_min=Decimal("125.0"),
            height_cm_max=Decimal("135.0"),
            shoulder_cm_min=Decimal("31.0"),
            shoulder_cm_max=Decimal("33.0"),
        )

        self.order = Order.objects.create(
            order_number="ORD-2026-001",
            placed_by=self.parent,
            payer=self.parent,
            parent=self.parent,
            student=self.student,
            school=self.school,
            city=self.city,
            student_class="5",
            status=Order.Status.DELIVERED,
            subtotal=Decimal("500.00"),
            total=Decimal("500.00"),
        )
        self.item = OrderItem.objects.create(
            order=self.order,
            variant=self.variant30,
            category=self.category,
            quantity=1,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            chosen_size="30",
            recommended_size="30",
            fit_source="ESTIMATE",
            fit_height_cm=Decimal("130.0"),
            fit_weight_kg=Decimal("26.0"),
        )

    def test_feedback_storage_and_one_answer_per_line(self):
        self.client.force_authenticate(user=self.parent)
        url = f"/api/orders/{self.order.id}/items/{self.item.id}/fit-feedback/"

        # Submit FITS_WELL
        resp = self.client.post(url, {"fit_feedback": "FITS_WELL"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["fit_feedback"], "FITS_WELL")

        self.item.refresh_from_db()
        self.assertEqual(self.item.fit_feedback, "FITS_WELL")
        self.assertIsNotNone(self.item.fit_feedback_answered_at)

        # Second submission must be rejected (one answer per line)
        dup_resp = self.client.post(url, {"fit_feedback": "TOO_TIGHT"}, format="json")
        self.assertEqual(dup_resp.status_code, 400)
        self.assertIn("already been submitted", dup_resp.data["detail"])

    def test_feedback_permission_denied_for_other_parent(self):
        self.client.force_authenticate(user=self.other_parent)
        url = f"/api/orders/{self.order.id}/items/{self.item.id}/fit-feedback/"
        resp = self.client.post(url, {"fit_feedback": "FITS_WELL"}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_exchange_automatically_records_feedback(self):
        # When an exchange is logged as TOO_SMALL, the item must be recorded as TOO_TIGHT
        exchange = OrderItemExchange.objects.create(
            order_item=self.item,
            from_size="30",
            to_size="32",
            reason=OrderItemExchange.Reason.TOO_SMALL,
        )
        self.item.refresh_from_db()
        self.assertEqual(self.item.fit_feedback, "TOO_TIGHT")
        self.assertIsNotNone(self.item.fit_feedback_answered_at)

        # Fresh item with exchange TOO_BIG -> TOO_LOOSE
        item2 = OrderItem.objects.create(
            order=self.order,
            variant=self.variant32,
            category=self.category,
            quantity=1,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            chosen_size="32",
        )
        OrderItemExchange.objects.create(
            order_item=item2,
            from_size="32",
            to_size="30",
            reason=OrderItemExchange.Reason.TOO_BIG,
        )
        item2.refresh_from_db()
        self.assertEqual(item2.fit_feedback, "TOO_LOOSE")

    def test_anonymisation_copies_feedback_to_sizingsample(self):
        self.item.fit_feedback = "FITS_WELL"
        self.item.fit_feedback_answered_at = timezone.now()
        self.item.save()

        # Simulate order completed 95 days ago
        old_time = timezone.now() - timedelta(days=95)
        Order.objects.filter(id=self.order.id).update(created_at=old_time)
        OrderStatusEvent.objects.create(
            order=self.order,
            status=Order.Status.DELIVERED,
            timestamp=old_time,
        )

        clear_fit_data()

        # SizingSample created and carries fit_feedback
        sample = SizingSample.objects.filter(product=self.product).first()
        self.assertIsNotNone(sample)
        self.assertEqual(sample.fit_feedback, "FITS_WELL")
        # Personal measurements cleared on order item
        self.item.refresh_from_db()
        self.assertIsNone(self.item.fit_height_cm)

    def test_training_weights_fits_well_sample(self):
        # Fits well item with known size chart row shoulder range
        self.item.fit_feedback = "FITS_WELL"
        self.item.save()

        samples, n_real, n_chart = fetch_training_data()
        fits_well_sample = next(
            (s for s in samples if s.weight == 0.5 and s.height_cm == 130.0), None
        )
        self.assertIsNotNone(fits_well_sample)
        self.assertEqual(fits_well_sample.weight, 0.5)
        # Shoulder is middle of (31.0 + 33.0) / 2 = 32.0
        self.assertAlmostEqual(fits_well_sample.shoulder_cm, 32.0, places=1)

        # TOO_TIGHT and TOO_LOOSE do not become training samples
        self.item.fit_feedback = "TOO_TIGHT"
        self.item.save()
        samples_tight, _, _ = fetch_training_data()
        self.assertIsNone(
            next((s for s in samples_tight if s.weight == 0.5 and s.height_cm == 130.0), None)
        )

    def test_15_percent_bias_check_and_accuracy_report(self):
        # Create items for school DPS, class 5, boy: 2 TOO_TIGHT, 1 FITS_WELL -> 66.7% too tight > 15%
        self.item.fit_feedback = "TOO_TIGHT"
        self.item.save()

        OrderItem.objects.create(
            order=self.order,
            variant=self.variant30,
            category=self.category,
            quantity=1,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            fit_feedback="TOO_TIGHT",
            chosen_size="30",
        )
        OrderItem.objects.create(
            order=self.order,
            variant=self.variant30,
            category=self.category,
            quantity=1,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            fit_feedback="FITS_WELL",
            chosen_size="30",
        )

        flagged = check_size_chart_biases()
        self.assertTrue(len(flagged) >= 1)
        found = next((f for f in flagged if f["school_name"] == "Delhi Public School"), None)
        self.assertIsNotNone(found)
        self.assertGreater(found["too_tight_pct"], 15.0)
        self.assertEqual(found["flag"], "Customers find this chart runs small")

        # Test accuracy report endpoint
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get("/api/panel/size-accuracy/")
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        self.assertGreaterEqual(data["answers_this_season"], 3)
        self.assertIn("by_source", data)
        self.assertIn("by_confidence", data)
        self.assertTrue(len(data["flagged_charts"]) >= 1)
