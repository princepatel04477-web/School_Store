"""
Public API endpoint for shoulder estimation and size recommendation (Prompt 7).
"""

from __future__ import annotations

import logging
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .public import PublicCatalogThrottle
from .shoulder_estimate import recommend_size_from_estimate

logger = logging.getLogger(__name__)


class PublicFitEstimateView(APIView):
    """
    POST /api/public/fit/estimate/
    Public, unauthenticated, rate-limited endpoint.
    Accepts: {school_id, class_id, gender, height_cm, weight_kg, product_id}
    Returns: {shoulder_cm, shoulder_low_cm, shoulder_high_cm, confidence, recommended_size, alt_size, reason, model_version}

    Never logs child measurements, photos, or raw request body.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicCatalogThrottle]

    def post(self, request):
        # We do NOT log request.data to protect child privacy
        data = request.data or {}
        height = data.get("height_cm")
        weight = data.get("weight_kg")
        gender = data.get("gender")
        school_id = data.get("school_id")
        class_id = data.get("class_id")
        class_name = data.get("class_name") or data.get("class")
        product_id = data.get("product_id")

        if height in (None, ""):
            return Response(
                {"height_cm": ["REQUIRED"]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if weight in (None, ""):
            return Response(
                {"weight_kg": ["REQUIRED"]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        result = recommend_size_from_estimate(
            school_id=school_id,
            class_id=class_id,
            class_name=class_name,
            gender=gender,
            height_cm=height,
            weight_kg=weight,
            product_id=product_id,
        )

        logger.info(
            "Processed fit estimate request: confidence=%s, size=%s",
            result.get("confidence"),
            result.get("recommended_size"),
        )

        if "errors" in result:
            return Response(
                result["errors"],
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(result, status=status.HTTP_200_OK)
