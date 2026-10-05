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
            models.Index(
                fields=["date", "city"],
                name="idx_dailysales_date_city",
            ),
            # School Admin dashboard: WHERE school_id = ? AND date BETWEEN ? AND ?
            models.Index(
                fields=["school", "date"],
                name="idx_dailysales_school_date",
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
            # Dashboard headline figures: WHERE school_id = ? AND date BETWEEN ?
            models.Index(
                fields=["school", "date"],
                name="idx_dschooltotal_sch_date",
            ),
            models.Index(
                fields=["date", "city"],
                name="idx_dailyschooltotal_date_city",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.date} | {self.school.code} | {self.orders} orders | ₹{self.revenue}"
