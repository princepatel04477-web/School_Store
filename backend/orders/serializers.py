import uuid
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import F
from django.db.models.functions import Now
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from catalog.models import ProductVariant
from inventory.models import StockBalance, StockMovement
from schools.models import Student

from .models import Order, OrderItem, OrderStatusEvent


class OrderItemSerializer(serializers.ModelSerializer):
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    variant_size = serializers.CharField(source="variant.size", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)

    class Meta:
        model = OrderItem
        fields = (
            "id",
            "variant",
            "variant_sku",
            "variant_size",
            "product_name",
            "category",
            "quantity",
            "unit_price_snapshot",
            "customisation_data",
        )
        read_only_fields = (
            "id",
            "variant_sku",
            "variant_size",
            "product_name",
            "category",
            "unit_price_snapshot",
        )


class OrderStatusEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderStatusEvent
        fields = ("id", "status", "timestamp", "changed_by", "note")
        read_only_fields = fields


class OrderUpdateSerializer(serializers.ModelSerializer):
    """
    Staff-facing status / payment updates (cancel, return, mark delivered).

    Only the lifecycle fields are writable; the snapshot amounts and the
    denormalised scope columns are never edited after checkout.
    """

    class Meta:
        model = Order
        fields = ("status", "payment_status")

    def validate(self, attrs):
        from rest_framework.exceptions import PermissionDenied

        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is None or user.role in ("PARENT", "TEACHER"):
            raise PermissionDenied(
                "Only Boss, Admin, or School Admin may change an order's status."
            )
        return attrs


class OrderListSerializer(serializers.ModelSerializer):
    """Lightweight order list payload without nested arrays."""

    student_name = serializers.CharField(source="student.name", read_only=True)
    student_gr = serializers.CharField(source="student.gr_number", read_only=True)
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_code = serializers.CharField(source="school.code", read_only=True)
    city_name = serializers.CharField(source="city.name", read_only=True)

    class Meta:
        model = Order
        fields = (
            "id",
            "order_number",
            "student_name",
            "student_gr",
            "school_code",
            "school_name",
            "city_name",
            "placed_by_role",
            "status",
            "payment_status",
            "fulfillment_type",
            "subtotal",
            "total",
            "created_at",
        )
        read_only_fields = fields


