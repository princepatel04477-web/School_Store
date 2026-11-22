"""
Views for Day 4 Size Exchange endpoints.
"""

from django.core.exceptions import PermissionDenied, ValidationError
from django.db.models import Case, Value, When, Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.generics import ListAPIView

from common.pagination import BoundedCursorPagination
from common.scoping import apply_user_scope
from .models import Order, SizeExchangeRequest
from .exchange import (
    get_order_exchange_summary,
    create_size_exchange_request,
    withdraw_size_exchange_request,
    review_size_exchange_request,
    ActiveRequestError,
    SizeSoldOutError,
    ReplacementNotSecuredError,
)
from .exchange_serializers import (
    SizeExchangeRequestSerializer,
    SizeExchangeCreateSerializer,
    StaffActionSerializer,
)


class OrderExchangeView(APIView):
    """
    Parent-facing size exchange hub for an order:
    GET  /api/orders/<id>/exchange/
    POST /api/orders/<id>/exchange/
    """
    permission_classes = [IsAuthenticated]

    def get_order(self, order_id):
        order = get_object_or_404(Order, pk=order_id)
        user = self.request.user
        is_staff = user.role in ("BOSS", "ADMIN", "SCHOOL_ADMIN")
        if not is_staff and order.parent_id != user.id and order.placed_by_id != user.id:
            raise PermissionDenied("You do not have permission to view exchanges for this order.")
        return order

    def get(self, request, order_id):
        order = self.get_order(order_id)
        summary = get_order_exchange_summary(order, request.user)
        return Response(summary, status=status.HTTP_200_OK)

    def post(self, request, order_id):
        order = self.get_order(order_id)
        serializer = SizeExchangeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        idempotency_key = (
            request.headers.get("Idempotency-Key")
            or request.META.get("HTTP_IDEMPOTENCY_KEY")
            or request.data.get("idempotency_key")
            or ""
        )

        try:
            req_obj, created = create_size_exchange_request(
                order=order,
                user=request.user,
                data=serializer.validated_data,
                idempotency_key=idempotency_key,
            )
        except SizeSoldOutError as exc:
            return Response(
                {"code": "SIZE_SOLD_OUT", "message": str(exc), "sizes": exc.sizes_data},
                status=status.HTTP_409_CONFLICT,
            )
        except ActiveRequestError as exc:
            return Response(
                {
                    "code": "ACTIVE_REQUEST",
                    "message": str(exc),
                    "request": SizeExchangeRequestSerializer(exc.active_request).data,
                },
                status=status.HTTP_409_CONFLICT,
            )
        except ValidationError as exc:
            detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
            return Response(detail, status=status.HTTP_400_BAD_REQUEST)

        out_serializer = SizeExchangeRequestSerializer(req_obj)
        http_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(out_serializer.data, status=http_code)


class OrderExchangeWithdrawView(APIView):
    """
    Parent endpoint to withdraw a pending exchange request:
    POST /api/orders/<id>/exchange/<request_id>/withdraw/
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, order_id, request_id):
        req_obj = get_object_or_404(
            SizeExchangeRequest,
            pk=request_id,
            order_id=order_id,
        )
        try:
            withdrawn = withdraw_size_exchange_request(req_obj, request.user)
        except ValidationError as exc:
            detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
            return Response(detail, status=status.HTTP_400_BAD_REQUEST)

        return Response(SizeExchangeRequestSerializer(withdrawn).data, status=status.HTTP_200_OK)


class ExchangeQueueCursorPagination(BoundedCursorPagination):
    page_size = 20
    ordering = ["-created_at"]


class ExchangeQueueListView(ListAPIView):
    """
    Staff exchange queue endpoint:
    GET /api/orders/exchange-queue/?status=&order_id=
    """
    permission_classes = [IsAuthenticated]
    pagination_class = ExchangeQueueCursorPagination
    serializer_class = SizeExchangeRequestSerializer

    def get_queryset(self):
        user = self.request.user
        if user.role not in ("BOSS", "ADMIN", "SCHOOL_ADMIN"):
            raise PermissionDenied("You do not have access to the staff exchange queue.")

        qs = (
            SizeExchangeRequest.objects
            .select_related(
                "order",
                "order_item",
                "order_item__variant",
                "order_item__variant__product",
                "target_variant",
                "created_by",
            )
        )

        # Scoping without leaking when city/school is null
        # Regression case 5
        if user.role == "ADMIN":
            if not user.city_id:
                return qs.none()
            qs = qs.filter(order__city_id=user.city_id)
        elif user.role == "SCHOOL_ADMIN":
            if not user.school_id:
                return qs.none()
            qs = qs.filter(order__school_id=user.school_id)
        # BOSS has nationwide visibility

        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param.upper().strip())

        order_param = self.request.query_params.get("order_id")
        if order_param:
            qs = qs.filter(order_id=order_param)

        # Order: review reasons first, then oldest hold, then newest created
        # Order by review_reasons != [] first
        return qs.order_by(
            Case(
                When(~Q(review_reasons=[]), then=Value(0)),
                default=Value(1),
            ),
            "reserved_at",
            "-created_at",
        )


class ExchangeQueueActionView(APIView):
    """
    Staff review actions:
    POST /api/orders/exchange-queue/<request_id>/<action>/
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, request_id, action):
        req_obj = get_object_or_404(SizeExchangeRequest, pk=request_id)
        user = self.request.user

        # School Admin read-only check
        if user.role == "SCHOOL_ADMIN":
            raise PermissionDenied("School administrators have read-only access to exchange requests.")
        if user.role not in ("BOSS", "ADMIN"):
            raise PermissionDenied("Only authorized staff may execute review actions.")

        serializer = StaffActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Action normalization (e.g. 'confirm-window' -> 'CONFIRM_WINDOW')
        normalized_action = action.upper().replace("-", "_").strip()

        try:
            updated = review_size_exchange_request(
                request_obj=req_obj,
                staff_user=user,
                action=normalized_action,
                data=serializer.validated_data,
            )
        except ReplacementNotSecuredError as exc:
            return Response(
                {"code": "REPLACEMENT_NOT_SECURED", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except ValidationError as exc:
            detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
            return Response(detail, status=status.HTTP_400_BAD_REQUEST)

        return Response(SizeExchangeRequestSerializer(updated).data, status=status.HTTP_200_OK)
