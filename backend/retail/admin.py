from django.contrib import admin

from .models import RetailStore, SchoolRequest


@admin.register(RetailStore)
class RetailStoreAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "city", "phone", "active", "created_at")
    list_filter = ("active", "city")
    search_fields = ("name", "owner__username", "phone", "gst_number")
    filter_horizontal = ("schools",)
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(SchoolRequest)
class SchoolRequestAdmin(admin.ModelAdmin):
    list_display = ("name", "udise_code", "store", "city", "status", "created_at")
    list_filter = ("status", "board", "city")
    search_fields = ("name", "udise_code", "store__name")
    readonly_fields = ("id", "reviewed_by", "reviewed_at", "created_at", "updated_at")
