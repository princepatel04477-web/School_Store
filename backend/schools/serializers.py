from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
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
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_code = serializers.CharField(source="school.code", read_only=True)

    class Meta:
        model = Student
        fields = (
            "id",
            "name",
            "gr_number",
            "class_name",
            "section",
            "gender",
            "school",
            "school_name",
            "school_code",
            "city",
            "parent",
            "active",
            "created_at",
        )
        read_only_fields = ("id", "school_name", "school_code", "city", "created_at")

    def validate(self, attrs):
        user = self.context["request"].user
        school = attrs.get("school") or getattr(self.instance, "school", None)

        if user.role == "ADMIN":
            if school and school.city_id != user.city_id:
                raise PermissionDenied(
                    "Admins can only manage students in schools within their city."
                )
        elif user.role in ("SCHOOL_ADMIN", "TEACHER"):
            if school and school.id != user.school_id:
                raise PermissionDenied(
                    "You can only manage students within your own school."
                )
            if not school and user.school_id:
                attrs["school_id"] = user.school_id
                attrs["city_id"] = user.city_id
        elif user.role == "PARENT":
            parent = attrs.get("parent") or getattr(self.instance, "parent", None)
            if parent and parent.id != user.id:
                raise PermissionDenied("Parents can only manage their own children.")
            attrs["parent_id"] = user.id

        return attrs
