from django.contrib import admin

from .models import Category, FitReading, Product, ProductVariant, SizeChartRow


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "display_order", "active", "created_at")
    list_filter = ("active",)
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("id", "created_at", "updated_at")


class SizeChartRowInline(admin.TabularInline):
    model = SizeChartRow
    extra = 0
    readonly_fields = ("id",)


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
    inlines = [ProductVariantInline, SizeChartRowInline]


@admin.register(FitReading)
class FitReadingAdmin(admin.ModelAdmin):
    list_display = ("shoulder_cm", "confidence", "user", "created_at")
    readonly_fields = ("id", "user", "shoulder_cm", "confidence", "created_at")
    list_select_related = ("user",)

    def has_add_permission(self, request):
        return False


@admin.register(ProductVariant)
class ProductVariantAdmin(admin.ModelAdmin):
    list_display = ("sku", "product", "size", "active", "created_at")
    list_filter = ("active", "product__category", "product__school")
    search_fields = ("sku", "product__name", "size")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("product", "product__category", "product__school")
