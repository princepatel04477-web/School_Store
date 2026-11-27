from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404
from django.utils import timezone

from .models import Order, OrderItem


class OrderItemFitFeedbackView(APIView):
    """
    POST /api/orders/<order_id>/items/<item_id>/fit-feedback/
    Parent or staff submits fit feedback: 'TOO_TIGHT', 'FITS_WELL', 'TOO_LOOSE'.
    Enforces one answer per order line (Prompt 9).
    """

    def post(self, request, order_id, item_id):
        user = request.user
        if not user or not user.is_authenticated:
            return Response(
                {"detail": "Authentication credentials were not provided."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        order = get_object_or_404(Order, id=order_id)
        if (
            not user.is_staff
            and getattr(user, "role", "") not in ("BOSS", "ADMIN")
            and order.parent_id != user.id
            and order.placed_by_id != user.id
        ):
            raise PermissionDenied("You do not have access to this order.")

        item = get_object_or_404(OrderItem, id=item_id, order=order)

        if item.fit_feedback:
            return Response(
                {"detail": "Feedback has already been submitted for this item."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_feedback = str(request.data.get("fit_feedback", "")).strip().upper()
        if raw_feedback not in (
            OrderItem.FitFeedback.TOO_TIGHT,
            OrderItem.FitFeedback.FITS_WELL,
            OrderItem.FitFeedback.TOO_LOOSE,
        ):
            raise ValidationError(
                {
                    "fit_feedback": (
                        f"Must be one of: {OrderItem.FitFeedback.TOO_TIGHT}, "
                        f"{OrderItem.FitFeedback.FITS_WELL}, {OrderItem.FitFeedback.TOO_LOOSE}."
                    )
                }
            )

        item.fit_feedback = raw_feedback
        item.fit_feedback_answered_at = timezone.now()
        item.save(update_fields=["fit_feedback", "fit_feedback_answered_at"])

        return Response(
            {
                "status": "ok",
                "fit_feedback": item.fit_feedback,
                "fit_feedback_answered_at": item.fit_feedback_answered_at.isoformat(),
            },
            status=status.HTTP_200_OK,
        )