class OrderDetailSerializer(serializers.ModelSerializer):
    """Full order payload (single-object endpoint only)."""

    student_name = serializers.CharField(source="student.name", read_only=True)
    student_gr = serializers.CharField(source="student.gr_number", read_only=True)
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_code = serializers.CharField(source="school.code", read_only=True)
    city_name = serializers.CharField(source="city.name", read_only=True)
    items = OrderItemSerializer(many=True, read_only=True)
    status_events = OrderStatusEventSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = (
            "id",
            "order_number",
            "placed_by",
            "placed_by_role",
            "payer",
            "student",
            "student_name",
            "student_gr",
            "parent",
            "school",
            "school_name",
            "school_code",
            "city",
            "city_name",
            "status",
            "payment_status",
            "fulfillment_type",
            "subtotal",
            "total",
            "delivery_details",
            "razorpay_order_id",
            "razorpay_payment_id",
            "items",
            "status_events",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class OrderCreateItemInputSerializer(serializers.Serializer):
    variant = serializers.PrimaryKeyRelatedField(
        queryset=ProductVariant.objects.select_related("product").all()
    )
    quantity = serializers.IntegerField(min_value=1, max_value=100)
    customisation_data = serializers.JSONField(required=False, default=dict)


class OrderCreateSerializer(serializers.Serializer):
    idempotency_key = serializers.CharField(max_length=128, write_only=True)
    student = serializers.PrimaryKeyRelatedField(
        queryset=Student.objects.select_related("school", "school__city").all()
    )
    fulfillment_type = serializers.ChoiceField(
        choices=Order.FulfillmentType.choices,
        default=Order.FulfillmentType.HOME_DELIVERY,
    )
    delivery_details = serializers.JSONField(required=False, default=dict)
    items = OrderCreateItemInputSerializer(many=True, allow_empty=False)

    def validate_student(self, student):
        user = self.context["request"].user
        if user.role == "BOSS" or getattr(user, "is_superuser", False):
            return student
        if user.role == "ADMIN":
            if student.city_id != user.city_id:
                raise PermissionDenied(
                    "Admins can only place orders for students in their city."
                )
            return student
        if user.role in ("SCHOOL_ADMIN", "TEACHER"):
            if student.school_id != user.school_id:
                raise PermissionDenied(
                    "You can only place orders for students in your own school."
                )
            return student
        if user.role == "PARENT":
            if student.parent_id != user.id:
                raise PermissionDenied(
                    "Parents can only place orders for their own children."
                )
            return student
        raise PermissionDenied("Invalid role for placing orders.")

    def validate(self, attrs):
        student = attrs["student"]
        school = student.school
        fulfillment_type = attrs["fulfillment_type"]
        if (
            fulfillment_type == Order.FulfillmentType.HOME_DELIVERY
            and not school.home_delivery_enabled
        ):
            raise serializers.ValidationError(
                {"fulfillment_type": "This school does not offer home delivery."}
            )
        if (
            fulfillment_type == Order.FulfillmentType.SCHOOL_PICKUP
            and not school.school_pickup_enabled
        ):
            raise serializers.ValidationError(
                {"fulfillment_type": "This school does not offer school pickup."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        student = validated_data["student"]
        items_data = validated_data["items"]
        delivery_details = validated_data.get("delivery_details", {})
        fulfillment_type = validated_data["fulfillment_type"]
        idempotency_key = validated_data["idempotency_key"]
        city_id = student.city_id or student.school.city_id

        existing = Order.objects.filter(idempotency_key=idempotency_key).first()
        if existing:
            return self._existing_for_actor(existing, user)

        variant_ids = sorted({item["variant"].id for item in items_data}, key=str)
        variants = {
            variant.id: variant
            for variant in ProductVariant.objects.select_related(
                "product", "product__category"
            )
            .filter(id__in=variant_ids)
            .order_by("id")
        }
        if len(variants) != len(variant_ids):
            raise serializers.ValidationError(
                {"items": "One or more variants do not exist."}
            )

        for variant in variants.values():
            if not variant.active:
                raise serializers.ValidationError(
                    {"items": f"SKU {variant.sku} is not available."}
                )
            if variant.product.school_id and variant.product.school_id != student.school_id:
                raise serializers.ValidationError(
                    {"items": f"SKU {variant.sku} is not available for this school."}
                )

        quantities = {}
        for item in items_data:
            variant_id = item["variant"].id
            quantities[variant_id] = quantities.get(variant_id, 0) + item["quantity"]
            self._validate_customisation(
                variants[variant_id].product.customisation_schema,
                item.get("customisation_data") or {},
            )

        # Stock is debited with an atomic conditional UPDATE further down, so
        # no row locks are taken here. This read exists purely for friendly,
        # itemised error messages before the order row is created.
        balances = {
            balance.variant_id: balance
            for balance in StockBalance.objects.filter(
                city_id=city_id, variant_id__in=variant_ids
            ).order_by("variant_id")
        }
        # A retry may have waited behind the first request while it committed.
        existing = Order.objects.filter(idempotency_key=idempotency_key).first()
        if existing:
            return self._existing_for_actor(existing, user)

        if len(balances) != len(variant_ids):
            missing = [str(variant_id) for variant_id in variant_ids if variant_id not in balances]
            raise serializers.ValidationError(
                {"items": f"No stock balance is configured for this city's variant(s): {', '.join(missing)}."}
            )

        subtotal = Decimal("0.00")
        for variant_id in variant_ids:
            variant = variants[variant_id]
            balance = balances[variant_id]
            quantity = quantities[variant_id]
            if balance.stock_quantity < quantity:
                raise serializers.ValidationError(
                    {"items": f"Insufficient stock for SKU {variant.sku} in this city."}
                )
            subtotal += variant.product.selling_price * quantity

        order_number = f"ORD-{uuid.uuid4().hex[:16].upper()}"
        try:
            # Savepoint lets an idempotent retry recover from a unique-key race.
            with transaction.atomic():
                order = Order.objects.create(
                    idempotency_key=idempotency_key,
                    order_number=order_number,
                    placed_by_id=user.id,
                    placed_by_role=user.role,
                    payer_id=user.id,
                    student=student,
                    parent_id=student.parent_id or (user.id if user.role == "PARENT" else None),
                    school_id=student.school_id,
                    city_id=city_id,
                    fulfillment_type=fulfillment_type,
                    status=Order.Status.PLACED,
                    payment_status=Order.PaymentStatus.PENDING,
                    subtotal=subtotal,
                    total=subtotal,
                    delivery_details=delivery_details,
                )
        except IntegrityError:
            existing = Order.objects.filter(idempotency_key=idempotency_key).first()
            if existing:
                return self._existing_for_actor(existing, user)
            raise

        # Debit stock per city/variant with an atomic conditional
        # UPDATE ... SET stock_quantity = stock_quantity - qty
        # WHERE stock_quantity >= qty  (never read-modify-write in Python).
        # Zero rows updated means a concurrent order won the remaining stock;
        # the surrounding transaction rolls the whole order back.
        for variant_id in variant_ids:
            quantity = quantities[variant_id]
            debited = StockBalance.objects.filter(
                city_id=city_id,
                variant_id=variant_id,
                stock_quantity__gte=quantity,
            ).update(
                stock_quantity=F("stock_quantity") - quantity,
                updated_at=Now(),
            )
            if not debited:
                raise serializers.ValidationError(
                    {
                        "items": f"Insufficient stock for SKU "
                        f"{variants[variant_id].sku} in this city."
                    }
                )

        order_items = []
        movements = []
        for item in items_data:
            variant_id = item["variant"].id
            variant = variants[variant_id]
            quantity = item["quantity"]
            order_items.append(
                OrderItem(
                    order=order,
                    variant=variant,
                    category_id=variant.product.category_id,
                    quantity=quantity,
                    unit_price_snapshot=variant.product.selling_price,
                    unit_cost_snapshot=variant.product.cost_price,
                    customisation_data=item.get("customisation_data") or {},
                )
            )
            movements.append(
                StockMovement(
                    variant=variant,
                    city_id=city_id,
                    school_id=order.school_id,
                    quantity_change=-quantity,
                    reason=StockMovement.Reason.ORDER_PLACED,
                    reference_order=order,
                    created_by_id=user.id,
                )
            )
        OrderItem.objects.bulk_create(order_items)
        StockMovement.objects.bulk_create(movements)
        OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.PLACED,
            changed_by_id=user.id,
            note="Order placed.",
        )

        # Slow side effects are dispatched after the transaction commits.
        from .tasks import (
            refresh_order_summary,
            release_expired_reservation,
            send_order_confirmation,
        )

        transaction.on_commit(lambda: send_order_confirmation.delay(str(order.id)))
        transaction.on_commit(lambda: refresh_order_summary.delay(str(order.id)))
        transaction.on_commit(
            lambda: release_expired_reservation.apply_async(
                args=[str(order.id)], countdown=15 * 60
            )
        )
        return order

    @staticmethod
    def _existing_for_actor(order, user):
        if order.placed_by_id != user.id:
            raise PermissionDenied("That idempotency key belongs to another account.")
        return order

    @staticmethod
    def _validate_customisation(schema, data):
        if not data:
            if schema and schema.get("required"):
                raise serializers.ValidationError(
                    {"customisation_data": "Required customisation is missing."}
                )
            return
        if schema.get("type") == "object" and not isinstance(data, dict):
            raise serializers.ValidationError(
                {"customisation_data": "Must be an object."}
            )
        required = schema.get("required", [])
        missing = [key for key in required if key not in data]
        if missing:
            raise serializers.ValidationError(
                {"customisation_data": f"Missing fields: {', '.join(missing)}"}
            )
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            unknown = set(data) - set(properties)
            if unknown:
                raise serializers.ValidationError(
                    {"customisation_data": f"Unknown fields: {', '.join(unknown)}"}
                )
        for key, rules in properties.items():
            if key not in data:
                continue
            expected = rules.get("type")
            valid = {
                "string": isinstance(data[key], str),
                "number": isinstance(data[key], (int, float)),
                "integer": isinstance(data[key], int) and not isinstance(data[key], bool),
                "boolean": isinstance(data[key], bool),
                "array": isinstance(data[key], list),
                "object": isinstance(data[key], dict),
            }
            if expected in valid and not valid[expected]:
                raise serializers.ValidationError(
                    {"customisation_data": f"Invalid type for {key}."}
                )
