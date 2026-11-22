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
        READY_FOR_PICKUP = "READY_FOR_PICKUP", "Ready for pickup"
        DELIVERED = "DELIVERED", "Delivered"
        COLLECTED = "COLLECTED", "Collected"
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
            # Payment webhook looks the order up by the gateway's order id.
            models.Index(
                fields=["razorpay_order_id"],
                name="idx_order_razorpay_id",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["razorpay_order_id"],
                condition=models.Q(razorpay_order_id__gt=""),
                name="uniq_order_razorpay_order_id",
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
    # From the optional camera step: numbers only, the photo never leaves the phone.
    fit_shoulder_cm = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    fit_shoulder_confidence = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    # CAMERA or MANUAL (see schools.StudentMeasurement.Source); blank when no measurement was used.
    fit_source = models.CharField(max_length=10, blank=True, default="")
    fit_shoulder_edited = models.BooleanField(default=False)
    recommended_size = models.CharField(max_length=50, blank=True, default="")
    recommended_alt_size = models.CharField(max_length=50, blank=True, default="")
    recommendation_status = models.CharField(max_length=20, blank=True, default="")
    recommendation_reason = models.CharField(
        max_length=60,
        blank=True,
        default="",
        help_text="Stable reason code/explanation for why this size was suggested.",
    )
    size_chart_version = models.CharField(
        max_length=60,
        blank=True,
        default="",
        help_text="Version identifier or checksum of the size chart used at order time.",
    )
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

    @property
    def size_holdings(self) -> dict[str, int]:
        """Returns the distribution of sizes currently held for this line as {size: quantity}."""
        return size_holdings(self)

    def __str__(self) -> str:
        return f"{self.order.order_number} - {self.variant.sku} x{self.quantity}"


def size_holdings(item: OrderItem) -> dict[str, int]:
    """
    Returns the distribution of sizes currently held for an order line as {size: quantity}.
    Initial holdings are {item.chosen_size or item.variant.size: item.quantity}.
    Each completed exchange moves units from from_size to to_size.
    """
    initial_size = item.chosen_size or item.variant.size
    holdings: dict[str, int] = {initial_size: item.quantity}
    exchanges = list(item.exchanges.all())
    exchanges.sort(key=lambda e: e.created_at or timezone.now())
    for ex in exchanges:
        q = ex.quantity if ex.quantity is not None else item.quantity
        from_s = ex.from_size or initial_size
        available_from = holdings.get(from_s, 0)
        units_to_move = min(available_from, q) if available_from > 0 else q
        if available_from > 0:
            holdings[from_s] -= units_to_move
            if holdings[from_s] <= 0:
                del holdings[from_s]
        holdings[ex.to_size] = holdings.get(ex.to_size, 0) + units_to_move
    return holdings


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
    quantity = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Number of units exchanged. Null means whole line.",
    )
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


class PaymentAttempt(UUIDModel):
    class Status(models.TextChoices):
        CREATED = "CREATED", "Created"
        AUTHORIZED = "AUTHORIZED", "Authorized"
        CAPTURED = "CAPTURED", "Captured"
        FAILED = "FAILED", "Failed"
        REFUNDED = "REFUNDED", "Refunded"

    class Source(models.TextChoices):
        VERIFY = "VERIFY", "Verify"
        WEBHOOK = "WEBHOOK", "Webhook"
        RECONCILE = "RECONCILE", "Reconcile"
        EXPIRY_CHECK = "EXPIRY_CHECK", "Expiry Check"

    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="payment_attempts",
    )
    razorpay_payment_id = models.CharField(max_length=80, unique=True)
    status = models.CharField(max_length=24, choices=Status.choices)
    method = models.CharField(max_length=50, blank=True, default="")
    amount_paise = models.BigIntegerField()
    currency = models.CharField(max_length=10, default="INR")
    error_code = models.CharField(max_length=100, blank=True, default="")
    error_reason = models.TextField(blank=True, default="")
    first_seen_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    last_source = models.CharField(max_length=24, choices=Source.choices)

    class Meta:
        ordering = ["-first_seen_at"]
        indexes = [
            models.Index(fields=["order", "status"], name="idx_payattempt_order_status"),
            models.Index(fields=["razorpay_payment_id"], name="idx_payattempt_pid"),
        ]

    def __str__(self) -> str:
        return f"{self.razorpay_payment_id} ({self.status}) for order {self.order_id}"


