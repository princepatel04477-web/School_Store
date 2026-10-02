from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from common.exceptions import Conflict
from common.models import ImportJob

from .models import City, School, Student


class CitySerializer(serializers.ModelSerializer):
    class Meta:
        model = City
        fields = ("id", "name", "code", "state", "active", "created_at")
        read_only_fields = ("id", "created_at")


class SchoolSerializer(serializers.ModelSerializer):
    city_name = serializers.CharField(source="city.name", read_only=True)

    class Meta:
        model = School
        fields = (
            "id",
            "city",
            "city_name",
            "name",
            "code",
            "active",
            "commission_rate",
            "address",
            "contact_email",
            "contact_phone",
            "created_at",
        )
        read_only_fields = ("id", "city_name", "created_at")

    def validate(self, attrs):
        user = self.context["request"].user
        city = attrs.get("city") or getattr(self.instance, "city", None)
        if user.role == "ADMIN":
            if city and city.id != user.city_id:
                raise PermissionDenied(
                    "Admins can only manage schools in their own city."
                )
            attrs["city_id"] = user.city_id
        return attrs


class StudentSerializer(serializers.ModelSerializer):
    """
    Student CRUD serializer (Prompt 4, requirements 1 & 2).

    Read:  name, GR number, class, section, gender (+ school / parent / status).
    Write: name, GR number, class, section, gender, optional date of birth.
    """

    school_name = serializers.CharField(source="school.name", read_only=True)
    school_code = serializers.CharField(source="school.code", read_only=True)
    parent_name = serializers.CharField(source="parent.get_full_name", read_only=True)
    parent_phone = serializers.CharField(source="parent.phone", read_only=True)
    # Optional: school staff get it filled from their JWT scope, Admins must pass
    # a school inside their city.
    school = serializers.PrimaryKeyRelatedField(
        queryset=School.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = Student
        fields = (
            "id",
            "name",
            "gr_number",
            "class_name",
            "section",
            "gender",
            "date_of_birth",
            "school",
            "school_name",
            "school_code",
            "city",
            "parent",
            "parent_name",
            "parent_phone",
            "approval_status",
            "source",
            "active",
            "created_at",
        )
        read_only_fields = (
            "id",
            "school_name",
            "school_code",
            "city",
            "parent",
            "parent_name",
            "parent_phone",
            "approval_status",
            "source",
            "created_at",
        )
        # The auto-generated UniqueTogetherValidator for (school, gr_number)
        # would demand `school` even when the JWT scope supplies it, so
        # uniqueness is checked explicitly below with one indexed lookup.
        validators = []

    def validate(self, attrs):
        """
        Requirement 2: Teachers and School Admins add a student by form
        (name, GR number, class, section, gender). Staff can only create
        students for their own school; Admins only for schools inside their
        city. Parents never create through this endpoint (they use the
        claim / manual-add endpoints).
        """
        request = self.context["request"]
        user = request.user
        school = attrs.get("school") or getattr(self.instance, "school", None)

        if user.role in ("SCHOOL_ADMIN", "TEACHER"):
            if school and school.id != user.school_id:
                raise PermissionDenied(
                    "You can only manage students within your own school."
                )
            if not school:
                attrs["school_id"] = user.school_id
        elif user.role in ("ADMIN", "BOSS") or getattr(user, "is_superuser", False):
            if not school:
                raise ValidationError({"school": "School is required."})
            if user.role == "ADMIN" and school.city_id != user.city_id:
                raise PermissionDenied(
                    "Admins can only manage students in schools within their city."
                )
        else:
            raise PermissionDenied(
                "Only school staff can add students. Parents use the claim endpoint."
            )

        if school:
            attrs["city_id"] = school.city_id

        # One indexed lookup on uniq_student_school_gr (no scan, no N+1).
        gr_number = attrs.get("gr_number") or getattr(self.instance, "gr_number", None)
        school_id = attrs.get("school_id") or getattr(school, "id", None)
        if gr_number and school_id:
            duplicates = Student.objects.filter(
                school_id=school_id, gr_number=gr_number
            )
            if self.instance is not None:
                duplicates = duplicates.exclude(pk=self.instance.pk)
            if duplicates.exists():
                raise ValidationError(
                    {
                        "gr_number": (
                            "A student with this GR number already exists in this school."
                        )
                    }
                )
        return attrs

    def create(self, validated_data):
        validated_data["source"] = Student.Source.STAFF
        validated_data["approval_status"] = Student.ApprovalStatus.APPROVED
        return super().create(validated_data)


class StudentImportJobSerializer(serializers.ModelSerializer):
    """Job status + capped preview returned to the polling frontend (Rule P2)."""

    school_code = serializers.CharField(source="school.code", read_only=True, default=None)
    uploaded_by_name = serializers.CharField(
        source="uploaded_by.username", read_only=True, default=None
    )
    progress = serializers.SerializerMethodField()

    class Meta:
        model = ImportJob
        fields = (
            "id",
            "job_type",
            "status",
            "school",
            "school_code",
            "uploaded_by_name",
            "original_filename",
            "total_rows",
            "valid_count",
            "duplicate_count",
            "error_count",
            "preview",
            "result",
            "error_message",
            "progress",
            "created_at",
            "completed_at",
        )
        read_only_fields = fields

    def get_progress(self, obj):
        return {
            "PENDING": 0,
            "VALIDATING": 25,
            "PREVIEW_READY": 60,
            "IMPORTING": 80,
            "COMPLETED": 100,
            "FAILED": 100,
            "CANCELLED": 100,
        }.get(obj.status, 0)


class StudentImportUploadSerializer(serializers.Serializer):
    """
    Upload validation for the bulk import (requirement 3):
    .xlsx / .csv only, capped at 5 MB (row cap is enforced by the validation job).
    """

    file = serializers.FileField()
    school = serializers.PrimaryKeyRelatedField(
        queryset=School.objects.select_related("city").all(),
        required=False,
        allow_null=True,
    )

    def validate_file(self, value):
        from django.conf import settings

        max_bytes = int(getattr(settings, "STUDENT_IMPORT_MAX_BYTES", 5 * 1024 * 1024))
        name = (value.name or "").lower()
        if not name.endswith((".xlsx", ".csv")):
            raise ValidationError("Upload an .xlsx or .csv file.")
        if value.size > max_bytes:
            raise ValidationError(
                f"File is too large ({value.size / 1024 / 1024:.1f} MB). "
                f"Maximum allowed is {max_bytes / 1024 / 1024:.0f} MB."
            )
        return value


class StudentClaimSerializer(serializers.Serializer):
    """
    Requirement 4: a parent claims a child by choosing the school, entering the
    GR number, plus ONE more check - date of birth or class + section.
    The lookup is a single indexed query on unique (school, GR number).
    """

    school = serializers.PrimaryKeyRelatedField(
        queryset=School.objects.select_related("city").all()
    )
    gr_number = serializers.CharField(max_length=50)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    class_name = serializers.CharField(max_length=30, required=False, allow_blank=True)
    section = serializers.CharField(max_length=20, required=False, allow_blank=True)

    def validate(self, attrs):
        if not attrs.get("date_of_birth") and not (
            attrs.get("class_name") and attrs.get("section")
        ):
            raise ValidationError(
                "Provide either the date of birth or the class and section to verify."
            )
        return attrs

    def save(self, **kwargs):
        user = self.context["request"].user
        school = self.validated_data["school"]
        gr_number = self.validated_data["gr_number"].strip()

        # ONE indexed lookup on the unique (school, GR number) index.
        student = (
            Student.objects.select_related("school")
            .filter(school_id=school.id, gr_number=gr_number)
            .first()
        )
        # Generic message: never reveal whether a GR number exists.
        not_found = ValidationError(
            {"detail": "We could not match your child with those details."}
        )
        if student is None:
            raise not_found

        dob = self.validated_data.get("date_of_birth")
        if dob and student.date_of_birth:
            if student.date_of_birth != dob:
                raise not_found
        elif dob and not student.date_of_birth:
            raise ValidationError(
                {
                    "date_of_birth": (
                        "This student has no date of birth on record. "
                        "Verify with class and section instead."
                    )
                }
            )
        else:
            class_name = (self.validated_data.get("class_name") or "").strip()
            section = (self.validated_data.get("section") or "").strip()
            if (
                student.class_name.strip().lower() != class_name.lower()
                or student.section.strip().lower() != section.lower()
            ):
                raise not_found

        # Requirement 5: one parent per child unless the School Admin overrides.
        if student.parent_id and student.parent_id != user.id:
            raise Conflict(
                "This student is already linked to another parent. "
                "Please contact the school admin to update the link."
            )

        with transaction.atomic():
            student.parent_id = user.id
            if not student.city_id:
                student.city_id = student.school.city_id
            student.save(update_fields=["parent", "city", "updated_at"])
        return student


class StudentManualAddSerializer(serializers.Serializer):
    """
    Requirement 4: if the school has no roster entry yet, the parent adds the
    child manually and the record stays PENDING until the School Admin approves.
    """

    school = serializers.PrimaryKeyRelatedField(
        queryset=School.objects.select_related("city").all()
    )
    name = serializers.CharField(max_length=150)
    gr_number = serializers.CharField(max_length=50)
    class_name = serializers.CharField(max_length=30)
    section = serializers.CharField(max_length=20)
    gender = serializers.CharField(max_length=16)
    date_of_birth = serializers.DateField(required=False, allow_null=True)

    def validate(self, attrs):
        school = attrs["school"]
        gr_number = attrs["gr_number"].strip()
        attrs["gr_number"] = gr_number

        # One indexed lookup - if the roster already has this GR the parent must claim it.
        if Student.objects.filter(school_id=school.id, gr_number=gr_number).exists():
            raise ValidationError(
                {
                    "gr_number": (
                        "This GR number already exists in the school roster. "
                        "Use 'claim child' to link it to your account."
                    )
                }
            )
        return attrs

    def create(self, validated_data):
        user = self.context["request"].user
        school = validated_data["school"]
        return Student.objects.create(
            name=validated_data["name"],
            gr_number=validated_data["gr_number"],
            class_name=validated_data["class_name"],
            section=validated_data["section"],
            gender=validated_data["gender"],
            date_of_birth=validated_data.get("date_of_birth"),
            school=school,
            city_id=school.city_id,
            parent=user,
            approval_status=Student.ApprovalStatus.PENDING,
            source=Student.Source.PARENT_MANUAL,
        )


class StudentApproveSerializer(serializers.Serializer):
    """School Admin approval of a parent-added (pending) student."""

    parent = serializers.UUIDField(required=False, allow_null=True)
    name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    gr_number = serializers.CharField(max_length=50, required=False, allow_blank=True)
    class_name = serializers.CharField(max_length=30, required=False, allow_blank=True)
    section = serializers.CharField(max_length=20, required=False, allow_blank=True)
    gender = serializers.CharField(max_length=16, required=False, allow_blank=True)
    date_of_birth = serializers.DateField(required=False, allow_null=True)


class StudentAssignParentSerializer(serializers.Serializer):
    """
    Requirement 5 override: the School Admin may re-link a child to a
    different parent account (or unlink with `null`).
    """

    parent = serializers.UUIDField(required=False, allow_null=True, default=None)


__all__ = [
    "CitySerializer",
    "SchoolSerializer",
    "StudentSerializer",
    "StudentImportJobSerializer",
    "StudentImportUploadSerializer",
    "StudentClaimSerializer",
    "StudentManualAddSerializer",
    "StudentApproveSerializer",
    "StudentAssignParentSerializer",
]
