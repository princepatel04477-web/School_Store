from django.contrib import admin
from django.db.models import Exists, OuterRef

from .models import Order, OrderItem, OrderItemExchange, OrderStatusEvent


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
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("placed_by", "payer", "student", "school", "branch", "city")
    list_select_related = ("student", "school", "branch", "city", "placed_by", "payer")
    show_full_result_count = False
    inlines = [OrderItemInline, OrderStatusEventInline]


FIT_FIELDS = (
    "fit_height_cm",
    "fit_weight_kg",
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


@admin.register(OrderStatusEvent)
class OrderStatusEventAdmin(admin.ModelAdmin):
    list_display = ("order", "status", "changed_by", "timestamp", "note")
    list_filter = ("status",)
    search_fields = ("order__order_number", "note")
    readonly_fields = ("id", "timestamp")
    raw_id_fields = ("order", "changed_by")
    list_select_related = ("order", "changed_by")
    show_full_result_count = False