class PaymentEvent(UUIDModel):
    class State(models.TextChoices):
        RECEIVED = "RECEIVED", "Received"
        PROCESSED = "PROCESSED", "Processed"
        RETRY = "RETRY", "Retry"
        UNMATCHED = "UNMATCHED", "Unmatched"
        IGNORED = "IGNORED", "Ignored"

    event_id = models.CharField(max_length=100, unique=True)
    event_type = models.CharField(max_length=100)
    razorpay_order_id = models.CharField(max_length=80, blank=True, default="")
    razorpay_payment_id = models.CharField(max_length=80, blank=True, default="")
    amount = models.BigIntegerField(null=True, blank=True)
    currency = models.CharField(max_length=10, blank=True, default="INR")
    payload = models.JSONField(default=dict)
    received_at = models.DateTimeField(default=timezone.now)
    state = models.CharField(max_length=20, choices=State.choices, default=State.RECEIVED)
    tries = models.PositiveIntegerField(default=0)
    next_try_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-received_at"]
        indexes = [
            models.Index(fields=["event_id"], name="idx_paymentevent_eid"),
            models.Index(fields=["state", "next_try_at"], name="idx_paymentevent_state_try"),
            models.Index(fields=["razorpay_order_id"], name="idx_paymentevent_roid"),
        ]

    def __str__(self) -> str:
        return f"Event {self.event_id} ({self.event_type}) [{self.state}]"


class PaymentReview(UUIDModel):
    class Reason(models.TextChoices):
        REFUND_AFTER_RELEASE = "REFUND_AFTER_RELEASE", "Refund after release"
        DUPLICATE_PAYMENT = "DUPLICATE_PAYMENT", "Duplicate payment"
        AMOUNT_MISMATCH = "AMOUNT_MISMATCH", "Amount mismatch"
        PAID_AFTER_COD_SWITCH = "PAID_AFTER_COD_SWITCH", "Paid after COD switch"
        RECONCILE_STUCK = "RECONCILE_STUCK", "Reconcile stuck"
        UNMATCHED_EVENT = "UNMATCHED_EVENT", "Unmatched event"

    order = models.ForeignKey(
        Order,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="payment_reviews",
    )
    payment_id = models.CharField(max_length=80, blank=True, default="")
    reason = models.CharField(max_length=32, choices=Reason.choices)
    created_at = models.DateTimeField(default=timezone.now)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="resolved_payment_reviews",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["order", "reason", "payment_id"],
                condition=models.Q(order__isnull=False),
                name="uniq_payment_review_with_order",
            ),
            models.UniqueConstraint(
                fields=["reason", "payment_id"],
                condition=models.Q(order__isnull=True),
                name="uniq_payment_review_without_order",
            ),
        ]

    def __str__(self) -> str:
        return f"Review {self.reason} (payment: {self.payment_id}) for order {self.order_id}"


class OrderAfterSaleRequest(UUIDModel):
    """
    Parent request for cancellation, size exchange, or damaged/incorrect item.
    Tracks replacement item reservation, physical inspection, restocking, and audit trail.
    """

    class RequestType(models.TextChoices):
        CANCEL = "CANCEL", "Cancellation"
        EXCHANGE = "EXCHANGE", "Size Exchange"
        RETURN = "RETURN", "Return for Refund"
        REPLACE = "REPLACE", "Replacement for Defect/Damage"

    class Status(models.TextChoices):
        REQUESTED = "REQUESTED", "Requested"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        INSPECTED = "INSPECTED", "Inspected"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    class Reason(models.TextChoices):
        # Size exchange
        TOO_SMALL = "TOO_SMALL", "Too small"
        TOO_BIG = "TOO_BIG", "Too big"
        # Fault / wrong item
        DAMAGED = "DAMAGED", "Damaged item"
        DEFECTIVE = "DEFECTIVE", "Defective fabric/stitching"
        WRONG_ITEM = "WRONG_ITEM", "Wrong item delivered"
        # Cancellation
        CHANGE_OF_MIND = "CHANGE_OF_MIND", "Change of mind"
        ORDERED_BY_MISTAKE = "ORDERED_BY_MISTAKE", "Ordered by mistake"
        DELIVERY_DELAY = "DELIVERY_DELAY", "Delivery delay"
        OTHER = "OTHER", "Other"

    class RestockCondition(models.TextChoices):
        RESTOCKABLE = "RESTOCKABLE", "Restockable"
        DAMAGED_DISCARD = "DAMAGED_DISCARD", "Damaged / Discard"
        UNINSPECTED = "UNINSPECTED", "Uninspected"

    # TODO(D4): Handover method defaults to unset until staff sets SCHOOL_DESK, POST_RETURN, or DOOR_SWAP.
    class HandoverMethod(models.TextChoices):
        SCHOOL_DESK = "SCHOOL_DESK", "School uniform desk"
        POST_RETURN = "POST_RETURN", "India Post return parcel"
        DOOR_SWAP = "DOOR_SWAP", "Swap at door"

    # TODO(D9): Legacy delivered orders without delivery event use window_check=PENDING and reserve stock.
    class WindowCheck(models.TextChoices):
        NOT_APPLICABLE = "NOT_APPLICABLE", "Not applicable"
        PENDING = "PENDING", "Pending staff check"
        CONFIRMED = "CONFIRMED", "Confirmed by staff"
        REJECTED = "REJECTED", "Rejected by staff"

    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="after_sales_requests",
    )
    order_item = models.ForeignKey(
        OrderItem,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="after_sales_requests",
        help_text="Target order line. Null if full order cancellation.",
    )
    request_type = models.CharField(max_length=24, choices=RequestType.choices)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.REQUESTED)
    reason = models.CharField(max_length=32, choices=Reason.choices)
    reason_details = models.TextField(blank=True, default="")
    photo_key = models.CharField(max_length=255, blank=True, default="")
    from_size = models.CharField(max_length=50, blank=True, default="")
    target_size = models.CharField(max_length=50, blank=True, default="")
    target_variant = models.ForeignKey(
        "catalog.ProductVariant",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    quantity = models.PositiveIntegerField(default=1)
    charge_paise = models.BigIntegerField(default=0)
    is_stock_reserved = models.BooleanField(default=False)
    is_item_restocked = models.BooleanField(default=False)
    restock_condition = models.CharField(
        max_length=24,
        choices=RestockCondition.choices,
        default=RestockCondition.UNINSPECTED,
        blank=True,
    )
    exchange_record = models.ForeignKey(
        OrderItemExchange,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="after_sale_requests",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_after_sales_requests",
    )
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_after_sales_requests",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # Handover arrangement set by staff
    # TODO(D4): Handover method defaults to unset until staff sets SCHOOL_DESK, POST_RETURN, or DOOR_SWAP.
    handover_method = models.CharField(
        max_length=24,
        choices=HandoverMethod.choices,
        blank=True,
        default="",
        help_text="Handover arrangement chosen by staff.",
    )
    # Legacy window verification fields
    # TODO(D9): Legacy delivered orders without delivery event use window_check=PENDING and reserve stock.
    window_check = models.CharField(
        max_length=24,
        choices=WindowCheck.choices,
        default=WindowCheck.NOT_APPLICABLE,
        blank=True,
        help_text="Staff verification state for legacy orders without delivery timestamp.",
    )
    window_starts_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="First DELIVERED/COLLECTED timestamp used to count the 7-day exchange window.",
    )
    window_confirmed_start = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Staff-confirmed delivery date for legacy orders.",
    )
    window_confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="Staff member who confirmed legacy delivery date.",
    )
    window_confirmed_at = models.DateTimeField(null=True, blank=True)
    window_note = models.TextField(
        blank=True,
        default="",
        help_text="Staff notes on delivery date confirmation.",
    )
    idempotency_key = models.CharField(
        max_length=64,
        blank=True,
        default="",
        db_index=True,
    )
    staff_notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["order", "created_at"], name="idx_asreq_order_created"),
            models.Index(fields=["status", "created_at"], name="idx_asreq_status_created"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["order_item"],
                condition=models.Q(
                    order_item__isnull=False,
                    status__in=["REQUESTED", "APPROVED", "INSPECTED"],
                ),
                name="uniq_active_after_sale_per_item",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.request_type} ({self.status}) for order {self.order.order_number}"


