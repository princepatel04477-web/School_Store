from django.contrib import admin

from .models import StockBalance, StockMovement


@admin.register(StockBalance)
class StockBalanceAdmin(admin.ModelAdmin):
    list_display = (
        "city",
        "variant",
        "stock_quantity",
        "low_stock_threshold",
        "is_low_stock",
        "updated_at",
    )
    list_filter = ("city", "is_low_stock", "variant__product__category")
    search_fields = ("variant__sku", "variant__product__name", "city__name", "city__code")
    # stock_quantity is never edited directly — every change must go through
    # a StockMovement (inventory.services.apply_stock_movement).
    readonly_fields = ("id", "stock_quantity", "is_low_stock", "updated_at")
    raw_id_fields = ("city", "variant")
    list_select_related = ("city", "variant", "variant__product")
    show_full_result_count = False


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = (
        "city",
        "school",
        "variant",
        "quantity_change",
        "reason",
        "reference_order",
        "created_by",
        "created_at",
    )
    list_filter = ("city", "school", "reason", "created_at")
    search_fields = (
        "variant__sku",
        "variant__product__name",
        "reference_order__order_number",
        "school__code",
    )
    readonly_fields = ("id", "created_at")
    raw_id_fields = ("variant", "city", "school", "reference_order", "created_by")
    list_select_related = ("city", "school", "variant", "reference_order", "created_by")
    show_full_result_count = False

    # Append-only audit ledger: rows are written exclusively by
    # inventory.services.apply_stock_movement so the balance and the ledger
    # can never drift apart. The admin is read-only.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
