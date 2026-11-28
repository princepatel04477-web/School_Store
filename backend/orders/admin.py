from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db.models import Exists, OuterRef

from .models import (
    Order,
    OrderItem,
    OrderItemExchange,
    OrderPacking,
    OrderStatusEvent,
    PaymentAttempt,
    PaymentEvent,
    PaymentReview,
    PhotoConsent,
    Shipment,
    ShipmentCorrection,
)
from .status import can_transition_order


class PaymentAttemptInline(admin.TabularInline):
    model = PaymentAttempt
    extra = 0
    readonly_fields = (
        "id",
        "razorpay_payment_id",
        "amount_paise",
        "currency",
        "status",
        "method",
        "error_code",
        "first_seen_at",
    )
    can_delete = False


class PaymentReviewInline(admin.TabularInline):
    model = PaymentReview
    extra = 0
    readonly_fields = (
        "id",
        "reason",
        "payment_id",
        "created_at",
        "resolved_at",
        "resolved_by",
    )
    can_delete = False


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    raw_id_fields = ("variant", "category")
    readonly_fields = ("id",)


class OrderStatusEventInline(admin.TabularInline):
    model = OrderStatusEvent
    extra = 0
    raw_id_fields = ("changed_by",)
    readonly_fields = ("id", "timestamp")


class OrderPackingInline(admin.StackedInline):
    model = OrderPacking
    extra = 0
    raw_id_fields = ("claimed_by", "packed_by", "issue_reported_by")
    readonly_fields = ("id", "claimed_at", "packed_at", "issue_reported_at")


class ShipmentInline(admin.StackedInline):
    model = Shipment
    extra = 0
    raw_id_fields = ("created_by",)
    readonly_fields = ("id", "created_at")


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        "order_number",
        "student",
        "school",
        "branch",
        "city",
        "placed_by",
        "placed_by_role",
        "payer",
        "fulfillment_type",
        "status",
        "payment_status",
        "total",
        "created_at",
    )
    list_filter = ("status", "payment_status", "placed_by_role", "city", "school", "branch")
    search_fields = ("order_number", "student__name", "student__gr_number")
    readonly_fields = (
        "id",
        "status",
        "payment_status",
        "payment_method",
        "subtotal",
        "total",
        "razorpay_order_id",
        "razorpay_payment_id",
        "razorpay_signature",
        "created_at",
        "updated_at",
    )
    raw_id_fields = ("placed_by", "payer", "student", "school", "branch", "city")
    list_select_related = ("student", "school", "branch", "city", "placed_by", "payer")
    show_full_result_count = False
    inlines = [
        OrderItemInline,
        OrderStatusEventInline,
        OrderPackingInline,
        ShipmentInline,
        PaymentAttemptInline,
        PaymentReviewInline,
    ]

    def save_model(self, request, obj, form, change):
        if change and "status" in form.changed_data:
            orig = Order.objects.get(pk=obj.pk)
            can, reason = can_transition_order(orig, obj.status)
            if not can:
                raise ValidationError(f"Cannot change status from {orig.status} to {obj.status}: {reason}")
        super().save_model(request, obj, form, change)


@admin.register(PaymentAttempt)
class PaymentAttemptAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "order",
        "razorpay_payment_id",
        "amount_paise",
        "currency",
        "status",
        "method",
        "error_code",
        "first_seen_at",
    )
    list_filter = ("status", "method", "currency", "last_source")
    search_fields = ("razorpay_payment_id", "order__order_number")
    readonly_fields = (
        "id",
        "order",
        "razorpay_payment_id",
        "amount_paise",
        "currency",
        "status",
        "method",
        "error_code",
        "error_reason",
        "last_source",
        "first_seen_at",
        "updated_at",
    )
    raw_id_fields = ("order",)
    show_full_result_count = False


@admin.register(PaymentEvent)
class PaymentEventAdmin(admin.ModelAdmin):
    list_display = (
        "event_id",
        "event_type",
        "razorpay_order_id",
        "razorpay_payment_id",
        "state",
        "tries",
        "received_at",
    )
    list_filter = ("event_type", "state")
    search_fields = ("event_id", "razorpay_order_id", "razorpay_payment_id")
    readonly_fields = (
        "id",
        "event_id",
        "event_type",
        "razorpay_order_id",
        "razorpay_payment_id",
        "amount",
        "currency",
        "payload",
        "state",
        "tries",
        "next_try_at",
        "last_error",
        "received_at",
    )
    show_full_result_count = False


@admin.register(PaymentReview)
class PaymentReviewAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "order",
        "reason",
        "payment_id",
        "created_at",
        "resolved_at",
        "resolved_by",
    )
    list_filter = ("reason",)
    search_fields = ("order__order_number", "payment_id", "notes")
    readonly_fields = (
        "id",
        "order",
        "reason",
        "payment_id",
        "created_at",
    )
    raw_id_fields = ("order", "resolved_by")
    show_full_result_count = False