class OrderRefund(UUIDModel):
    """
    Durable record of a financial refund or COD repayment.
    Separated from order/return status: a status change alone never marks funds refunded.
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        PROCESSING = "PROCESSING", "Processing"
        SUCCEEDED = "SUCCEEDED", "Succeeded"
        FAILED = "FAILED", "Failed"
        RETRY = "RETRY", "Needs Retry"

    class RepaymentChannel(models.TextChoices):
        ORIGINAL_PAYMENT = "ORIGINAL_PAYMENT", "Original Payment (Razorpay)"
        CASH = "CASH", "Cash at School Office"
        NOT_APPLICABLE = "NOT_APPLICABLE", "Not Applicable (Unpaid)"

    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="refunds",
    )
    request = models.ForeignKey(
        OrderAfterSaleRequest,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="refunds",
    )
    order_item = models.ForeignKey(
        OrderItem,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="refunds",
    )
    payment_attempt = models.ForeignKey(
        PaymentAttempt,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="refunds",
    )
    amount_paise = models.BigIntegerField()
    currency = models.CharField(max_length=10, default="INR")
    payment_method = models.CharField(
        max_length=12,
        choices=Order.PaymentMethod.choices,
    )
    repayment_channel = models.CharField(
        max_length=24,
        choices=RepaymentChannel.choices,
        default=RepaymentChannel.ORIGINAL_PAYMENT,
    )
    status = models.CharField(
        max_length=24,
        choices=Status.choices,
        default=Status.PENDING,
    )
    idempotency_key = models.CharField(max_length=128, unique=True, default=uuid.uuid4)
    razorpay_refund_id = models.CharField(max_length=100, blank=True, default="")
    razorpay_payment_id = models.CharField(max_length=100, blank=True, default="")
    failure_reason = models.TextField(blank=True, default="")
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="processed_refunds",
    )
    created_at = models.DateTimeField(default=timezone.now)
    processed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["order", "created_at"], name="idx_ordrefund_order_created"),
            models.Index(fields=["status", "created_at"], name="idx_ordrefund_status_created"),
            models.Index(fields=["razorpay_refund_id"], name="idx_ordrefund_rzp_ref_id"),
        ]

    def __str__(self) -> str:
        return f"Refund {self.id} (₹{self.amount_paise / 100:.2f}) - {self.status}"


