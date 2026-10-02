from django.contrib import admin
from .models import Order, OrderItem, OrderStatusEvent


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
        "city",
        "placed_by",
        "placed_by_role",
        "status",
        "payment_status",
        "total",
        "created_at",
    )
    list_filter = ("status", "payment_status", "placed_by_role", "city", "school")
    search_fields = ("order_number", "student__name", "student__gr_number")
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("placed_by", "student", "school", "city")
    list_select_related = ("student", "school", "city", "placed_by")
    show_full_result_count = False
    inlines = [OrderItemInline, OrderStatusEventInline]


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = (
        "order",
        "variant",
        "category",
        "quantity",
        "unit_price_snapshot",
        "unit_cost_snapshot",
    )
    list_filter = ("category",)
    search_fields = ("order__order_number", "variant__sku")
    readonly_fields = ("id",)
    raw_id_fields = ("order", "variant", "category")
    list_select_related = ("order", "variant", "category")
    show_full_result_count = False


@admin.register(OrderStatusEvent)
class OrderStatusEventAdmin(admin.ModelAdmin):
    list_display = ("order", "status", "changed_by", "timestamp", "note")
    list_filter = ("status",)
    search_fields = ("order__order_number", "note")
    readonly_fields = ("id", "timestamp")
    raw_id_fields = ("order", "changed_by")
    list_select_related = ("order", "changed_by")
    show_full_result_count = False
