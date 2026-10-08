from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from .images import is_remote_image_url
from .models import Category, Product, ProductVariant


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = (
            "id",
            "name",
            "slug",
            "description",
            "display_order",
            "active",
            "created_at",
        )
        read_only_fields = ("id", "created_at")


class ProductVariantSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    category_name = serializers.CharField(source="product.category.name", read_only=True)

    class Meta:
        model = ProductVariant
        fields = (
            "id",
            "product",
            "product_name",
            "category_name",
            "school",
            "city",
            "size",
            "sku",
            "active",
            "created_at",
        )
        read_only_fields = (
            "id",
            "product_name",
            "category_name",
            "school",
            "city",
            "created_at",
        )


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    school_name = serializers.CharField(source="school.name", read_only=True, default=None)
    variants = ProductVariantSerializer(many=True, read_only=True)
    thumbnail = serializers.ReadOnlyField()
    gender = serializers.ChoiceField(
        choices=Product.Gender.choices,
        required=True,
        allow_null=True,
    )
    needs_review = serializers.BooleanField(read_only=True)
    grades = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Product.grades.field.related_model.objects.all(),
        required=False,
    )

    class Meta:
        model = Product
        fields = (
            "id",
            "category",
            "category_name",
            "school",
            "school_name",
            "city",
            "name",
            "description",
            "images",
            "thumbnail",
            "cost_price",
            "selling_price",
            "gender",
            "needs_review",
            "grades",
            "class_from",
            "class_to",
            "customisation_schema",
            "active",
            "variants",
            "created_at",
        )
        read_only_fields = (
            "id",
            "category_name",
            "school_name",
            "city",
            "thumbnail",
            "variants",
            "created_at",
        )
        extra_kwargs = {
            # Required so profit/margin can always be computed later.
            "cost_price": {"required": True, "min_value": 0},
            "selling_price": {"required": True, "min_value": 0},
        }

    def validate_images(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("images must be a list of URLs.")
        for url in value:
            if not is_remote_image_url(url):
                raise serializers.ValidationError(
                    "Each image must be an absolute object-storage/CDN URL "
                    "(https://...). Django never serves image bytes."
                )
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        # Boss-only: Admins, School Admins, Teachers, Parents must NOT see cost_price.
        if not (request and request.user and (request.user.role == "BOSS" or getattr(request.user, "is_superuser", False))):
            data.pop("cost_price", None)
        return data

    def validate(self, attrs):
        user = self.context["request"].user
        school = attrs.get("school") or getattr(self.instance, "school", None)
        if user.role == "ADMIN" and school and school.city_id != user.city_id:
            raise PermissionDenied(
                "Admins can only manage products for schools in their own city."
            )

        if self.instance is None and not attrs.get("gender"):
            raise serializers.ValidationError(
                {"gender": "gender is required and must be one of: boy, girl, unisex."}
            )

        def current(field):
            if field in attrs:
                return attrs[field]
            return getattr(self.instance, field, None)

        class_from = current("class_from")
        class_to = current("class_to")
        if (class_from is not None or class_to is not None) and school is None:
            raise serializers.ValidationError(
                {
                    "class_from": "A class range is only valid on school-specific "
                    "items (uniforms). Shared items apply to every class."
                }
            )
        if class_from is not None and class_to is not None and class_from > class_to:
            raise serializers.ValidationError(
                {"class_to": "class_to must be greater than or equal to class_from."}
            )
        return attrs
