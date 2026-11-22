from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import ProductVariant
from orders.models import Order
from schools.models import City, Student

from .models import StockBalance, StockMovement
from .services import (
    InsufficientStockError,
    apply_stock_movement,
    stock_flags,
)


class CityStockTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.surat = City.objects.get(code="SUR")
        cls.ahmedabad = City.objects.get(code="AMD")
        cls.student = Student.objects.get(gr_number="DPS-2026-001")
        cls.teacher = User.objects.get(username="teacher_dps")
        cls.parent = User.objects.get(username="parent_rahul")
        cls.admin_surat = User.objects.get(username="admin_surat")
        cls.variant = ProductVariant.objects.get(sku="SHOE-BLK-UK2")

    def jwt_client(self, user):
        client = APIClient()
        token = build_tokens_for_user(user)["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    def test_a_variant_has_independent_city_balances(self):
        surat_balance = StockBalance.objects.get(city=self.surat, variant=self.variant)
        ahmedabad_balance = StockBalance.objects.get(city=self.ahmedabad, variant=self.variant)
        self.assertEqual(surat_balance.stock_quantity, 400)
        self.assertEqual(ahmedabad_balance.stock_quantity, 400)
        self.assertNotEqual(surat_balance.pk, ahmedabad_balance.pk)

    def test_city_admin_only_sees_their_stock_balances(self):
        response = self.jwt_client(self.admin_surat).get("/api/stock-balances/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["results"])
        self.assertEqual(
            {str(row["city"]) for row in response.data["results"]},
            {str(self.surat.pk)},
        )

    def test_teacher_order_debits_school_city_and_records_payer_and_placer(self):
        surat_balance = StockBalance.objects.get(city=self.surat, variant=self.variant)
        ahmedabad_balance = StockBalance.objects.get(city=self.ahmedabad, variant=self.variant)
        before_surat = surat_balance.stock_quantity
        before_ahmedabad = ahmedabad_balance.stock_quantity

        response = self.jwt_client(self.teacher).post(
            "/api/orders/",
            {
                "idempotency_key": "teacher-city-stock-test-001",
                "student": str(self.student.pk),
                "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
                "items": [{"variant": str(self.variant.pk), "quantity": 2}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["placed_by_role"], User.Role.TEACHER)
        self.assertEqual(str(response.data["payer"]), str(self.teacher.pk))
        self.assertEqual(str(response.data["parent"]), str(self.parent.pk))
        self.assertEqual(response.data["fulfillment_type"], Order.FulfillmentType.SCHOOL_PICKUP)

        surat_balance.refresh_from_db()
        ahmedabad_balance.refresh_from_db()
        self.assertEqual(surat_balance.stock_quantity, before_surat - 2)
        self.assertEqual(ahmedabad_balance.stock_quantity, before_ahmedabad)
        self.assertTrue(
            StockMovement.objects.filter(
                reference_order_id=response.data["id"],
                city=self.surat,
                quantity_change=-2,
                reason=StockMovement.Reason.ORDER_PLACED,
            ).exists()
        )

    def test_school_fulfillment_setting_is_enforced_at_checkout(self):
        school = self.student.school
        school.home_delivery_enabled = False
        school.school_pickup_enabled = True
        school.save(update_fields=["home_delivery_enabled", "school_pickup_enabled"])

        response = self.jwt_client(self.parent).post(
            "/api/orders/",
            {
                "idempotency_key": "delivery-disabled-test-001",
                "student": str(self.student.pk),
                "fulfillment_type": Order.FulfillmentType.HOME_DELIVERY,
                "items": [{"variant": str(self.variant.pk), "quantity": 1}],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("fulfillment_type", response.data)


class StockMovementLedgerTests(TestCase):
    """Every stock change is a StockMovement applied as an atomic UPDATE."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.surat = City.objects.get(code="SUR")
        cls.admin_surat = User.objects.get(username="admin_surat")
        cls.variant = ProductVariant.objects.get(sku="SHOE-BLK-UK2")  # 400 in Surat
        cls.parent = User.objects.get(username="parent_rahul")
        cls.student = Student.objects.get(gr_number="DPS-2026-001")

    def jwt_client(self, user):
        client = APIClient()
        from accounts.serializers import build_tokens_for_user

        token = build_tokens_for_user(user)["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    def balance(self):
        return StockBalance.objects.get(city=self.surat, variant=self.variant)

    def test_restock_movement_increments_balance_and_writes_ledger(self):
        before = self.balance().stock_quantity
        response = self.jwt_client(self.admin_surat).post(
            "/api/stock-movements/",
            {
                "variant": str(self.variant.pk),
                "quantity_change": 50,
                "reason": StockMovement.Reason.RESTOCK,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.balance().stock_quantity, before + 50)
        self.assertTrue(
            StockMovement.objects.filter(
                variant=self.variant,
                city=self.surat,
                quantity_change=50,
                reason=StockMovement.Reason.RESTOCK,
                created_by=self.admin_surat,
            ).exists()
        )

    def test_return_reason_is_accepted(self):
        response = self.jwt_client(self.admin_surat).post(
            "/api/stock-movements/",
            {
                "variant": str(self.variant.pk),
                "quantity_change": 2,
                "reason": StockMovement.Reason.RETURN,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_overdraw_is_rejected_and_nothing_is_written(self):
        before = self.balance().stock_quantity
        movements_before = StockMovement.objects.count()
        response = self.jwt_client(self.admin_surat).post(
            "/api/stock-movements/",
            {
                "variant": str(self.variant.pk),
                "quantity_change": -(before + 1),
                "reason": StockMovement.Reason.ADJUSTMENT,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.balance().stock_quantity, before)
        self.assertEqual(StockMovement.objects.count(), movements_before)

    def test_service_raises_on_insufficient_stock(self):
        with self.assertRaises(InsufficientStockError):
            apply_stock_movement(
                variant=self.variant,
                city_id=self.surat.pk,
                quantity_change=-(self.balance().stock_quantity + 1),
                reason=StockMovement.Reason.ADJUSTMENT,
            )

    def test_generated_low_stock_flag_and_stock_flags_helper(self):
        quantity = self.balance().stock_quantity  # threshold is 20
        apply_stock_movement(
            variant=self.variant,
            city_id=self.surat.pk,
            quantity_change=-(quantity - 5),
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        balance = self.balance()
        self.assertEqual(balance.stock_quantity, 5)
        self.assertTrue(balance.is_low_stock)  # DB-maintained generated column

        flags = stock_flags(self.surat.pk, [self.variant.pk])
        self.assertEqual(flags[str(self.variant.pk)], "LOW_STOCK")

        apply_stock_movement(
            variant=self.variant,
            city_id=self.surat.pk,
            quantity_change=-5,
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        flags = stock_flags(self.surat.pk, [self.variant.pk])
        self.assertEqual(flags[str(self.variant.pk)], "OUT_OF_STOCK")
        self.assertTrue(self.balance().is_low_stock)

    def test_low_stock_list_returns_only_low_rows(self):
        apply_stock_movement(
            variant=self.variant,
            city_id=self.surat.pk,
            quantity_change=-(self.balance().stock_quantity - 3),
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        response = self.jwt_client(self.admin_surat).get("/api/stock-balances/low/")
        self.assertEqual(response.status_code, 200)
        rows = response.data["results"]
        self.assertTrue(rows)
        self.assertEqual({row["variant_sku"] for row in rows}, {self.variant.sku})
        self.assertTrue(all(row["is_low_stock"] for row in rows))

    def test_stock_movement_supports_notes_and_clear_reasons(self):
        """Staff adjustments support clear reasons and explanatory notes."""
        response = self.jwt_client(self.admin_surat).post(
            "/api/stock-movements/",
            {
                "variant": str(self.variant.pk),
                "city": str(self.surat.pk),
                "quantity_change": 15,
                "reason": StockMovement.Reason.CORRECTION,
                "notes": "Physical audit count revealed 15 extra pairs in Surat warehouse bay 2.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["reason"], StockMovement.Reason.CORRECTION)
        self.assertEqual(
            response.data["notes"],
            "Physical audit count revealed 15 extra pairs in Surat warehouse bay 2.",
        )

        mov = StockMovement.objects.get(pk=response.data["id"])
        self.assertEqual(mov.notes, "Physical audit count revealed 15 extra pairs in Surat warehouse bay 2.")
        self.assertEqual(mov.reason, StockMovement.Reason.CORRECTION)

    def test_stock_balance_filters_size_and_severity(self):
        """Stock balances can be filtered by variant size and low-stock severity."""
        # Drive variant down to critical stock (e.g. qty 4, threshold is 20)
        apply_stock_movement(
            variant=self.variant,
            city_id=self.surat.pk,
            quantity_change=-(self.balance().stock_quantity - 4),
            reason=StockMovement.Reason.ADJUSTMENT,
        )
        # Filter by size
        resp = self.jwt_client(self.admin_surat).get(
            f"/api/stock-balances/?size={self.variant.size}"
        )
        self.assertEqual(resp.status_code, 200)
        results = resp.data["results"]
        self.assertTrue(any(str(r["variant"]) == str(self.variant.pk) for r in results))

        # Filter by severity=CRITICAL
        resp_crit = self.jwt_client(self.admin_surat).get(
            "/api/stock-balances/?severity=CRITICAL"
        )
        self.assertEqual(resp_crit.status_code, 200)
        crit_results = resp_crit.data["results"]
        matched = [r for r in crit_results if str(r["variant"]) == str(self.variant.pk)]
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["severity"], "CRITICAL")

    def test_stock_balance_affected_orders_count(self):
        """Affected orders count reflects active unfulfilled orders requiring this variant."""
        from orders.models import OrderItem

        # Verify initial affected count
        bal = self.balance()
        resp = self.jwt_client(self.admin_surat).get(
            f"/api/stock-balances/?variant={self.variant.pk}"
        )
        self.assertEqual(resp.status_code, 200)
        initial_affected = resp.data["results"][0]["affected_orders_count"]

        # Place an order with this variant
        order_resp = self.jwt_client(self.parent).post(
            "/api/orders/",
            {
                "idempotency_key": "affected-orders-test-001",
                "student": str(self.student.pk),
                "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
                "items": [{"variant": str(self.variant.pk), "quantity": 1}],
            },
            format="json",
        )
        self.assertEqual(order_resp.status_code, 201)

        resp2 = self.jwt_client(self.admin_surat).get(
            f"/api/stock-balances/?variant={self.variant.pk}"
        )
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.data["results"][0]["affected_orders_count"], initial_affected + 1)

    def test_reconciliation_report_detects_discrepancy_without_silent_correction(self):
        """Reconciliation report audits balance vs movement ledger and does NOT silently overwrite."""
        # Baseline check
        resp = self.jwt_client(self.admin_surat).get(
            f"/api/stock-balances/reconciliation/?city={self.surat.pk}"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("total_balances_checked", resp.data)
        self.assertIn("discrepant_count", resp.data)
        self.assertIn("discrepancies", resp.data)

        # Intentionally introduce a raw drift on stock_quantity without a StockMovement row
        bal = self.balance()
        original_qty = bal.stock_quantity
        StockBalance.objects.filter(pk=bal.pk).update(stock_quantity=original_qty + 25)

        # Run reconciliation
        resp_after = self.jwt_client(self.admin_surat).get(
            f"/api/stock-balances/reconciliation/?city={self.surat.pk}&discrepant_only=true"
        )
        self.assertEqual(resp_after.status_code, 200)
        self.assertGreaterEqual(resp_after.data["discrepant_count"], 1)

        discrepant_item = next(
            item for item in resp_after.data["discrepancies"]
            if item["variant_id"] == str(self.variant.pk)
        )
        self.assertEqual(discrepant_item["current_stock"], original_qty + 25)
        self.assertEqual(discrepant_item["discrepancy"], 25)
        self.assertTrue(discrepant_item["has_discrepancy"])

        # Crucial check: verify that the report DID NOT silently alter or correct the balance!
        bal.refresh_from_db()
        self.assertEqual(
            bal.stock_quantity,
            original_qty + 25,
            "Reconciliation must never silently correct or alter stock balances.",
        )
