from django.contrib import admin
from .models import Category, Product, ProductVariant, StockMovement


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "display_order", "active", "created_at")
    list_filter = ("active",)
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("id", "created_at", "updated_at")


class ProductVariantInline(admin.TabularInline):
    model = ProductVariant
    extra = 0
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "category",
        "school",
        "cost_price",
        "selling_price",
        "active",
        "created_at",
    )
    list_filter = ("active", "category", "school")
    search_fields = ("name", "description")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("category", "school")
    inlines = [ProductVariantInline]


@admin.register(ProductVariant)
class ProductVariantAdmin(admin.ModelAdmin):
    list_display = (
        "sku",
        "product",
        "size",
        "stock_quantity",
        "low_stock_threshold",
        "active",
        "created_at",
    )
    list_filter = ("active", "product__category", "product__school")
    search_fields = ("sku", "product__name", "size")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("product", "product__category", "product__school")


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = (
        "variant",
        "quantity_change",
        "reason",
        "reference_order",
        "created_by",
        "created_at",
    )
    list_filter = ("reason", "created_at")
    search_fields = ("variant__sku", "reference_order__order_number")
    readonly_fields = ("id", "created_at")
    list_select_related = ("variant", "reference_order", "created_by")
