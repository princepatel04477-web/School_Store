import uuid
from decimal import Decimal
from django.db import transaction, IntegrityError
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
    idempotency_key = serializers.CharField(max_length=128, write_only=True)
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
        idem = validated_data["idempotency_key"]

        # This check is also repeated under the transaction; the unique index is
        # the final arbiter for concurrent retries.
        existing = Order.objects.filter(idempotency_key=idem).first()
        if existing:
            return existing

        # Lock in deterministic UUID order. Never use request/cart order here.
        variant_ids = sorted({item["variant"].id for item in items_data}, key=str)
        locked_variants = {
            v.id: v
            for v in ProductVariant.objects.select_for_update()
            .select_related("product", "product__category")
            .filter(id__in=variant_ids).order_by("id")
        }
        if len(locked_variants) != len(variant_ids):
            raise serializers.ValidationError({"items": "One or more variants do not exist."})

        quantities = {}
        for item in items_data:
            quantities[item["variant"].id] = quantities.get(item["variant"].id, 0) + item["quantity"]

        subtotal = Decimal("0.00")
        for variant_id in variant_ids:
            v = locked_variants[variant_id]
            qty = quantities[variant_id]
            if v.stock_quantity < qty:
                raise serializers.ValidationError({"items": f"Insufficient stock for SKU {v.sku}."})
            subtotal += v.product.selling_price * qty
            self._validate_customisation(v.product.customisation_schema, next(
                i["customisation_data"] for i in items_data if i["variant"].id == variant_id
            ))

        short_token = uuid.uuid4().hex[:8].upper()
        # Savepoint lets a concurrent retry recover from the unique-key race.
        try:
            with transaction.atomic():
                order = Order.objects.create(
                    idempotency_key=idem, order_number=f"ORD-{short_token}",
                    placed_by_id=user.id, placed_by_role=user.role, student=student,
                    parent_id=student.parent_id or (user.id if user.role == "PARENT" else None),
                    school_id=student.school_id, city_id=student.city_id or student.school.city_id,
                    status=Order.Status.PLACED, payment_status=Order.PaymentStatus.PENDING,
                    subtotal=subtotal, total=subtotal, delivery_details=delivery_details,
                )
        except IntegrityError:
            return Order.objects.get(idempotency_key=idem)

        order_items = []
        movements = []
        for item in items_data:
            v = locked_variants[item["variant"].id]
            qty = item["quantity"]
            v.stock_quantity -= qty
            v.save(update_fields=["stock_quantity", "updated_at"])
            order_items.append(OrderItem(
                order=order, variant=v, category_id=v.product.category_id, quantity=qty,
                unit_price_snapshot=v.product.selling_price, unit_cost_snapshot=v.product.cost_price,
                customisation_data=item.get("customisation_data") or {},
            ))
            movements.append(StockMovement(
                variant=v, school_id=v.school_id, city_id=v.city_id, quantity_change=-qty,
                reason=StockMovement.Reason.ORDER_PLACED, reference_order=order, created_by_id=user.id,
            ))
        OrderItem.objects.bulk_create(order_items)
        StockMovement.objects.bulk_create(movements)
        OrderStatusEvent.objects.create(order=order, status=Order.Status.PLACED,
                                        changed_by_id=user.id, note="Order placed.")

        # External work starts only after all rows are durable.
        from .tasks import send_order_confirmation, refresh_order_summary, release_expired_reservation
        transaction.on_commit(lambda: send_order_confirmation.delay(str(order.id)))
        transaction.on_commit(lambda: refresh_order_summary.delay(str(order.id)))
        transaction.on_commit(lambda: release_expired_reservation.apply_async(args=[str(order.id)], countdown=15 * 60))
        return order

    @staticmethod
    def _validate_customisation(schema, data):
        if not data:
            if schema and schema.get("required"):
                raise serializers.ValidationError({"customisation_data": "Required customisation is missing."})
            return
        if schema.get("type") == "object" and not isinstance(data, dict):
            raise serializers.ValidationError({"customisation_data": "Must be an object."})
        required = schema.get("required", [])
        missing = [key for key in required if key not in data]
        if missing:
            raise serializers.ValidationError({"customisation_data": f"Missing fields: {', '.join(missing)}"})
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            unknown = set(data) - set(properties)
            if unknown:
                raise serializers.ValidationError({"customisation_data": f"Unknown fields: {', '.join(unknown)}"})
        for key, rules in properties.items():
            if key not in data:
                continue
            expected = rules.get("type")
            valid = {"string": isinstance(data[key], str), "number": isinstance(data[key], (int, float)),
                     "integer": isinstance(data[key], int) and not isinstance(data[key], bool),
                     "boolean": isinstance(data[key], bool), "array": isinstance(data[key], list),
                     "object": isinstance(data[key], dict)}
            if expected in valid and not valid[expected]:
                raise serializers.ValidationError({"customisation_data": f"Invalid type for {key}."})
