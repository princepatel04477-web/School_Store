from django.contrib import admin
from .models import DailySalesSummary, DailySchoolTotal


@admin.register(DailySalesSummary)
class DailySalesSummaryAdmin(admin.ModelAdmin):
    list_display = (
        "date",
        "city",
        "school",
        "category",
        "orders",
        "units",
        "revenue",
        "cost",
    )
    list_filter = ("city", "school", "category", "date")
    search_fields = ("school__name", "school__code", "city__name")
    readonly_fields = ("id",)
    list_select_related = ("city", "school", "category")


@admin.register(DailySchoolTotal)
class DailySchoolTotalAdmin(admin.ModelAdmin):
    list_display = ("date", "city", "school", "orders", "units", "revenue", "cost")
    list_filter = ("city", "school", "date")
    search_fields = ("school__name", "school__code", "city__name")
    readonly_fields = ("id",)
    list_select_related = ("city", "school")
