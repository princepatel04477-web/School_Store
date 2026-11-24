from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from catalog.models import ProductVariant
from orders.models import Order
from schools.models import City

from .models import StockBalance, StockMovement
from .services import INDIA_STOCK_ID, InsufficientStockError, apply_stock_movement, india_stock_city


class StockBalanceSerializer(serializers.ModelSerializer):
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    product_category = serializers.CharField(source="variant.product.category.name", read_only=True)
    product_type = serializers.CharField(source="variant.product.product_type", read_only=True)
    variant_size = serializers.CharField(source="variant.size", read_only=True)

    class Meta:
        model = StockBalance
        fields = (
            "id",
            "city",
            "variant",
            "variant_sku",
            "product_name",
            "product_category",
            "product_type",
            "variant_size",
            "stock_quantity",
            "low_stock_threshold",
            "is_low_stock",
            "updated_at",
        )
        read_only_fields = fields


class StockMovementSerializer(serializers.ModelSerializer):
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)

    class Meta:
        model = StockMovement
        fields = (
            "id",
            "city",
            "school",
            "variant",
            "variant_sku",
            "quantity_change",
            "reason",
            "reference_order",
            "created_by",
            "created_at",
        )
        read_only_fields = fields


class StockMovementCreateSerializer(serializers.Serializer):
    variant = serializers.PrimaryKeyRelatedField(
        queryset=ProductVariant.objects.select_related("product").all()
    )
    city = serializers.PrimaryKeyRelatedField(
        queryset=City.objects.exclude(pk=INDIA_STOCK_ID), required=False
    )
    scope = serializers.ChoiceField(choices=("india", "city"), default="city")
    quantity_change = serializers.IntegerField()
    reason = serializers.ChoiceField(
        choices=(
            # Stock-in
            StockMovement.Reason.INITIAL_STOCK,
            StockMovement.Reason.RESTOCK,
            # Customer return (stock back in)
            StockMovement.Reason.RETURN,
            # Manual adjustments
            StockMovement.Reason.ADJUSTMENT,
            StockMovement.Reason.DAMAGE,
        )
    )
    reference_order = serializers.PrimaryKeyRelatedField(
        queryset=Order.objects.all(), required=False, allow_null=True
    )

    def validate_quantity_change(self, value):
        if value == 0:
            raise serializers.ValidationError("Stock movement must change quantity.")
        return value

    def validate(self, attrs):
        request = self.context["request"]
        actor = request.user
        city = attrs.get("city")
        if attrs["scope"] == "india":
            if actor.role != "BOSS":
                raise PermissionDenied("Only the Boss can change India stock.")
            if city or attrs.get("reference_order"):
                raise serializers.ValidationError({"scope": "India stock does not take a city or order."})
            attrs["city"] = india_stock_city()
        elif actor.role == "ADMIN":
            if actor.city_id:
                if city and city.pk != actor.city_id:
                    raise PermissionDenied("Admins can only adjust stock in their own city.")
                attrs["city"] = City.objects.get(pk=actor.city_id)
            elif not city:
                raise serializers.ValidationError({"city": "City is required for this stock movement."})
        elif not city:
            raise serializers.ValidationError({"city": "City is required for this stock movement."})

        if attrs["reason"] == StockMovement.Reason.INITIAL_STOCK and attrs["quantity_change"] < 1:
            raise serializers.ValidationError({"quantity_change": "Initial stock must be at least one unit."})

        variant = attrs["variant"]
        variant_city_id = variant.city_id or variant.product.city_id
        if attrs["scope"] == "city" and variant_city_id and variant_city_id != attrs["city"].pk:
            product = variant.product
            home = City.objects.filter(pk=variant_city_id).values_list("name", flat=True).first() or "another city"
            school = product.school.name if product.school_id else product.name
            raise serializers.ValidationError(
                {
                    "city": f"{product.name} is sold only by {school} in {home}. "
                    f"Choose {home} at the top to add its stock."
                }
            )

        order = attrs.get("reference_order")
        if order and order.city_id != attrs["city"].pk:
            raise serializers.ValidationError(
                {"reference_order": "The order must belong to the selected stock city."}
            )
        return attrs

    def create(self, validated_data):
        """Every change goes through the stock service: a StockMovement row
        plus an atomic conditional UPDATE (never read-modify-write)."""
        try:
            return apply_stock_movement(
                variant=validated_data["variant"],
                city_id=validated_data["city"].pk,
                quantity_change=validated_data["quantity_change"],
                reason=validated_data["reason"],
                reference_order=validated_data.get("reference_order"),
                created_by=self.context["request"].user,
            )
        except InsufficientStockError:
            raise serializers.ValidationError(
                {"quantity_change": "This movement would make city stock negative."}
            )


class BulkStockReceiptSerializer(serializers.Serializer):
    variants = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=100)
    quantity_per_size = serializers.IntegerField(min_value=1, max_value=2147483647)

    @transaction.atomic
    def create(self, validated_data):
        ids = set(validated_data["variants"])
        if len(ids) != len(validated_data["variants"]):
            raise serializers.ValidationError({"variants": "Select each size once."})
        variants = list(ProductVariant.objects.filter(pk__in=ids, active=True).order_by("id"))
        if len(variants) != len(ids) or len({variant.product_id for variant in variants}) != 1:
            raise serializers.ValidationError({"variants": "Select active sizes from one product."})
        city = india_stock_city()
        actor = self.context["request"].user
        return [
            apply_stock_movement(
                variant=variant,
                city_id=city.pk,
                quantity_change=validated_data["quantity_per_size"],
                reason=StockMovement.Reason.RESTOCK,
                created_by=actor,
            )
            for variant in variants
        ]
