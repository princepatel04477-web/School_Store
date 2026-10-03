"""Public, read-only catalogue for anonymous shoppers."""

import json
from uuid import UUID

from django.core.cache import cache
from django.db.models import Prefetch, Q
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from common.cache_utils import (
    CATALOG_CACHE_VERSION_KEY,
    SCHOOL_LIST_CACHE_VERSION_KEY,
    versioned_cache_key,
)
from common.pagination import BoundedCursorPagination
from inventory.models import StockBalance
from schools.models import School

from .models import Product, ProductVariant


class PublicCatalogThrottle(AnonRateThrottle):
    scope = "public_catalog"


class PublicProductPagination(BoundedCursorPagination):
    ordering = "id"


class PublicProductList(APIView):
    """
    GET /api/public/products/[?school=<uuid>][&category=<name>]

    Returns only shopper-facing data and stock for the requested school city.
    Stock is not aggregated across cities because each city has its own balance.
    """

    authentication_classes = []  # ignore stale/invalid tokens; this is anonymous
    permission_classes = [AllowAny]
    throttle_classes = [PublicCatalogThrottle]
    pagination_class = PublicProductPagination

    def get(self, request):
        school_id = request.query_params.get("school")
        cache_key = None
        if not school_id:
            try:
                cache_key = versioned_cache_key(
                    "catalog:public",
                    request.build_absolute_uri(),
                    CATALOG_CACHE_VERSION_KEY,
                    SCHOOL_LIST_CACHE_VERSION_KEY,
                )
                cached_data = cache.get(cache_key)
            except Exception:
                # Keep the catalogue available if Redis is temporarily unavailable.
                cache_key = None
                cached_data = None
            if cached_data is not None:
                return Response(cached_data)

        city_id = None
        if school_id:
            try:
                school_uuid = UUID(school_id)
            except (TypeError, ValueError, AttributeError) as exc:
                raise ValidationError({"school": "Provide a valid school UUID."}) from exc
            school = School.objects.filter(pk=school_uuid, active=True).only("id", "city_id").first()
            if school is None:
                raise NotFound("School not found.")
            city_id = school.city_id

        balance_qs = (
            StockBalance.objects.filter(city_id=city_id)
            if city_id
            else StockBalance.objects.none()
        )
        variants = Prefetch(
            "variants",
            queryset=(
                ProductVariant.objects.filter(active=True)
                .order_by("size", "id")
                .prefetch_related(
                    Prefetch(
                        "stock_balances",
                        queryset=balance_qs,
                        to_attr="selected_city_balances",
                    )
                )
            ),
        )
        qs = (
            Product.objects.filter(active=True)
            .select_related("category", "school")
            .prefetch_related(variants)
            .order_by("id")
        )
        if school_id:
            qs = qs.filter(Q(school_id=school_uuid) | Q(school__isnull=True))
        category = request.query_params.get("category")
        if category:
            qs = qs.filter(category__name__iexact=category)

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request, view=self)
        data = [
            {
                "id": str(product.id),
                "name": product.name,
                "description": product.description[:300],
                "category": product.category.name,
                "school": product.school.name if product.school else None,
                "price": float(product.selling_price),
                "variants": [
                    {
                        "id": str(variant.id),
                        "size": variant.size,
                        "stock": (
                            variant.selected_city_balances[0].stock_quantity
                            if variant.selected_city_balances
                            else None
                        ),
                    }
                    for variant in product.variants.all()
                ],
            }
            for product in page
        ]
        response = paginator.get_paginated_response(data)
        if cache_key:
            try:
                cache.set(
                    cache_key,
                    json.loads(JSONRenderer().render(response.data)),
                    timeout=300,
                )
            except Exception:
                pass
        return response
