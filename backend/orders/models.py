import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone
from common.models import UUIDModel


class Order(UUIDModel):
    class Status(models.TextChoices):
        PLACED = "PLACED", "Placed"
        PENDING = "PENDING", "Pending"  # legacy value retained for existing data
        CONFIRMED = "CONFIRMED", "Confirmed"
        PROCESSING = "PROCESSING", "Processing"
        PACKED = "PACKED", "Packed"
        DISPATCHED = "DISPATCHED", "Dispatched"
        SHIPPED = "SHIPPED", "Shipped"  # legacy value retained for existing data
        DELIVERED = "DELIVERED", "Delivered"
        CANCELLED = "CANCELLED", "Cancelled"
        RETURNED = "RETURNED", "Returned"
        REFUNDED = "REFUNDED", "Refunded"  # legacy value retained for existing data

    class PaymentStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        AUTHORIZED = "AUTHORIZED", "Authorized"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        REFUNDED = "REFUNDED", "Refunded"

    order_number = models.CharField(max_length=40, unique=True)
    # Client supplied checkout token. A database constraint makes retries safe even
    # when two requests arrive concurrently.
    idempotency_key = models.CharField(max_length=128, unique=True, db_index=True, default=uuid.uuid4)
    placed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="placed_orders",
    )
    placed_by_role = models.CharField(max_length=20)
    student = models.ForeignKey(
        "schools.Student",
        on_delete=models.PROTECT,
        related_name="orders",
    )
    # Denormalised parent, school, and city so scoped queries never need a join or subquery
    parent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="child_orders",
    )
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.PROTECT,
        related_name="orders",
    )
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.PROTECT,
        related_name="orders",
    )
    status = models.CharField(
        max_length=24,
        choices=Status.choices,
        default=Status.PLACED,
    )
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    payment_status = models.CharField(
        max_length=24,
        choices=PaymentStatus.choices,
        default=PaymentStatus.PENDING,
    )
    razorpay_order_id = models.CharField(max_length=80, blank=True, default="")
    razorpay_payment_id = models.CharField(max_length=80, blank=True, default="")
    razorpay_signature = models.CharField(max_length=200, blank=True, default="")
    delivery_details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["school", "created_at"],
                name="idx_order_school_created",
            ),
            models.Index(
                fields=["city", "created_at"],
                name="idx_order_city_created",
            ),
            models.Index(
                fields=["student", "created_at"],
                name="idx_order_student_created",
            ),
            models.Index(
                fields=["parent", "created_at"],
                name="idx_order_parent_created",
            ),
            models.Index(
                fields=["status", "created_at"],
                name="idx_order_status_created",
            ),
        ]

    def save(self, *args, **kwargs):
        if self.student_id:
            if not self.school_id:
                self.school_id = self.student.school_id
            if not self.parent_id and self.student.parent_id:
                self.parent_id = self.student.parent_id
        if self.school_id and not self.city_id:
            self.city_id = self.school.city_id
        if self.placed_by_id and not self.placed_by_role:
            self.placed_by_role = self.placed_by.role
        if not self.parent_id and self.placed_by_role == "PARENT":
            self.parent_id = self.placed_by_id
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.order_number} ({self.status})"


class OrderItem(UUIDModel):
    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="items",
    )
    variant = models.ForeignKey(
        "catalog.ProductVariant",
        on_delete=models.PROTECT,
        related_name="order_items",
    )
    category = models.ForeignKey(
        "catalog.Category",
        on_delete=models.PROTECT,
        related_name="order_items",
    )
    quantity = models.PositiveIntegerField()
    unit_price_snapshot = models.DecimalField(max_digits=10, decimal_places=2)
    unit_cost_snapshot = models.DecimalField(max_digits=10, decimal_places=2)
    customisation_data = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["order"], name="idx_orderitem_order"),
            models.Index(fields=["variant"], name="idx_orderitem_variant"),
        ]

    def __str__(self) -> str:
        return f"{self.order.order_number} - {self.variant.sku} x{self.quantity}"


class OrderStatusEvent(UUIDModel):
    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="status_events",
    )
    status = models.CharField(
        max_length=24,
        choices=Order.Status.choices,
    )
    timestamp = models.DateTimeField(default=timezone.now)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="order_status_changes",
    )
    note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["timestamp"]
        indexes = [
            models.Index(
                fields=["order", "timestamp"],
                name="idx_orderevent_order_ts",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.order.order_number} -> {self.status} @ {self.timestamp}"
