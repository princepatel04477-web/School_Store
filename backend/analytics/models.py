from django.db import models
from common.models import UUIDModel


class DailySalesSummary(UUIDModel):
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
        ]

    def __str__(self) -> str:
        return f"{self.date} | {self.school.code} | {self.category.name} | ₹{self.revenue}"
