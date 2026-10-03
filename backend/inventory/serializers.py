from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from catalog.models import ProductVariant
from orders.models import Order
from schools.models import City

from .models import StockBalance, StockMovement


class StockBalanceSerializer(serializers.ModelSerializer):
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)

    class Meta:
        model = StockBalance
        fields = (
            "id",
            "city",
            "variant",
            "variant_sku",
            "product_name",
            "stock_quantity",
            "low_stock_threshold",
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
        queryset=City.objects.all(), required=False
    )
    quantity_change = serializers.IntegerField()
    reason = serializers.ChoiceField(
        choices=(
            StockMovement.Reason.INITIAL_STOCK,
            StockMovement.Reason.RESTOCK,
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
        if actor.role == "ADMIN":
            if not actor.city_id:
                raise PermissionDenied("A city-scoped Admin must have an assigned city.")
            if city and city.pk != actor.city_id:
                raise PermissionDenied("Admins can only adjust stock in their own city.")
            attrs["city"] = City.objects.get(pk=actor.city_id)
        elif not city:
            raise serializers.ValidationError({"city": "City is required for this stock movement."})

        variant = attrs["variant"]
        variant_city_id = variant.city_id or variant.product.city_id
        if variant_city_id and variant_city_id != attrs["city"].pk:
            raise serializers.ValidationError(
                {"city": "This school-specific variant is stocked in a different city."}
            )

        order = attrs.get("reference_order")
        if order and order.city_id != attrs["city"].pk:
            raise serializers.ValidationError(
                {"reference_order": "The order must belong to the selected stock city."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        variant = validated_data["variant"]
        city = validated_data["city"]
        quantity_change = validated_data["quantity_change"]
        actor = self.context["request"].user

        balance, _ = StockBalance.objects.get_or_create(
            city=city,
            variant=variant,
            defaults={"stock_quantity": 0},
        )
        balance = StockBalance.objects.select_for_update().get(pk=balance.pk)
        next_quantity = balance.stock_quantity + quantity_change
        if next_quantity < 0:
            raise serializers.ValidationError(
                {"quantity_change": "This movement would make city stock negative."}
            )

        balance.stock_quantity = next_quantity
        balance.save(update_fields=["stock_quantity", "updated_at"])
        reference_order = validated_data.get("reference_order")
        school_id = variant.school_id or (
            reference_order.school_id if reference_order else None
        )
        return StockMovement.objects.create(
            city=city,
            school_id=school_id,
            variant=variant,
            quantity_change=quantity_change,
            reason=validated_data["reason"],
            reference_order=validated_data.get("reference_order"),
            created_by=actor,
        )
