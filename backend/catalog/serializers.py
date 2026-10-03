from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

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
            "cost_price",
            "selling_price",
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
            "variants",
            "created_at",
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        # Hide cost_price from non-staff roles (Parents, Teachers, School Admins).
        if request and request.user and request.user.role not in ("BOSS", "ADMIN"):
            data.pop("cost_price", None)
        return data

    def validate(self, attrs):
        user = self.context["request"].user
        school = attrs.get("school") or getattr(self.instance, "school", None)
        if user.role == "ADMIN" and school and school.city_id != user.city_id:
            raise PermissionDenied(
                "Admins can only manage products for schools in their own city."
            )
        return attrs
