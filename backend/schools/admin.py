from django.contrib import admin
from .models import City, Grade, School, SchoolBranch, Student, StudentMeasurement


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
    fields = ("name", "city", "pincode", "phone", "active")
    show_change_link = True


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
    list_display = ("display_name", "school", "city", "pincode", "active", "created_at")
    list_filter = ("active", "city__state", "school")
    search_fields = ("name", "school__name", "school__code", "city__name", "address", "pincode")
    readonly_fields = ("id", "maps_place_id", "created_at", "updated_at")
    list_select_related = ("school", "city")
    autocomplete_fields = ("city",)
    fieldsets = (
        (None, {"fields": ("school", "city", "name", "active")}),
        ("Location", {"fields": ("address", "pincode", "latitude", "longitude")}),
        ("Contact", {"fields": ("phone", "website")}),
        ("Photo", {"fields": ("photo",)}),
        ("Source", {"fields": ("id", "maps_place_id", "created_at", "updated_at")}),
    )


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


@admin.register(StudentMeasurement)
class StudentMeasurementAdmin(admin.ModelAdmin):
    list_display = ("student", "height_cm", "weight_kg", "shoulder_cm", "source", "shoulder_edited", "measured_at")
    list_filter = ("source", "shoulder_edited")
    search_fields = ("student__name", "student__gr_number")
    raw_id_fields = ("student", "measured_by", "parent")
    readonly_fields = ("school", "city", "parent", "measured_by_role")
