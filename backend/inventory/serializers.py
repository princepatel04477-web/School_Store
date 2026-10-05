from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from catalog.models import ProductVariant
from orders.models import Order
from schools.models import City

from .models import StockBalance, StockMovement
from .services import InsufficientStockError, apply_stock_movement


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
        queryset=City.objects.all(), required=False
    )
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
