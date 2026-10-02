from django.conf import settings
from django.db import models
from django.utils import timezone
from common.models import UUIDModel
from common.cache_utils import invalidate_catalog_cache


class Category(UUIDModel):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    description = models.TextField(blank=True, default="")
    display_order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Categories"
        ordering = ["display_order", "name"]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        invalidate_catalog_cache()

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        invalidate_catalog_cache()

    def __str__(self) -> str:
        return self.name


class Product(UUIDModel):
    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        related_name="products",
    )
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="products",
        help_text="Null for generic items; set for school-specific items.",
    )
    # Denormalised city_id so Admin scope filter is a single WHERE on Product.city_id
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="products",
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    images = models.JSONField(default=list, blank=True)
    cost_price = models.DecimalField(max_digits=10, decimal_places=2)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    customisation_schema = models.JSONField(
        default=dict,
        blank=True,
        help_text="JSON schema for optional/required order-line customisation data.",
    )
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(
                fields=["school", "category", "active"],
                name="idx_prod_school_cat_active",
            ),
            models.Index(
                fields=["city", "category", "active"],
                name="idx_prod_city_cat_active",
            ),
            models.Index(
                fields=["category", "active"],
                name="idx_prod_cat_active",
            ),
        ]

    def save(self, *args, **kwargs):
        if self.school_id:
            self.city_id = self.school.city_id
        else:
            self.city_id = None
        super().save(*args, **kwargs)
        invalidate_catalog_cache()

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        invalidate_catalog_cache()

    def __str__(self) -> str:
        scope = self.school.code if self.school_id else "ALL"
        return f"{self.name} ({scope})"


class ProductVariant(UUIDModel):
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="variants",
    )
    # Denormalised school_id and city_id for single-WHERE stock scoping
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="product_variants",
    )
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="product_variants",
    )
    size = models.CharField(max_length=50)
    sku = models.CharField(max_length=80, unique=True)
    stock_quantity = models.IntegerField(default=0)
    low_stock_threshold = models.IntegerField(default=10)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["product_id", "size"]
        indexes = [
            models.Index(fields=["product"], name="idx_variant_product"),
            models.Index(fields=["school", "active"], name="idx_variant_school_active"),
            models.Index(fields=["city", "active"], name="idx_variant_city_active"),
        ]

    def save(self, *args, **kwargs):
        if self.product_id:
            self.school_id = self.product.school_id
            self.city_id = self.product.city_id or (
                self.product.school.city_id if self.product.school_id else None
            )
        super().save(*args, **kwargs)
        invalidate_catalog_cache()

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        invalidate_catalog_cache()

    def __str__(self) -> str:
        return f"{self.sku} ({self.product.name} - {self.size})"


class StockMovement(UUIDModel):
    class Reason(models.TextChoices):
        INITIAL_STOCK = "INITIAL_STOCK", "Initial Stock"
        RESTOCK = "RESTOCK", "Restock"
        ORDER_PLACED = "ORDER_PLACED", "Order Placed"
        ORDER_CANCELLED = "ORDER_CANCELLED", "Order Cancelled"
        ADJUSTMENT = "ADJUSTMENT", "Manual Adjustment"
        DAMAGE = "DAMAGE", "Damaged / Write-off"

    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.CASCADE,
        related_name="stock_movements",
    )
    # Denormalised school_id and city_id for single-WHERE stock movement scoping
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    quantity_change = models.IntegerField()
    reason = models.CharField(
        max_length=50,
        choices=Reason.choices,
        default=Reason.ADJUSTMENT,
    )
    reference_order = models.ForeignKey(
        "orders.Order",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["variant", "created_at"],
                name="idx_stockmov_variant_created",
            ),
            models.Index(
                fields=["city", "created_at"],
                name="idx_stockmov_city_created",
            ),
            models.Index(
                fields=["school", "created_at"],
                name="idx_stockmov_school_created",
            ),
        ]

    def save(self, *args, **kwargs):
        if self.variant_id:
            self.school_id = self.variant.school_id
            self.city_id = self.variant.city_id
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        sign = "+" if self.quantity_change >= 0 else ""
        return f"{self.variant.sku}: {sign}{self.quantity_change} ({self.reason})"
