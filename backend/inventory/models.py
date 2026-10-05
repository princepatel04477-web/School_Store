from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from common.models import UUIDModel


class StockBalance(UUIDModel):
    """Current on-hand quantity for one product variant in one city."""

    city = models.ForeignKey(
        "schools.City",
        on_delete=models.PROTECT,
        related_name="stock_balances",
    )
    variant = models.ForeignKey(
        "catalog.ProductVariant",
        on_delete=models.PROTECT,
        related_name="stock_balances",
    )
    stock_quantity = models.PositiveIntegerField(default=0)
    low_stock_threshold = models.PositiveIntegerField(default=10)
    # Stored (generated) flag maintained by the database on every write, so
    # the low-stock dashboard is a partial-index lookup instead of a scan of
    # every variant. See idx_stockbalance_low below.
    is_low_stock = models.GeneratedField(
        expression=models.Case(
            models.When(
                stock_quantity__lte=models.F("low_stock_threshold"),
                then=models.Value(True),
            ),
            default=models.Value(False),
            output_field=models.BooleanField(),
        ),
        output_field=models.BooleanField(),
        db_persist=True,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["city_id", "variant_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["city", "variant"],
                name="uniq_stockbalance_city_variant",
            ),
            models.CheckConstraint(
                condition=Q(stock_quantity__gte=0),
                name="stockbalance_quantity_nonnegative",
            ),
        ]
        indexes = [
            models.Index(
                fields=["city", "stock_quantity"],
                name="idx_stockbalance_city_qty",
            ),
            models.Index(
                fields=["city", "updated_at"],
                name="idx_stockbalance_city_updated",
            ),
            # Partial index: the low-stock list only ever touches rows where
            # is_low_stock is true, regardless of total variant count.
            models.Index(
                fields=["city", "variant"],
                name="idx_stockbalance_low",
                condition=Q(is_low_stock=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.city.code} · {self.variant.sku}: {self.stock_quantity}"


class StockMovement(UUIDModel):
    """Append-only audit ledger of stock changes for a city/variant balance."""

    class Reason(models.TextChoices):
        # Stock-in
        INITIAL_STOCK = "INITIAL_STOCK", "Initial Stock"
        RESTOCK = "RESTOCK", "Restock"
        # Sale (written by the checkout path)
        ORDER_PLACED = "ORDER_PLACED", "Order Placed"
        # Stock back in
        ORDER_CANCELLED = "ORDER_CANCELLED", "Order Cancelled"
        RETURN = "RETURN", "Customer Return"
        # Manual adjustments
        ADJUSTMENT = "ADJUSTMENT", "Manual Adjustment"
        DAMAGE = "DAMAGE", "Damaged / Write-off"

    variant = models.ForeignKey(
        "catalog.ProductVariant",
        on_delete=models.PROTECT,
        related_name="stock_movements",
    )
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.PROTECT,
        related_name="stock_movements",
    )
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    quantity_change = models.IntegerField()
    reason = models.CharField(
        max_length=50,
        choices=Reason.choices,
        default=Reason.ADJUSTMENT,
    )
    reference_order = models.ForeignKey(
        "orders.Order",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["variant", "created_at"],
                name="idx_invmov_variant_created",
            ),
            models.Index(
                fields=["city", "created_at"],
                name="idx_invmov_city_created",
            ),
            models.Index(
                fields=["school", "created_at"],
                name="idx_invmov_school_created",
            ),
        ]

    def __str__(self) -> str:
        sign = "+" if self.quantity_change >= 0 else ""
        return f"{self.city.code} · {self.variant.sku}: {sign}{self.quantity_change} ({self.reason})"
