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
    customisation_display = serializers.SerializerMethodField()

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
            "customisation_display",
        )
        read_only_fields = (
            "id",
            "variant_sku",
            "variant_size",
            "product_name",
            "category",
            "unit_price_snapshot",
            "customisation_display",
        )

    def get_customisation_display(self, obj):
        """
        Returns customisation details formatted for viewing with signed expiring URLs
        for private images. Only authorized actors (order's parent, student, or staff)
        can receive signed URLs.
        """
        if not obj.customisation_data:
            return {}

        from .storage import generate_presigned_download

        display = {}
        schema_fields = []
        schema = getattr(obj.variant.product, "customisation_schema", None)
        if isinstance(schema, list):
            schema_fields = schema
        elif isinstance(schema, dict) and "fields" in schema:
            schema_fields = schema["fields"]

        field_types = {f["key"]: f.get("type", "text") for f in schema_fields if isinstance(f, dict) and "key" in f}

        for k, v in obj.customisation_data.items():
            if k.endswith(("_print", "_thumb", "_status", "_error", "_width", "_height")):
                continue
            ftype = field_types.get(k, "image" if ("photo" in k or "image" in k or "cover" in k) else "text")
            if ftype in ("image", "image_url") and isinstance(v, str) and v.startswith("customisations/"):
                # Generate signed expiring download URL
                thumb_key = obj.customisation_data.get(f"{k}_thumb") or v
                print_key = obj.customisation_data.get(f"{k}_print") or v
                display[k] = {
                    "type": "image",
                    "file_key": v,
                    "url": generate_presigned_download(thumb_key),
                    "full_url": generate_presigned_download(print_key),
                    "original_url": generate_presigned_download(v),
                    "status": obj.customisation_data.get(f"{k}_status", "PENDING"),
                }
            else:
                display[k] = {"type": ftype, "value": v}

        return display


class OrderStatusEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderStatusEvent
        fields = ("id", "status", "timestamp", "changed_by", "note")
        read_only_fields = fields


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
            .prefetch_related("product__grades")
            .filter(id__in=variant_ids)
            .order_by("id")
        }
        if len(variants) != len(variant_ids):
            raise serializers.ValidationError(
                {"items": "One or more variants do not exist."}
            )

        from catalog.catalogue import validate_product_match
        for variant in variants.values():
            if not variant.active:
                raise serializers.ValidationError(
                    {"items": f"SKU {variant.sku} is not available."}
                )
            try:
                validate_product_match(
                    product=variant.product,
                    school_id=student.school_id,
                    class_name_or_grade=student.grade or student.class_name,
                    gender=student.gender,
                )
            except serializers.ValidationError as err:
                msg = err.detail[0] if isinstance(err.detail, list) else str(err.detail)
                raise serializers.ValidationError({"items": msg})

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

        # Dispatch image processing tasks for items with uploaded images
        from .image_tasks import process_customisation_image
        for oi in order_items:
            cdata = oi.customisation_data or {}
            for f_key, f_val in cdata.items():
                if isinstance(f_val, str) and f_val.startswith("customisations/"):
                    transaction.on_commit(
                        lambda item_id=str(oi.id), key=f_key: process_customisation_image.delay(item_id, key)
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
            if not schema:
                return
            # Check if required in schema list or dict
            if isinstance(schema, list):
                if any(f.get("required") for f in schema if isinstance(f, dict)):
                    raise serializers.ValidationError(
                        {"customisation_data": "Required customisation is missing."}
                    )
            elif isinstance(schema, dict) and schema.get("required"):
                raise serializers.ValidationError(
                    {"customisation_data": "Required customisation is missing."}
                )
            return

        if not isinstance(data, dict):
            raise serializers.ValidationError(
                {"customisation_data": "Must be an object."}
            )

        # Enforce small payload size (keys and short text only, no raw bytes or base64)
        for key, val in data.items():
            if isinstance(val, str) and (val.startswith("data:image") or len(val) > 2000):
                raise serializers.ValidationError(
                    {"customisation_data": f"Field '{key}' is too large or contains base64 image data. Upload image via object storage URL."}
                )

        if not schema:
            return

        # Handle list format schema: [ { "key": "...", "label": "...", "type": "text"|"select"|"image", "required": true, ... } ]
        if isinstance(schema, list):
            fields_by_key = {f["key"]: f for f in schema if isinstance(f, dict) and "key" in f}
            # Check required fields
            missing = [
                f["key"]
                for f in schema
                if isinstance(f, dict) and f.get("required") and (f["key"] not in data or data[f["key"]] in (None, ""))
            ]
            if missing:
                raise serializers.ValidationError(
                    {"customisation_data": f"Missing required fields: {', '.join(missing)}"}
                )

            # Validate each field type and limits
            for key, val in data.items():
                rule = fields_by_key.get(key)
                if not rule:
                    continue
                ftype = rule.get("type", "text")
                if ftype == "text":
                    if not isinstance(val, str):
                        raise serializers.ValidationError({"customisation_data": f"Field '{key}' must be text."})
                    max_len = rule.get("max_length", 200)
                    if len(val) > max_len:
                        raise serializers.ValidationError({"customisation_data": f"Field '{key}' exceeds max length {max_len}."})
                elif ftype == "select":
                    options = rule.get("options", [])
                    if options and str(val) not in [str(o) for o in options]:
                        raise serializers.ValidationError({"customisation_data": f"Invalid option '{val}' for '{key}'. Valid options: {options}"})
                elif ftype in ("image", "image_url"):
                    if not isinstance(val, str) or not val.strip():
                        raise serializers.ValidationError({"customisation_data": f"Field '{key}' must be a valid image file key."})
                    if not val.startswith("customisations/"):
                        raise serializers.ValidationError({"customisation_data": f"Field '{key}' must be an uploaded object storage key."})
            return

        # Traditional JSON Schema format: { "type": "object", "properties": {...}, "required": [...] }
        if isinstance(schema, dict):
            if "fields" in schema and isinstance(schema["fields"], list):
                # Wrapped list format
                return OrderCreateSerializer._validate_customisation(schema["fields"], data)

            required = schema.get("required", [])
            missing = [key for key in required if key not in data or data[key] in (None, "")]
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
