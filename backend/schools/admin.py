from django.contrib import admin
from .models import City, School, Student


@admin.register(City)
class CityAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "state", "active", "created_at")
    list_filter = ("active", "state")
    search_fields = ("name", "code")
    readonly_fields = ("id", "created_at", "updated_at")


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


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "gr_number",
        "class_name",
        "section",
        "gender",
        "school",
        "parent",
        "active",
    )
    list_filter = ("school", "class_name", "section", "gender", "active")
    search_fields = ("name", "gr_number", "parent__username", "parent__phone")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("school", "parent")
