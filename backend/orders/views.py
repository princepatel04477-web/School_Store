import json
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin
from .models import Order, OrderStatusEvent, PaymentAttempt
from .payment import RazorpayGateway
from .payment_view import MINIMUM_HOLD, check_provider, matching_captures, payment_view, reconcile_order
from django.utils import timezone
from django.db.models import Exists
from .status import apply_provider_payment, can_transition_order, change_order_status
from .serializers import (
    OrderCreateSerializer,
    OrderDetailSerializer,
    OrderListSerializer,
    OrderQuoteSerializer,
)


class OrderViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    """
    Scoped Order ViewSet:
    - BOSS: all orders
    - ADMIN: `WHERE city_id = user.city_id` (indexed by idx_order_city_created)
    - SCHOOL_ADMIN / TEACHER: `WHERE school_id = user.school_id` (indexed by idx_order_school_created)
    - PARENT: `WHERE parent_id = user.id` (indexed by idx_order_parent_created)
    """

    queryset = Order.objects.select_related(
        "student", "school", "city", "placed_by", "payer"
    ).order_by("-created_at")
    pagination_class = BoundedCursorPagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")

    scope_city_field = "city_id"
    scope_school_field = "school_id"
    scope_branch_field = "branch_id"
    scope_parent_field = "parent_id"

    def destroy(self, request, *args, **kwargs):
        if request.user.role == "PARENT":
            raise PermissionDenied("Parents cannot edit or cancel an order after it is placed.")
        return super().destroy(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            qs = qs.prefetch_related("payment_attempts")
            if self.request.query_params.get("payment_attention") == "1":
                qs = qs.filter(
                    parent_id=self.request.user.pk, payment_method=Order.PaymentMethod.ONLINE,
                ).exclude(status=Order.Status.CANCELLED).exclude(Exists(matching_captures()))
        if self.action == "retrieve":
            qs = qs.prefetch_related("items__variant__product", "status_events", "payment_attempts", "payment_reviews")

        status_param = self.request.query_params.get("status")
        school_param = self.request.query_param = self.request.query_params.get("school")
        city_param = self.request.query_params.get("city")
        student_param = self.request.query_params.get("student")
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        updated_since = self.request.query_params.get("updated_since")

        if status_param:
            qs = qs.filter(status=status_param)
        if school_param:
            qs = qs.filter(school_id=school_param)
        branch_param = self.request.query_params.get("branch")
        if branch_param:
            qs = qs.filter(branch_id=branch_param)
        if city_param:
            qs = qs.filter(city_id=city_param)
        if student_param:
            qs = qs.filter(student_id=student_param)
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        if updated_since:
            qs = qs.filter(updated_at__gt=updated_since)
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return OrderCreateSerializer
        if self.action == "retrieve":
            return OrderDetailSerializer
        return OrderListSerializer

    @action(detail=False, methods=["post"], url_path="quote")
    def quote(self, request):
        serializer = OrderQuoteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        return Response(serializer.get_quote(), status=status.HTTP_200_OK)

    def create(self, request, *args, **kwargs):
        payload = request.data.copy()
        payload.setdefault("idempotency_key", request.headers.get("Idempotency-Key", ""))
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        order = serializer.save()
        order = (
            Order.objects.select_related(
                "student", "school", "city", "placed_by", "payer"
            )
            .prefetch_related("items__variant__product", "status_events", "payment_attempts", "payment_reviews")
            .get(pk=order.pk)
        )
        return Response(
            OrderDetailSerializer(order).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="payment")
    def payment(self, request, pk=None):
        order = self.get_object()
        if (
            request.user.role != "BOSS"
            and not getattr(request.user, "is_superuser", False)
            and order.payer_id != request.user.id
        ):
            raise PermissionDenied("Only the assigned payer may start payment.")
        with transaction.atomic():
            payer = order.payer
            order = Order.objects.select_for_update().get(pk=order.pk)
            if order.payment_method == Order.PaymentMethod.ONLINE and order.razorpay_order_id:
                if not check_provider(order, PaymentAttempt.Source.RECONCILE, request.user):
                    return Response({"code": "payment_check_failed", "payment_view": payment_view(order)}, status=503)
            now = timezone.now()
            view = payment_view(order, now)
            if view["receipt"] or order.payment_status == Order.PaymentStatus.PAID:
                code = "already_paid"
            elif view["in_progress"]:
                code = "payment_in_progress"
            elif not view["hold_expires_at"]:
                code = "payment_unavailable"
            elif view["hold_expires_at"] < now + MINIMUM_HOLD:
                code = "hold_too_short"
            elif not view["can_pay_now"]:
                code = "payment_unavailable"
            else:
                gateway = RazorpayGateway()
                if not order.razorpay_order_id:
                    try:
                        order.razorpay_order_id = gateway.create_order(order)["id"]
                    except Exception:
                        order.payment_checked_at = now
                        order.payment_check_ok = False
                        order.payment_check_failed_since = order.payment_check_failed_since or now
                        order.save(update_fields=[
                            "payment_checked_at", "payment_check_ok", "payment_check_failed_since", "updated_at",
                        ])
                        return Response({"code": "payment_check_failed", "payment_view": payment_view(order)}, status=503)
                    order.save(update_fields=["razorpay_order_id", "updated_at"])
                return Response({
                    "key_id": gateway.key_id,
                    "razorpay_order_id": order.razorpay_order_id,
                    "amount_paise": view["amount_due_paise"],
                    "currency": "INR",
                    "store_order_number": order.order_number,
                    "hold_expires_at": view["hold_expires_at"],
                    "prefill": {
                        "name": payer.get_full_name() if payer else "",
                        "contact": payer.phone if payer else "",
                    },
                })
            return Response({"code": code, "payment_view": view}, status=409)

    @action(detail=True, methods=["post"], url_path="verify-payment")
    def verify_payment(self, request, pk=None):
        order = self.get_object()
        if (
            request.user.role != "BOSS"
            and not getattr(request.user, "is_superuser", False)
            and order.payer_id != request.user.id
        ):
            raise PermissionDenied("Only the assigned payer may verify payment.")
        razorpay_order_id = order.razorpay_order_id
        payment_id = request.data.get("razorpay_payment_id", "")
        signature = request.data.get("razorpay_signature", "")
        # The signature must be for THIS order's Razorpay order id, never one the
        # client sends: a valid signature from a cheaper order must not pay this one.
        if (
            not razorpay_order_id
            or request.data.get("razorpay_order_id", razorpay_order_id) != razorpay_order_id
            or not RazorpayGateway().verify_signature(razorpay_order_id, payment_id, signature)
        ):
            return Response({"detail": "Invalid payment signature."}, status=status.HTTP_400_BAD_REQUEST)

        if signature:
            order.razorpay_signature = signature
            order.save(update_fields=["razorpay_signature", "updated_at"])

        gateway = RazorpayGateway()
        payment_entity = None
        try:
            payment_entity = gateway.fetch_payment(payment_id)
        except Exception:
            pass

        if not payment_entity:
            # Section 3: If Razorpay cannot be reached, return 503.
            return Response(
                {"detail": "Unable to contact payment provider. Please try again."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        attempt = apply_provider_payment(
            order,
            payment_entity,
            PaymentAttempt.Source.VERIFY,
            changed_by=request.user,
        )
        order.refresh_from_db()
        data = OrderDetailSerializer(order).data
        if order.payment_status == Order.PaymentStatus.PAID:
            data["status"] = "paid"
        elif attempt and attempt.status == PaymentAttempt.Status.AUTHORIZED:
            data["status"] = "confirming"
        elif attempt and attempt.status == PaymentAttempt.Status.FAILED:
            data["status"] = "failed"
            data["reason"] = attempt.error_reason or attempt.error_code
        else:
            data["status"] = "confirming"
        return Response(data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="reconcile-payment")
    def reconcile_payment(self, request, pk=None):
        order = self.get_object()
        if (
            request.user.role != "BOSS"
            and not getattr(request.user, "is_superuser", False)
            and order.payer_id != request.user.id
        ):
            raise PermissionDenied("Only the assigned payer may reconcile payment.")

        return Response(reconcile_order(order.pk, request.user))

    @action(detail=True, methods=["post"], url_path="switch-to-cod")
    def switch_to_cod(self, request, pk=None):
        order = self.get_object()
        if (
            request.user.role != "BOSS"
            and not getattr(request.user, "is_superuser", False)
            and order.payer_id != request.user.id
        ):
            raise PermissionDenied("Only the assigned payer may switch payment method.")
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            if order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
                return Response({"payment_method": "COD", "payment_view": payment_view(order)})
            if not check_provider(order, PaymentAttempt.Source.RECONCILE, request.user):
                return Response({"code": "payment_check_failed", "payment_view": payment_view(order)}, status=503)
            view = payment_view(order)
            if not view["can_switch_to_cod"]:
                return Response({"code": "cod_unavailable", "payment_view": view}, status=409)
            order.payment_method = Order.PaymentMethod.CASH_ON_DELIVERY
            order.hold_expires_at = None
            order.save(update_fields=["payment_method", "hold_expires_at", "updated_at"])
            OrderStatusEvent.objects.create(
                order=order, status=order.status, changed_by=request.user,
                note="Payment method changed to Cash on Delivery.",
            )
            return Response({"payment_method": "COD", "payment_view": payment_view(order)})

    def _change_status(self, request, queryset):
        user = request.user
        if user.role in ("PARENT", "TEACHER"):
            raise PermissionDenied("Only Boss, Admin, or School Admin may modify order statuses.")
        new_status = request.data.get("status")
        if not new_status or new_status not in Order.Status.values:
            raise ValidationError({"status": [f"Invalid status '{new_status}'."]})
        note = (request.data.get("note") or "").strip()

        # If checking a single order (PUT/PATCH), validate beforehand to give clear error message
        target_orders = list(queryset.all())
        if len(target_orders) == 1:
            can_move, reason = can_transition_order(target_orders[0], new_status)
            if not can_move:
                raise ValidationError({"status": [reason]})

        return new_status, change_order_status(queryset, new_status, user, note)

    def update(self, request, *args, **kwargs):
        # The only thing staff edit on a placed order is its status.
        if request.user.role == "PARENT":
            raise PermissionDenied("Parents cannot edit or cancel an order after it is placed.")
        order = self.get_object()
        new_status, changed = self._change_status(request, self.get_queryset().filter(pk=order.pk))
        if not changed and order.status != new_status:
            can_move, reason = can_transition_order(order, new_status)
            raise ValidationError(
                {"status": [reason or f"An order that is {order.status} cannot move to {new_status}."]}
            )
        order = self.get_queryset().prefetch_related(
            "items__variant__product", "status_events"
        ).get(pk=order.pk)
        return Response(OrderDetailSerializer(order).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    @action(detail=False, methods=["post"], url_path="bulk-status")
    def bulk_status(self, request):
        """One request: one bulk UPDATE + one bulk_create of status events."""
        order_ids = request.data.get("order_ids")
        if not order_ids or not isinstance(order_ids, list):
            return Response(
                {"order_ids": ["A non-empty list of order IDs is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(order_ids) > 500:
            return Response(
                {"order_ids": ["At most 500 orders per request."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        new_status, changed = self._change_status(
            request, self.get_queryset().filter(id__in=order_ids)
        )
        changed_ids = {str(oid) for oid in changed}
        skipped = sorted({str(oid) for oid in order_ids} - changed_ids)

        skipped_orders = self.get_queryset().filter(id__in=skipped)
        skipped_reasons = {}
        for so in skipped_orders:
            _, reason = can_transition_order(so, new_status)
            skipped_reasons[str(so.id)] = reason or f"Cannot move {so.status} to {new_status}"

        return Response({
            "updated_count": len(changed),
            "status": new_status,
            "order_ids": sorted(changed_ids),
            "skipped_ids": skipped,
            "skipped_reasons": skipped_reasons,
        })

    def perform_destroy(self, instance):
        user = self.request.user
        if user.role != "BOSS" and not getattr(user, "is_superuser", False):
            raise PermissionDenied("Only Boss may delete orders.")
        instance.delete()
