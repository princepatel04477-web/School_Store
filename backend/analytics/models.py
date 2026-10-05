from django.db import models
from common.models import UUIDModel


class DailySalesSummary(UUIDModel):
    """
    Per-day, per-school, per-category rollup.

    `orders` is `COUNT(DISTINCT order)` *within that category*, so summing
    `orders` across categories would double count any order that contains
    items from two categories. School-level totals therefore come from
    :class:`DailySchoolTotal`, which the same rollup pass writes.
    """

    date = models.DateField()
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.CASCADE,
        related_name="daily_summaries",
    )
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.CASCADE,
        related_name="daily_summaries",
    )
    category = models.ForeignKey(
        "catalog.Category",
        on_delete=models.CASCADE,
        related_name="daily_summaries",
    )
    orders = models.PositiveIntegerField(default=0)
    units = models.PositiveIntegerField(default=0)
    revenue = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        verbose_name_plural = "Daily Sales Summaries"
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(
                fields=["date", "school", "category"],
                name="uniq_dailysales_date_sch_cat",
            ),
        ]
        indexes = [
            # Boss + School Admin dashboard access paths. Each filter
            # combination gets a covering index (INCLUDE the four measures)
            # so every aggregate is an index-only scan - the heap is never
            # touched no matter how many orders were rolled up.
            models.Index(
                fields=["date"],
                include=["orders", "units", "revenue", "cost"],
                name="idx_ds_cover_date",
            ),
            models.Index(
                fields=["city", "date"],
                include=["orders", "units", "revenue", "cost"],
                name="idx_ds_cover_city_date",
            ),
            models.Index(
                fields=["school", "date"],
                include=["orders", "units", "revenue", "cost"],
                name="idx_ds_cover_school_date",
            ),
            models.Index(
                fields=["category", "date"],
                include=["orders", "units", "revenue", "cost"],
                name="idx_ds_cover_cat_date",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.date} | {self.school.code} | {self.category.name} | ₹{self.revenue}"


class DailySchoolTotal(UUIDModel):
    """
    Per-day, per-school rollup written by the same pass that fills
    :class:`DailySalesSummary`.

    This is the only place a school-day **distinct order count** exists, which
    is why the School Admin dashboard reads its headline numbers here instead
    of adding up the per-category rows (that would count one order once per
    category it touches).
    """

    date = models.DateField()
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.CASCADE,
        related_name="daily_totals",
    )
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.CASCADE,
        related_name="daily_totals",
    )
    orders = models.PositiveIntegerField(default=0)
    units = models.PositiveIntegerField(default=0)
    revenue = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        verbose_name_plural = "Daily School Totals"
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(
                fields=["date", "school"],
                name="uniq_dailyschooltotal_date_sch",
            ),
        ]
        indexes = [
            # Covering indexes (INCLUDE the measures) so the headline KPI
            # aggregates are index-only scans for every filter combination.
            models.Index(
                fields=["date"],
                include=["orders", "units", "revenue", "cost"],
                name="idx_dst_cover_date",
            ),
            models.Index(
                fields=["city", "date"],
                include=["orders", "units", "revenue", "cost"],
                name="idx_dst_cover_city_date",
            ),
            models.Index(
                fields=["school", "date"],
                include=["orders", "units", "revenue", "cost"],
                name="idx_dst_cover_school_date",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.date} | {self.school.code} | {self.orders} orders | ₹{self.revenue}"


class DailyProductSummary(UUIDModel):
    """
    Per-day product rollup powering the Boss panel "top products by units"
    chart - the one cut of sales the (date, school, category) grain cannot
    provide.

    The key is `(date, product)`; `city`, `school` and `category` ride along
    denormalised (same pattern as :class:`DailySalesSummary` carrying
    `city`) so the Boss panel's city / school / category filters can be a
    single indexed WHERE without ever touching the order tables.
    """

    date = models.DateField()
    product = models.ForeignKey(
        "catalog.Product",
        on_delete=models.CASCADE,
        related_name="daily_summaries",
    )
    category = models.ForeignKey(
        "catalog.Category",
        on_delete=models.CASCADE,
        related_name="product_daily_summaries",
    )
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.CASCADE,
        related_name="product_daily_summaries",
    )
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.CASCADE,
        related_name="product_daily_summaries",
    )
    orders = models.PositiveIntegerField(default=0)
    units = models.PositiveIntegerField(default=0)
    revenue = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        verbose_name_plural = "Daily Product Summaries"
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(
                fields=["date", "product", "city", "school"],
                name="uniq_dailyprod_date_prod_city_sch",
            ),
        ]
        indexes = [
            # Boss dashboard access paths: covering indexes so the top
            # products chart is an index-only scan for every filter combo.
            models.Index(
                fields=["date"],
                include=["product", "units", "revenue", "cost"],
                name="idx_dp_cover_date",
            ),
            models.Index(
                fields=["category", "date"],
                include=["product", "units", "revenue", "cost"],
                name="idx_dp_cover_cat_date",
            ),
            models.Index(
                fields=["city", "date"],
                include=["product", "units", "revenue", "cost"],
                name="idx_dp_cover_city_date",
            ),
            models.Index(
                fields=["school", "date"],
                include=["product", "units", "revenue", "cost"],
                name="idx_dp_cover_school_date",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.date} | {self.product_id} | {self.units} units | ₹{self.revenue}"
