from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "username",
        "email",
        "role",
        "phone",
        "city",
        "school",
        "must_change_password",
        "is_active",
        "is_staff",
    )
    list_filter = ("role", "city", "school", "must_change_password", "is_active", "is_staff")
    search_fields = ("username", "email", "phone", "first_name", "last_name")
    readonly_fields = ("id", "created_at", "updated_at")
    fieldsets = BaseUserAdmin.fieldsets + (
        (
            "School Store Scope & Role",
            {
                "fields": (
                    "id",
                    "role",
                    "phone",
                    "city",
                    "school",
                    "must_change_password",
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        (
            "School Store Scope & Role",
            {
                "fields": (
                    "role",
                    "phone",
                    "city",
                    "school",
                    "must_change_password",
                )
            },
        ),
    )
