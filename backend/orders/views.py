import json
from decimal import Decimal
from django.db import transaction
from django.core.cache import cache
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin
from rest_framework.views import APIView
from .delivery import PINCODE_REGEX, pin_service
from .models import Order, OrderStatusEvent, PaymentAttempt, PaymentReview
from .payment import RazorpayGateway
from .status import apply_provider_payment, can_transition_order, change_order_status, record_payment
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
    ).prefetch_related(
        "status_events", "payment_attempts", "after_sales_requests"
    ).order_by("-created_at")
    pagination_class = BoundedCursorPagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")

    scope_city_field = "city_id"
    scope_school_field = "school_id"
    scope_parent_field = "parent_id"

    def destroy(self, request, *args, **kwargs):
        if request.user.role == "PARENT":
            raise PermissionDenied(
                "Parents cannot edit or cancel an order directly. Use the after-sales cancellation request."
            )
        return super().destroy(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "retrieve":
            qs = qs.prefetch_related("items__variant__product", "payment_reviews", "refunds")

        status_param = self.request.query_params.get("status")
        school_param = self.request.query_params.get("school")
        city_param = self.request.query_params.get("city")
        student_param = self.request.query_params.get("student")
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        updated_since = self.request.query_params.get("updated_since")

        if status_param:
            qs = qs.filter(status=status_param)
        if school_param:
            qs = qs.filter(school_id=school_param)
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
        if order.payment_status == Order.PaymentStatus.PAID:
            raise ValidationError({"detail": "This order is already paid."})
        if order.status == Order.Status.CANCELLED:
            raise ValidationError({"detail": "This order was cancelled. Please place it again."})
        if order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
            raise ValidationError({"detail": "This order is paid in cash on delivery."})
        gateway = RazorpayGateway()
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            # Reuse one Razorpay order per store order: a retry must not create a
            # second gateway order whose webhook would not match this row.
            if not order.razorpay_order_id:
                order.razorpay_order_id = gateway.create_order(order)["id"]
                order.save(update_fields=["razorpay_order_id", "updated_at"])
        return Response({
            "order_id": order.razorpay_order_id,
            "amount": int(Decimal(order.total) * 100),
            "currency": "INR",
            "key_id": gateway.key_id,
        })

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

        rate_limit_key = f"rate_limit_reconcile_{order.id}"
        # Rate limit: at most 1 call per 5s per order
        is_allowed = cache.add(rate_limit_key, "1", timeout=5)

        if is_allowed and order.razorpay_order_id:
            gateway = RazorpayGateway()
            try:
                payments = gateway.fetch_order_payments(order.razorpay_order_id)
                for p in payments:
                    apply_provider_payment(
                        order,
                        p,
                        PaymentAttempt.Source.RECONCILE,
                        changed_by=request.user,
                    )
            except Exception:
                pass

        order.refresh_from_db()
        in_prog = order.payment_attempts.filter(
            status__in=[PaymentAttempt.Status.CREATED, PaymentAttempt.Status.AUTHORIZED]
        ).exists()
        last_failed = order.payment_attempts.filter(
            status=PaymentAttempt.Status.FAILED
        ).order_by("-first_seen_at").first()

        return Response({
            "payment_status": order.payment_status,
            "status": order.status,
            "in_progress": in_prog,
            "last_attempt_failed": bool(last_failed and order.payment_status != Order.PaymentStatus.PAID),
            "error_reason": last_failed.error_reason if last_failed else "",
        })

    @action(detail=True, methods=["post"], url_path="switch-to-cod")
    def switch_to_cod(self, request, pk=None):
        order = self.get_object()
        if (
            request.user.role != "BOSS"
            and not getattr(request.user, "is_superuser", False)
            and order.payer_id != request.user.id
        ):
            raise PermissionDenied("Only the assigned payer may switch payment method.")
        if order.status == Order.Status.CANCELLED:
            raise ValidationError({"detail": "This order was cancelled. Please place it again."})
        if order.payment_status != Order.PaymentStatus.PENDING:
            raise ValidationError({"detail": f"Cannot switch to COD when payment status is {order.payment_status}."})
        if order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
            return Response({"status": "ok", "payment_method": "COD"})

        gateway = RazorpayGateway()
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            if order.status == Order.Status.CANCELLED or order.payment_status != Order.PaymentStatus.PENDING:
                raise ValidationError({"detail": "Order state changed. Cannot switch to COD."})

            if order.razorpay_order_id and gateway.is_usable():
                try:
                    payments = gateway.fetch_order_payments(order.razorpay_order_id)
                    for p in payments:
                        apply_provider_payment(
                            order,
                            p,
                            PaymentAttempt.Source.RECONCILE,
                            changed_by=request.user,
                        )
                except Exception:
                    raise ValidationError({"detail": "Unable to contact payment provider. Please try again."})

            order.refresh_from_db()
            has_active = order.payment_attempts.filter(
                status__in=[
                    PaymentAttempt.Status.CAPTURED,
                    PaymentAttempt.Status.AUTHORIZED,
                    PaymentAttempt.Status.CREATED,
                ]
            ).exists()
            if has_active or order.payment_status == Order.PaymentStatus.PAID:
                raise ValidationError({"detail": "A payment is already authorized, captured or in progress. Cannot switch to COD."})

            order.payment_method = Order.PaymentMethod.CASH_ON_DELIVERY
            order.save(update_fields=["payment_method", "updated_at"])
            OrderStatusEvent.objects.create(
                order=order,
                status=order.status,
                changed_by=request.user,
                note="Payment method changed to Cash on Delivery.",
            )
        return Response({"status": "ok", "payment_method": "COD"})

    @action(detail=True, methods=["get"], url_path="after-sales-eligibility")
    def after_sales_eligibility(self, request, pk=None):
        """Returns server-owned eligibility for cancellation, size exchange, and returns."""
        order = self.get_object()
        from .after_sales import get_order_after_sales_eligibility
        eligibility = get_order_after_sales_eligibility(order, request.user)
        return Response(eligibility, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="request-after-sale")
    def request_after_sale(self, request, pk=None):
        """Parent request for cancellation, size exchange, or damaged/wrong item."""
        order = self.get_object()
        from .after_sales import create_after_sale_request
        from .serializers import OrderAfterSaleRequestSerializer
        req_obj = create_after_sale_request(order, request.user, request.data)
        return Response(OrderAfterSaleRequestSerializer(req_obj).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="after-sales-requests")
    def after_sales_requests(self, request, pk=None):
        """Lists active and historical after-sales requests and refunds for this order."""
        order = self.get_object()
        from .serializers import OrderAfterSaleRequestSerializer, OrderRefundSerializer
        return Response({
            "requests": OrderAfterSaleRequestSerializer(order.after_sales_requests.all(), many=True).data,
            "refunds": OrderRefundSerializer(order.refunds.all(), many=True).data,
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="review-after-sale")
    def review_after_sale(self, request):
        """Staff action to review, approve, reject, inspect, or complete an after-sales request."""
        if request.user.role not in ("BOSS", "ADMIN", "SCHOOL_ADMIN"):
            raise PermissionDenied("Only authorized staff may review after-sales requests.")
        req_id = request.data.get("request_id")
        action_type = request.data.get("action")
        notes = (request.data.get("notes") or "").strip()
        restock_condition = (request.data.get("restock_condition") or "").strip()

        from .models import OrderAfterSaleRequest
        from .after_sales import review_after_sale_request
        from .serializers import OrderAfterSaleRequestSerializer

        req_obj = OrderAfterSaleRequest.objects.filter(pk=req_id).first()
        if not req_obj:
            raise ValidationError({"request_id": ["After-sales request not found."]})

        updated_req = review_after_sale_request(
            req_obj, request.user, action_type, notes=notes, restock_condition=restock_condition
        )
        return Response(OrderAfterSaleRequestSerializer(updated_req).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="process-refund")
    def process_refund(self, request):
        """Staff action to process or retry an OrderRefund record."""
        if request.user.role not in ("BOSS", "ADMIN", "SCHOOL_ADMIN"):
            raise PermissionDenied("Only authorized staff may process refunds.")
        refund_id = request.data.get("refund_id")
        from .models import OrderRefund
        from .after_sales import process_order_refund
        from .serializers import OrderRefundSerializer

        refund = OrderRefund.objects.filter(pk=refund_id).first()
        if not refund:
            raise ValidationError({"refund_id": ["Refund record not found."]})

        res = process_order_refund(refund, actor=request.user)
        return Response(OrderRefundSerializer(res).data, status=status.HTTP_200_OK)

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


class PincodeLookupView(APIView):
    """
    Public lookup for PIN codes:
    Separates format validation, geographical lookup, and courier serviceability.
    Delivery is never promised based solely on PIN validity.
    """
    authentication_classes = []
    permission_classes = [AllowAny]
    # Public, and backed by a paid provider once configured: rate-limit per IP.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pin_lookup"

    def get(self, request):
        pincode = (request.query_params.get("pincode") or "").strip()
        format_valid = bool(PINCODE_REGEX.match(pincode))
        geography = pin_service.lookup_geography(pincode)
        serviceability = pin_service.check_serviceability(pincode)
        return Response(
            {
                "pincode": pincode,
                "format_valid": format_valid,
                "geography": geography,
                "serviceability": serviceability,
            },
            status=status.HTTP_200_OK,
        )

