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

    class PaymentMethod(models.TextChoices):
        ONLINE = "ONLINE", "Online"
        CASH_ON_DELIVERY = "COD", "Cash on delivery"

    class FulfillmentType(models.TextChoices):
        HOME_DELIVERY = "HOME_DELIVERY", "Home delivery"
        SCHOOL_PICKUP = "SCHOOL_PICKUP", "School pickup"

    order_number = models.CharField(max_length=40, unique=True)
    # Client supplied checkout token. A database constraint makes retries safe even
    # when two requests arrive concurrently.
    idempotency_key = models.CharField(max_length=128, unique=True, default=uuid.uuid4)
    placed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="placed_orders",
    )
    # Kept separate from student and placer because the payer is whoever completes checkout.
    payer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="paid_orders",
    )
    placed_by_role = models.CharField(max_length=20)
    student = models.ForeignKey(
        "schools.Student",
        on_delete=models.PROTECT,
        related_name="orders",
    )
    # Denormalised class of the beneficiary so the School Admin panel can
    # filter orders by class with a single indexed WHERE (no join to Student),
    # exactly like the school/city/parent copies below.
    student_class = models.CharField(max_length=30, blank=True, default="")
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
    branch = models.ForeignKey(
        "schools.SchoolBranch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
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
    fulfillment_type = models.CharField(
        max_length=24,
        choices=FulfillmentType.choices,
        default=FulfillmentType.HOME_DELIVERY,
    )
    # Cash-on-delivery orders are paid at the door, so they never expire unpaid.
    payment_method = models.CharField(
        max_length=12,
        choices=PaymentMethod.choices,
        default=PaymentMethod.ONLINE,
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
            # Cursor pagination orders by (-created_at, -id); carrying `id` in
            # the index lets Postgres stream the admin orders table straight
            # out of the index with no sort node.
            models.Index(
                fields=["school", "created_at", "id"],
                name="idx_order_school_created_id",
            ),
            models.Index(
                fields=["school", "student_class", "created_at", "id"],
                name="idx_order_sch_cls_created_id",
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
                fields=["student", "created_at", "id"],
                name="idx_order_student_created_id",
            ),
            models.Index(
                fields=["parent", "created_at"],
                name="idx_order_parent_created",
            ),
            models.Index(
                fields=["status", "created_at"],
                name="idx_order_status_created",
            ),
            models.Index(
                fields=["placed_by", "created_at"],
                name="idx_order_placer_created",
            ),
            models.Index(
                fields=["payer", "created_at"],
                name="idx_order_payer_created",
            ),
            models.Index(
                fields=["branch", "created_at"],
                name="idx_order_branch_created",
            ),
        ]

    def save(self, *args, **kwargs):
        if self.student_id:
            # Keep denormalised scope columns in sync with the beneficiary's school.
            student = self.student
            self.school_id = student.school_id
            if student.branch_id:
                self.branch_id = student.branch_id
            self.city_id = student.city_id or student.school.city_id
            self.student_class = student.student_class
            if not self.parent_id and student.parent_id:
                self.parent_id = student.parent_id
        if self.placed_by_id and not self.placed_by_role:
            self.placed_by_role = self.placed_by.role
        if not self.parent_id and self.placed_by_role == "PARENT":
            self.parent_id = self.placed_by_id
        if not self.payer_id and self.placed_by_id:
            self.payer_id = self.placed_by_id
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
    # Size fit, kept on the order line only (no permanent child profile). Sizes
    # are copied as values so a later size chart import never rewrites history.
    fit_height_cm = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    fit_weight_kg = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    recommended_size = models.CharField(max_length=50, blank=True, default="")
    recommended_alt_size = models.CharField(max_length=50, blank=True, default="")
    recommendation_status = models.CharField(max_length=20, blank=True, default="")
    chosen_size = models.CharField(max_length=50, blank=True, default="")

    class Meta:
        indexes = [
            models.Index(fields=["order"], name="idx_orderitem_order"),
            models.Index(fields=["variant"], name="idx_orderitem_variant"),
        ]

    @property
    def current_size(self) -> str:
        """The size the family has now: the last exchange, else what was ordered."""
        last = self.exchanges.order_by("-created_at").first()
        return last.to_size if last else (self.chosen_size or self.variant.size)

    def __str__(self) -> str:
        return f"{self.order.order_number} - {self.variant.sku} x{self.quantity}"


class OrderItemExchange(UUIDModel):
    """
    One exchange of one order line, recorded by staff. TOO_SMALL and TOO_BIG
    measure how often the size recommendation was wrong; NOT_SIZE (a fault,
    wrong item) is kept but left out of that measure.
    """

    class Reason(models.TextChoices):
        TOO_SMALL = "TOO_SMALL", "Too small"
        TOO_BIG = "TOO_BIG", "Too big"
        NOT_SIZE = "NOT_SIZE", "Not a size problem"

    order_item = models.ForeignKey(
        OrderItem,
        on_delete=models.CASCADE,
        related_name="exchanges",
    )
    from_size = models.CharField(
        max_length=50,
        blank=True,
        help_text="Leave blank to use the size the family has now.",
    )
    to_size = models.CharField(max_length=50)
    reason = models.CharField(max_length=12, choices=Reason.choices)
    note = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="order_item_exchanges",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["order_item", "created_at"], name="idx_exchange_item_created"),
            models.Index(fields=["reason", "created_at"], name="idx_exchange_reason_created"),
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        if not self.order_item_id:
            return
        item = self.order_item
        if not self.from_size:
            self.from_size = item.current_size
        sizes = set(
            item.variant.product.variants.values_list("size", flat=True)
        )
        errors = {}
        if self.to_size not in sizes:
            errors["to_size"] = (
                f"{self.product_name} has no size '{self.to_size}'. "
                f"Sizes: {', '.join(sorted(sizes))}."
            )
        if self.reason != self.Reason.NOT_SIZE and self.to_size == self.from_size:
            errors["to_size"] = "A size exchange must change the size."
        if errors:
            raise ValidationError(errors)

    @property
    def product_name(self) -> str:
        return self.order_item.variant.product.name

    def __str__(self) -> str:
        return f"{self.order_item} {self.from_size} -> {self.to_size} ({self.reason})"


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


class PhotoConsent(UUIDModel):
    """A parent's agreement to use one child's photo for one product."""

    class Purpose(models.TextChoices):
        NOTEBOOK = "NOTEBOOK", "Photo notebook"
        ID_CARD = "ID_CARD", "Student ID card"

    parent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="photo_consents",
    )
    student = models.ForeignKey(
        "schools.Student",
        on_delete=models.PROTECT,
        related_name="photo_consents",
    )
    purpose = models.CharField(max_length=16, choices=Purpose.choices)
    policy_version = models.CharField(max_length=40)
    # Set only when the parent asks to keep the small preview for next year's ID card.
    keep_for_next_year = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    ip = models.CharField(max_length=45, blank=True, default="")
    user_agent = models.CharField(max_length=300, blank=True, default="")
    withdrawn_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["student", "purpose"],
                name="idx_photoconsent_student",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["parent", "student", "purpose"],
                condition=models.Q(withdrawn_at__isnull=True),
                name="uniq_live_photo_consent",
            ),
        ]

    def __str__(self) -> str:
        state = "withdrawn" if self.withdrawn_at else "live"
        return f"{self.purpose} {state} for {self.student_id}"
