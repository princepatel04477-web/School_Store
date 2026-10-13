"""Stores a shoulder measurement. The camera image never arrives here."""

from decimal import Decimal, InvalidOperation

from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import FitReading

_ALLOWED = {"shoulder_cm", "confidence"}


class FitReadingCreateView(APIView):
    """
    POST /api/catalog/fit-reading/
    Body: { "shoulder_cm": 32.5, "confidence": 0.82 }
    """

    permission_classes = [AllowAny]

    def post(self, request):
        if not isinstance(request.data, dict):
            raise ValidationError({"detail": "Send only shoulder_cm and confidence."})
        extra = set(request.data.keys()) - _ALLOWED
        if extra or _ALLOWED - set(request.data.keys()):
            raise ValidationError({"detail": "Send only shoulder_cm and confidence."})

        try:
            shoulder = Decimal(str(request.data["shoulder_cm"]))
            confidence = Decimal(str(request.data["confidence"]))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ValidationError({"detail": "shoulder_cm and confidence must be numbers."}) from exc

        if shoulder <= 0 or shoulder > 80:
            raise ValidationError({"shoulder_cm": "Shoulder width must be between 0 and 80 cm."})
        if confidence < 0 or confidence > 1:
            raise ValidationError({"confidence": "Confidence must be between 0 and 1."})

        user = request.user if getattr(request.user, "is_authenticated", False) else None
        reading = FitReading.objects.create(
            user=user,
            shoulder_cm=shoulder.quantize(Decimal("0.1")),
            confidence=confidence.quantize(Decimal("0.001")),
        )
        return Response(
            {
                "id": str(reading.id),
                "shoulder_cm": float(reading.shoulder_cm),
                "confidence": float(reading.confidence),
            },
            status=201,
        )
