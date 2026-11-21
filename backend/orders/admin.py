from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db.models import Exists, OuterRef

from .models import (
    Order,
    OrderAfterSaleRequest,
    OrderItem,
    OrderItemExchange,
    OrderRefund,
    OrderStatusEvent,
    PaymentAttempt,
    PaymentEvent,
    PaymentReview,
    PhotoConsent,
)
from .status import can_transition_order


class OrderAfterSaleRequestInline(admin.TabularInline):
    model = OrderAfterSaleRequest
    extra = 0
    fields = (
        "id",
        "request_type",
        "status",
        "reason",
        "from_size",
        "target_size",
        "quantity",
        "is_stock_reserved",
        "is_item_restocked",
        "restock_condition",
        "created_at",
    )
    readonly_fields = fields
    can_delete = False


class OrderRefundInline(admin.TabularInline):
    model = OrderRefund
    extra = 0
    fields = (
        "id",
        "amount_paise",
        "payment_method",
        "repayment_channel",
        "status",
        "razorpay_refund_id",
        "created_at",
        "processed_at",
    )
    readonly_fields = fields
    can_delete = False


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
        PaymentAttemptInline,
        PaymentReviewInline,
        OrderAfterSaleRequestInline,
        OrderRefundInline,
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


@admin.register(OrderAfterSaleRequest)
class OrderAfterSaleRequestAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "order",
        "request_type",
        "status",
        "reason",
        "from_size",
        "target_size",
        "quantity",
        "is_stock_reserved",
        "is_item_restocked",
        "restock_condition",
        "created_at",
    )
    list_filter = ("request_type", "status", "reason", "is_stock_reserved", "is_item_restocked", "restock_condition")
    search_fields = ("order__order_number", "order_item__variant__sku", "reason_details", "staff_notes")
    raw_id_fields = ("order", "order_item", "target_variant", "exchange_record", "created_by", "reviewed_by")
    readonly_fields = ("id", "created_at", "updated_at")
    actions = ["approve_requests", "mark_inspected_and_restock", "complete_requests", "reject_requests"]

    @admin.action(description="Approve selected after-sales requests")
    def approve_requests(self, request, queryset):
        from .after_sales import review_after_sale_request
        for obj in queryset.filter(status=OrderAfterSaleRequest.Status.REQUESTED):
            review_after_sale_request(obj, request.user, "APPROVE", notes="Approved via Django admin.")

    @admin.action(description="Mark inspected & restock eligible items")
    def mark_inspected_and_restock(self, request, queryset):
        from .after_sales import review_after_sale_request
        for obj in queryset.exclude(status=OrderAfterSaleRequest.Status.COMPLETED):
            review_after_sale_request(
                obj, request.user, "INSPECT", notes="Inspected via Django admin.",
                restock_condition=OrderAfterSaleRequest.RestockCondition.RESTOCKABLE
            )

    @admin.action(description="Complete selected after-sales requests")
    def complete_requests(self, request, queryset):
        from .after_sales import review_after_sale_request
        for obj in queryset.exclude(status__in=[OrderAfterSaleRequest.Status.COMPLETED, OrderAfterSaleRequest.Status.REJECTED]):
            review_after_sale_request(obj, request.user, "COMPLETE", notes="Completed via Django admin.")

    @admin.action(description="Reject selected requests (releases reserved stock)")
    def reject_requests(self, request, queryset):
        from .after_sales import review_after_sale_request
        for obj in queryset.exclude(status__in=[OrderAfterSaleRequest.Status.COMPLETED, OrderAfterSaleRequest.Status.REJECTED]):
            review_after_sale_request(obj, request.user, "REJECT", notes="Rejected via Django admin.")


@admin.register(OrderRefund)
class OrderRefundAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "order",
        "amount_paise",
        "currency",
        "payment_method",
        "repayment_channel",
        "status",
        "razorpay_refund_id",
        "created_at",
        "processed_at",
    )
    list_filter = ("status", "payment_method", "repayment_channel")
    search_fields = ("order__order_number", "razorpay_refund_id", "razorpay_payment_id", "notes")
    raw_id_fields = ("order", "request", "order_item", "payment_attempt", "processed_by")
    readonly_fields = ("id", "created_at", "processed_at")
    actions = ["process_selected_refunds"]

    @admin.action(description="Process or retry selected refunds")
    def process_selected_refunds(self, request, queryset):
        from .after_sales import process_order_refund
        for obj in queryset.exclude(status=OrderRefund.Status.SUCCEEDED):
            process_order_refund(obj, actor=request.user)