FIT_FIELDS = (
    "fit_height_cm",
    "fit_weight_kg",
    "fit_shoulder_cm",
    "fit_shoulder_confidence",
    "recommended_size",
    "recommended_alt_size",
    "recommendation_status",
    "chosen_size",
)
SIZE_REASONS = (OrderItemExchange.Reason.TOO_SMALL, OrderItemExchange.Reason.TOO_BIG)


class SizeExchangeFilter(admin.SimpleListFilter):
    """Was this line exchanged because the size was wrong?"""

    title = "size exchange"
    parameter_name = "size_exchange"

    def lookups(self, request, model_admin):
        return (("yes", "Exchanged for size"), ("no", "No size exchange"))

    def queryset(self, request, queryset):
        size_exchange = Exists(
            OrderItemExchange.objects.filter(order_item=OuterRef("pk"), reason__in=SIZE_REASONS)
        )
        if self.value() == "yes":
            return queryset.filter(size_exchange)
        if self.value() == "no":
            return queryset.filter(~size_exchange)
        return queryset


class OrderItemExchangeInline(admin.TabularInline):
    model = OrderItemExchange
    extra = 0
    fields = ("from_size", "to_size", "reason", "note", "created_by", "created_at")
    readonly_fields = ("created_by", "created_at")


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = (
        "order",
        "variant",
        "category",
        "quantity",
        "chosen_size",
        "recommended_size",
        "recommendation_status",
        "unit_price_snapshot",
        "unit_cost_snapshot",
    )
    list_filter = ("category", "recommendation_status", SizeExchangeFilter)
    search_fields = ("order__order_number", "variant__sku")
    readonly_fields = ("id", *FIT_FIELDS)
    raw_id_fields = ("order", "variant", "category")
    list_select_related = ("order", "variant", "category")
    show_full_result_count = False
    inlines = [OrderItemExchangeInline]

    def save_formset(self, request, form, formset, change):
        for exchange in formset.save(commit=False):
            if not exchange.created_by_id:
                exchange.created_by = request.user
            exchange.save()
        for obj in formset.deleted_objects:
            obj.delete()


@admin.register(OrderItemExchange)
class OrderItemExchangeAdmin(admin.ModelAdmin):
    list_display = ("order_item", "from_size", "to_size", "reason", "created_by", "created_at")
    list_filter = ("reason",)
    search_fields = ("order_item__order__order_number", "order_item__variant__sku")
    raw_id_fields = ("order_item",)
    readonly_fields = ("id", "created_by", "created_at")
    list_select_related = ("order_item", "order_item__order", "order_item__variant", "created_by")
    show_full_result_count = False

    def save_model(self, request, obj, form, change):
        if not obj.created_by_id:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(PhotoConsent)
class PhotoConsentAdmin(admin.ModelAdmin):
    list_display = (
        "student",
        "parent",
        "purpose",
        "policy_version",
        "keep_for_next_year",
        "created_at",
        "withdrawn_at",
    )
    list_filter = ("purpose", "keep_for_next_year")
    search_fields = ("student__name", "student__gr_number", "parent__username")
    readonly_fields = (
        "id",
        "parent",
        "student",
        "purpose",
        "policy_version",
        "keep_for_next_year",
        "created_at",
        "ip",
        "user_agent",
        "withdrawn_at",
    )
    raw_id_fields = ("parent", "student")
    list_select_related = ("parent", "student")
    show_full_result_count = False

    def has_add_permission(self, request):
        return False


@admin.register(OrderStatusEvent)
class OrderStatusEventAdmin(admin.ModelAdmin):
    list_display = ("order", "status", "changed_by", "timestamp", "note")
    list_filter = ("status",)
    search_fields = ("order__order_number", "note")
    readonly_fields = ("id", "timestamp")
    raw_id_fields = ("order", "changed_by")
    list_select_related = ("order", "changed_by")
    show_full_result_count = False


class ShipmentCorrectionInline(admin.TabularInline):
    model = ShipmentCorrection
    extra = 0
    raw_id_fields = ("changed_by",)
    readonly_fields = ("id", "previous_number", "new_number", "changed_at")


@admin.register(Shipment)
class ShipmentAdmin(admin.ModelAdmin):
    list_display = ("consignment_number", "article_key", "carrier", "order", "booked_at", "created_by", "created_at")
    search_fields = ("consignment_number", "article_key", "order__order_number")
    readonly_fields = ("id", "article_key", "created_at")
    raw_id_fields = ("order", "created_by")
    list_select_related = ("order", "created_by")
    show_full_result_count = False
    inlines = [ShipmentCorrectionInline]
