from django.db import models
from django.db.models import Q

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
    class Gender(models.TextChoices):
        BOY = "boy", "Boy"
        GIRL = "girl", "Girl"
        UNISEX = "unisex", "Unisex"

    class ProductType(models.TextChoices):
        SOCKS = "SOCKS", "Socks"
        BELT = "BELT", "Belt"
        TIE = "TIE", "Tie"

    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        related_name="products",
    )
    product_type = models.CharField(
        max_length=20,
        choices=ProductType.choices,
        blank=True,
        null=True,
        help_text="Subtype for Uniform Accessories (Socks, Belt, Tie).",
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
    grades = models.ManyToManyField(
        "schools.Grade",
        blank=True,
        related_name="products",
        db_table="catalog_product_grades",
        help_text="Grades this product is designated for.",
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    # Absolute object-storage/CDN URLs only. Django never serves image bytes;
    # list responses expose one resized thumbnail, detail exposes all URLs.
    images = models.JSONField(default=list, blank=True)
    # Required so profit/margin can always be computed; both prices are
    # snapshotted onto OrderItem (unit_cost_snapshot / unit_price_snapshot)
    # at the moment of sale.
    cost_price = models.DecimalField(max_digits=10, decimal_places=2)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    gender = models.CharField(
        max_length=10,
        choices=Gender.choices,
        null=True,
        blank=False,
        help_text="Designated gender: boy, girl, or unisex.",
    )
    needs_review = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Flag indicating this product needs review (e.g. unassigned gender).",
    )
    class_from = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Lowest class this item applies to (legacy / school items only).",
    )
    class_to = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Highest class this item applies to (legacy / school items only).",
    )
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
                fields=["school", "class_from", "gender"],
                name="idx_prod_sch_class_gen",
            ),
            models.Index(
                fields=["school", "class_from", "class_to", "gender"],
                name="idx_prod_sch_cls_rng_gen",
            ),
            models.Index(
                fields=["school", "gender"],
                name="idx_prod_school_gender",
            ),
            models.Index(
                fields=["school", "category", "gender", "active"],
                name="idx_prod_sch_cat_gen_act",
            ),
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
            models.Index(
                fields=["active", "id"],
                name="idx_product_active_id",
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

    @property
    def thumbnail(self) -> str | None:
        from .images import product_thumbnail

        return product_thumbnail(self.images)

    def __str__(self) -> str:
        scope = self.school.code if self.school_id else "ALL"
        return f"{self.name} ({scope})"


class ProductVariant(UUIDModel):
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="variants",
    )
    # Denormalised product scope for indexed city/school catalogue filtering.
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
