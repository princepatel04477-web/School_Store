"""
Serializers for Day 4 Size Exchange endpoints.
"""

from rest_framework import serializers
from .models import SizeExchangeRequest, OrderItem, Order


class SizeExchangeRequestSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order.order_number", read_only=True)
    product_id = serializers.CharField(source="order_item.variant.product_id", read_only=True)
    product_name = serializers.CharField(source="order_item.variant.product.name", read_only=True)
    target_size = serializers.CharField(source="target_variant.size", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    next_action = serializers.SerializerMethodField()
    held_age_seconds = serializers.SerializerMethodField()

    class Meta:
        model = SizeExchangeRequest
        fields = (
            "id",
            "order",
            "order_number",
            "order_item",
            "product_id",
            "product_name",
            "status",
            "status_display",
            "reason",
            "from_size",
            "target_variant",
            "target_size",
            "quantity",
            "reservation",
            "reserved_at",
            "released_at",
            "replacement_set_aside_at",
            "condition",
            "condition_note",
            "is_restocked",
            "review_reasons",
            "window_starts_at",
            "window_ends_at",
            "window_confirmed_start",
            "window_confirmed_at",
            "window_confirmed_note",
            "handover_method",
            "received_at",
            "handover_evidence",
            "handed_over_at",
            "received_by_name",
            "handover_note",
            "original_disposition",
            "original_returned_at",
            "rejection_reason",
            "charge_paise",
            "idempotency_key",
            "next_action",
            "held_age_seconds",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_next_action(self, obj: SizeExchangeRequest) -> str:
        if obj.status == SizeExchangeRequest.Status.REQUESTED:
            if "NO_DELIVERY_RECORD" in obj.review_reasons:
                return "We will check your delivery date."
            if "HOME_SWAP" in obj.review_reasons:
                return "We will contact you to arrange the home swap."
            return f"Size {obj.target_variant.size} is kept for you while staff review your request."
        elif obj.status == SizeExchangeRequest.Status.APPROVED:
            if obj.handover_method == SizeExchangeRequest.HandoverMethod.HOME_VISIT:
                return "Staff will visit your address to inspect the garment and swap sizes."
            return f"Bring {obj.quantity} × size {obj.from_size} shirt to the school counter."
        elif obj.status == SizeExchangeRequest.Status.RECEIVED:
            return f"Original shirt received. Handover of size {obj.target_variant.size} pending."
        elif obj.status == SizeExchangeRequest.Status.INSPECTION_FAILED:
            return f"Collect your size {obj.from_size} shirt from the counter ({obj.condition_note})."
        elif obj.status == SizeExchangeRequest.Status.COMPLETED:
            return f"Exchange complete. Size {obj.target_variant.size} handed over."
        elif obj.status == SizeExchangeRequest.Status.REJECTED:
            return f"Request rejected: {obj.rejection_reason or 'Not approved.'}"
        elif obj.status == SizeExchangeRequest.Status.WITHDRAWN:
            return "Request withdrawn by parent."
        return ""

    def get_held_age_seconds(self, obj: SizeExchangeRequest) -> int:
        from django.utils import timezone
        if obj.reservation in (SizeExchangeRequest.Reservation.HELD, SizeExchangeRequest.Reservation.LOCKED):
            return int((timezone.now() - obj.reserved_at).total_seconds())
        return 0


class SizeExchangeCreateSerializer(serializers.Serializer):
    order_item = serializers.UUIDField(required=True)
    target_variant = serializers.UUIDField(required=False)
    target_size = serializers.CharField(required=False, max_length=50)
    reason = serializers.ChoiceField(choices=SizeExchangeRequest.Reason.choices, required=True)
    quantity = serializers.IntegerField(default=1, min_value=1)
    from_size = serializers.CharField(required=False, max_length=50)


class StaffActionSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, default="")
    condition = serializers.CharField(required=False, allow_blank=True, default="")
    condition_note = serializers.CharField(required=False, allow_blank=True, default="")
    replacement_set_aside = serializers.BooleanField(required=False, default=False)
    handover_method = serializers.CharField(required=False, allow_blank=True, default="")
    handover_evidence = serializers.CharField(required=False, allow_blank=True, default="")
    received_by_name = serializers.CharField(required=False, allow_blank=True, default="")
    window_confirmed_start = serializers.CharField(required=False, allow_blank=True, default="")
    article_number = serializers.CharField(required=False, allow_blank=True, default="")
    delivery_confirmed = serializers.BooleanField(required=False, default=False)
