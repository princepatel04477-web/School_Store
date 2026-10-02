import uuid
from decimal import Decimal
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from catalog.models import ProductVariant, StockMovement
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


class OrderListSerializer(serializers.ModelSerializer):
    """
    Lightweight list serializer.
    Rule P2: no nested arrays in list payloads and no redundant raw FK UUIDs —
    50 rows stay comfortably under the ~30 KB budget.
    """

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
    student = serializers.PrimaryKeyRelatedField(
        queryset=Student.objects.select_related("school", "school__city").all()
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

    @transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        student = validated_data["student"]
        items_data = validated_data["items"]
        delivery_details = validated_data.get("delivery_details", {})

        variant_ids = [item["variant"].id for item in items_data]
        locked_variants = {
            v.id: v
            for v in ProductVariant.objects.select_for_update()
            .select_related("product", "product__category")
            .filter(id__in=variant_ids)
        }

        subtotal = Decimal("0.00")
        for item in items_data:
            v = locked_variants[item["variant"].id]
            if v.stock_quantity < item["quantity"]:
                raise serializers.ValidationError(
                    {"items": f"Insufficient stock for SKU {v.sku}."}
                )
            subtotal += v.product.selling_price * item["quantity"]

        short_token = uuid.uuid4().hex[:8].upper()
        order = Order.objects.create(
            order_number=f"ORD-{short_token}",
            placed_by_id=user.id,
            placed_by_role=user.role,
            student=student,
            parent_id=student.parent_id or (user.id if user.role == "PARENT" else None),
            school_id=student.school_id,
            city_id=student.city_id or student.school.city_id,
            status=Order.Status.PENDING,
            payment_status=Order.PaymentStatus.PENDING,
            subtotal=subtotal,
            total=subtotal,
            delivery_details=delivery_details,
        )

        for item in items_data:
            v = locked_variants[item["variant"].id]
            qty = item["quantity"]
            v.stock_quantity -= qty
            v.save(update_fields=["stock_quantity", "updated_at"])

            OrderItem.objects.create(
                order=order,
                variant=v,
                category_id=v.product.category_id,
                quantity=qty,
                unit_price_snapshot=v.product.selling_price,
                unit_cost_snapshot=v.product.cost_price,
                customisation_data=item.get("customisation_data") or {},
            )
            StockMovement.objects.create(
                variant=v,
                school_id=v.school_id,
                city_id=v.city_id,
                quantity_change=-qty,
                reason=StockMovement.Reason.ORDER_PLACED,
                reference_order=order,
                created_by_id=user.id,
            )

        OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.PENDING,
            changed_by_id=user.id,
            note="Order created.",
        )
        return order
