from django.db import models
from django.db.models import Q
from django.db.models.signals import m2m_changed
from django.dispatch import receiver

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
    is_required = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Explicit requirement flag: True if required uniform item, False if optional.",
    )
    material_composition = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text="Fabric or material composition (e.g. 65% Polyester, 35% Cotton).",
    )
    care_instructions = models.TextField(
        blank=True,
        default="",
        help_text="Specific washing or care instructions.",
    )
    fabric_care = models.TextField(
        blank=True,
        default="",
        help_text="Combined or custom fabric care description.",
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


class ProductCityPrice(UUIDModel):
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="city_prices",
    )
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.CASCADE,
        related_name="product_city_prices",
    )
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    cost_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["city__name", "product__name"]
        unique_together = [("product", "city")]
        indexes = [
            models.Index(fields=["product", "city"], name="idx_prod_city_price"),
            models.Index(fields=["city", "active"], name="idx_city_price_active"),
        ]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        invalidate_catalog_cache()

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        invalidate_catalog_cache()

    def __str__(self) -> str:
        return f"{self.product.name} @ {self.city.name}: Rs {self.selling_price}"


class ProductRequirement(UUIDModel):
    class Season(models.TextChoices):
        ALL = "ALL", "All Seasons"
        SUMMER = "SUMMER", "Summer"
        WINTER = "WINTER", "Winter"

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="requirements",
    )
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="product_requirements",
        help_text="School this requirement applies to. If null, applies to product's school or universally.",
    )
    grade = models.ForeignKey(
        "schools.Grade",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="product_requirements",
        help_text="Specific grade this requirement applies to.",
    )
    class_from = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Lowest class this requirement applies to.",
    )
    class_to = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Highest class this requirement applies to.",
    )
    campus = models.ForeignKey(
        "schools.SchoolBranch",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="product_requirements",
        help_text="Specific campus/branch where this requirement applies.",
    )
    gender = models.CharField(
        max_length=10,
        choices=Product.Gender.choices,
        blank=True,
        null=True,
        help_text="Gender requirement override: boy, girl, unisex, or null for all.",
    )
    season = models.CharField(
        max_length=20,
        choices=Season.choices,
        blank=True,
        default="",
        help_text="Season: e.g. SUMMER, WINTER, ALL, or blank.",
    )
    required = models.BooleanField(
        default=True,
        help_text="True if item is mandatory/required; False if explicitly optional.",
    )
    min_quantity = models.PositiveSmallIntegerField(
        default=1,
        help_text="Suggested or minimum quantity.",
    )
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["product", "school", "grade"]
        indexes = [
            models.Index(fields=["product", "required"], name="idx_req_prod_req"),
            models.Index(fields=["school", "required"], name="idx_req_school_req"),
            models.Index(fields=["campus", "required"], name="idx_req_campus_req"),
        ]

    def save(self, *args, **kwargs):
        if not self.school_id and self.product_id and self.product.school_id:
            self.school_id = self.product.school_id
        super().save(*args, **kwargs)
        invalidate_catalog_cache()

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        invalidate_catalog_cache()

    def __str__(self) -> str:
        status = "Required" if self.required else "Optional"
        scope = self.school.code if self.school else "ALL"
        return f"{self.product.name} - {status} ({scope})"


def is_product_required(
    product: Product,
    school_id=None,
    grade=None,
    gender=None,
    campus_id=None,
    season=None,
) -> bool:
    """
    Evaluates whether a product is required for the given context
    (school, grade/class, gender, campus, season).

    Rules:
    - Never infers 'required' from school ownership or required customisation fields.
    - If explicit matching ProductRequirement records exist, the most specific matching rule determines required status.
    - If no specific ProductRequirement exists, falls back to product.is_required.
    """
    reqs = getattr(product, "_prefetched_requirements", None)
    if reqs is None:
        if hasattr(product, "requirements"):
            try:
                reqs = list(product.requirements.all())
            except Exception:
                reqs = []
        else:
            reqs = []

    if not reqs:
        return bool(getattr(product, "is_required", False))

    s_id = str(school_id) if school_id else None
    c_id = str(campus_id) if campus_id else None

    class_num = None
    grade_obj_id = None
    if grade:
        if hasattr(grade, "id"):
            grade_obj_id = str(grade.id)
            grade_name = getattr(grade, "name", "")
        else:
            grade_name = str(grade)
        import re
        m = re.search(r"\d+", grade_name)
        if m:
            class_num = int(m.group())

    norm_gender = str(gender).strip().lower() if gender else None
    if norm_gender in ("boy", "male", "m"):
        target_gender = Product.Gender.BOY
    elif norm_gender in ("girl", "female", "f"):
        target_gender = Product.Gender.GIRL
    else:
        target_gender = None

    norm_season = str(season).strip().upper() if season else None

    matching_rules = []
    for r in reqs:
        if not r.active:
            continue
        # School match
        if r.school_id and s_id and str(r.school_id) != s_id:
            continue
        # Campus match
        if r.campus_id and c_id and str(r.campus_id) != c_id:
            continue
        if r.campus_id and not c_id:
            continue
        # Gender match
        if r.gender and target_gender:
            if r.gender != Product.Gender.UNISEX and r.gender != target_gender:
                continue
        # Season match
        if r.season and r.season != ProductRequirement.Season.ALL and norm_season:
            if r.season.upper() != norm_season:
                continue
        # Grade / Class match
        if r.grade_id and grade_obj_id:
            if str(r.grade_id) != grade_obj_id:
                continue
        if class_num is not None:
            if r.class_from is not None and class_num < r.class_from:
                continue
            if r.class_to is not None and class_num > r.class_to:
                continue

        score = 0
        if r.campus_id:
            score += 8
        if r.grade_id:
            score += 4
        elif r.class_from is not None or r.class_to is not None:
            score += 2
        if r.gender and r.gender != Product.Gender.UNISEX:
            score += 2
        if r.season and r.season != ProductRequirement.Season.ALL:
            score += 2
        if r.school_id:
            score += 1

        matching_rules.append((score, r))

    if matching_rules:
        matching_rules.sort(key=lambda x: x[0], reverse=True)
        return bool(matching_rules[0][1].required)

    return bool(getattr(product, "is_required", False))


