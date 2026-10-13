from django.contrib import admin

from .models import Category, Product, ProductVariant, SizeChartRow


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
        "product_type",
        "school",
        "gender",
        "needs_review",
        "cost_price",
        "selling_price",
        "active",
        "created_at",
    )
    list_filter = ("active", "needs_review", "category", "product_type", "school", "gender")
    search_fields = ("name", "description")
    filter_horizontal = ("grades",)
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("category", "school")
    inlines = [ProductVariantInline]


class SizeChartRowInline(admin.StackedInline):
    model = SizeChartRow
    extra = 0
    max_num = 1
    readonly_fields = ("created_at", "updated_at")


@admin.register(ProductVariant)
class ProductVariantAdmin(admin.ModelAdmin):
    list_display = ("sku", "product", "size", "active", "created_at")
    list_filter = ("active", "product__category", "product__school")
    search_fields = ("sku", "product__name", "size")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("product", "product__category", "product__school")
    inlines = [SizeChartRowInline]


@admin.register(SizeChartRow)
class SizeChartRowAdmin(admin.ModelAdmin):
    list_display = (
        "variant",
        "size",
        "height_cm_min",
        "height_cm_max",
        "weight_kg_min",
        "weight_kg_max",
        "updated_at",
    )
    list_filter = ("variant__product__school", "variant__product__category")
    search_fields = ("variant__sku", "variant__product__name", "variant__size")
    raw_id_fields = ("variant",)
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("variant", "variant__product")
    show_full_result_count = False

    @admin.display(description="Size", ordering="variant__size")
    def size(self, obj):
        return obj.variant.size
