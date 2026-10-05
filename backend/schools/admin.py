from django.contrib import admin
from .models import City, Grade, School, SchoolBranch, Student


@admin.register(City)
class CityAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "state", "active", "created_at")
    list_filter = ("active", "state")
    search_fields = ("name", "code")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Grade)
class GradeAdmin(admin.ModelAdmin):
    list_display = ("name", "sort_order")
    search_fields = ("name",)
    ordering = ("sort_order",)
    readonly_fields = ("id",)


class SchoolBranchInline(admin.TabularInline):
    model = SchoolBranch
    extra = 1
    fields = ("city", "active")


@admin.register(School)
class SchoolAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "code",
        "city",
        "commission_rate",
        "home_delivery_enabled",
        "school_pickup_enabled",
        "active",
        "created_at",
    )
    list_filter = ("active", "city", "home_delivery_enabled", "school_pickup_enabled")
    search_fields = ("name", "code")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("city",)
    inlines = [SchoolBranchInline]


@admin.register(SchoolBranch)
class SchoolBranchAdmin(admin.ModelAdmin):
    list_display = ("school", "city", "active", "created_at")
    list_filter = ("active", "city", "school")
    search_fields = ("school__name", "school__code", "city__name")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("school", "city")


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "gr_number",
        "grade",
        "section",
        "gender",
        "school",
        "branch",
        "parent",
        "active",
    )
    list_filter = ("school", "grade", "section", "gender", "active")
    search_fields = ("name", "gr_number", "parent__username", "parent__phone")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("school", "branch", "grade", "parent")