def _range_ok(low: str, high: str) -> Q:
    """Either end may be blank; when both are set, min <= max."""
    return (
        Q(**{f"{low}__isnull": True})
        | Q(**{f"{high}__isnull": True})
        | Q(**{f"{low}__lte": models.F(high)})
    )


SIZE_CHART_RANGES = (
    ("height_cm_min", "height_cm_max"),
    ("weight_kg_min", "weight_kg_max"),
    ("shoulder_cm_min", "shoulder_cm_max"),
    ("chest_cm_min", "chest_cm_max"),
)


class SizeChartRow(UUIDModel):
    """
    Body measurements that one size of one product fits, in cm and kg.

    One row per SKU, so the size label always comes from the variant and can
    never disagree with it. Orders copy the recommended and chosen sizes as
    plain values, so replacing a chart never touches order history.
    """

    variant = models.OneToOneField(
        ProductVariant,
        on_delete=models.CASCADE,
        related_name="size_chart_row",
    )
    height_cm_min = models.DecimalField(max_digits=4, decimal_places=1)
    height_cm_max = models.DecimalField(max_digits=4, decimal_places=1)
    weight_kg_min = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    weight_kg_max = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    shoulder_cm_min = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    shoulder_cm_max = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    chest_cm_min = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    chest_cm_max = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    length_cm = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["height_cm_min", "height_cm_max"]
        constraints = [
            models.CheckConstraint(
                condition=_range_ok(low, high),
                name=f"sizechart_{low.rsplit('_', 2)[0]}_range_valid",
            )
            for low, high in SIZE_CHART_RANGES
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        errors = {}
        for low, high in SIZE_CHART_RANGES:
            lo, hi = getattr(self, low), getattr(self, high)
            if lo is not None and hi is not None and lo > hi:
                errors[high] = f"Must be at least {low.replace('_', ' ')} ({lo})."
        if errors:
            raise ValidationError(errors)

    def __str__(self) -> str:
        return f"{self.variant.sku}: {self.height_cm_min}-{self.height_cm_max} cm"


class SizingSample(UUIDModel):
    """
    One past size suggestion and how it turned out, kept to improve the charts.

    Copied from an order line when its height and weight are cleared (see
    orders/fit_retention.py). Deliberately has no link to the student, order,
    parent or any user, and only the month, not the date. The product is kept
    so the sample can be read against the chart it was measured on.
    """

    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sizing_samples",
    )
    month = models.DateField(help_text="First day of the month the order was placed.")
    student_class = models.CharField(max_length=30, blank=True, default="")
    height_cm = models.DecimalField(max_digits=4, decimal_places=1)
    weight_kg = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    shoulder_cm = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    shoulder_confidence = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    recommended_size = models.CharField(max_length=50, blank=True, default="")
    recommended_alt_size = models.CharField(max_length=50, blank=True, default="")
    recommendation_status = models.CharField(max_length=20, blank=True, default="")
    chosen_size = models.CharField(max_length=50, blank=True, default="")
    final_size = models.CharField(
        max_length=50,
        blank=True,
        default="",
        help_text="The size kept after any exchanges.",
    )
    exchange_reason = models.CharField(
        max_length=12,
        blank=True,
        default="",
        help_text="TOO_SMALL / TOO_BIG from the last size exchange, NOT_SIZE, or blank.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-month"]
        indexes = [
            models.Index(fields=["product", "month"], name="idx_sizing_product_month"),
        ]

    def __str__(self) -> str:
        return f"{self.month:%Y-%m} {self.recommended_size} -> {self.final_size}"


@receiver(m2m_changed, sender=Product.grades.through)
def invalidate_catalog_on_grades_change(sender, action, **kwargs):
    # grades.set()/add()/remove() never call Product.save(), and a serializer
    # writes them after save(), so the cache must be invalidated here too.
    if action in ("post_add", "post_remove", "post_clear"):
        invalidate_catalog_cache()
