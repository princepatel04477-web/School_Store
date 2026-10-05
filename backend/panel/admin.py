from django.contrib import admin
from django.utils.html import format_html

from .models import ExportJob


@admin.register(ExportJob)
class ExportJobAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "job_type",
        "status",
        "school",
        "row_count",
        "created_at",
        "completed_at",
    )
    list_filter = ("job_type", "status", "school")
    readonly_fields = (
        "id",
        "job_type",
        "status",
        "school",
        "city",
        "requested_by",
        "filters",
        "file_link",
        "filename",
        "row_count",
        "result",
        "error_message",
        "created_at",
        "completed_at",
        "expires_at",
    )
    list_select_related = ("school", "requested_by")

    @admin.display(description="File")
    def file_link(self, obj):
        if obj.file:
            return format_html('<a href="{}">{}</a>', obj.file.url, obj.filename or obj.file.name)
        return "—"
