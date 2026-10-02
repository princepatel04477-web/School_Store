from django.contrib import admin
from .models import ImportJob


@admin.register(ImportJob)
class ImportJobAdmin(admin.ModelAdmin):
    list_display = (
        "original_filename",
        "job_type",
        "status",
        "school",
        "total_rows",
        "valid_count",
        "duplicate_count",
        "error_count",
        "created_at",
    )
    list_filter = ("job_type", "status", "school__city", "school")
    search_fields = ("original_filename", "school__name", "school__code")
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "completed_at",
    )
    ordering = ("-created_at",)
    list_select_related = ("school", "city", "uploaded_by")
