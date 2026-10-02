"""Public, read-only catalogue so visitors can browse without signing in."""

from django.db.models import Prefetch
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .models import Product, ProductVariant

MAX_PUBLIC_PRODUCTS = 100


class PublicCatalogThrottle(AnonRateThrottle):
    scope = "public_catalog"


class PublicProductList(APIView):
    """
    GET /api/public/products/[?school=<uuid>][&category=<name>]

    Only exposes what a shopper needs: name, category, price and per-size stock.
    No cost price, SKUs, thresholds or ids of internal scopes.
    """

    authentication_classes = []  # ignore stale/invalid tokens; this is anonymous
    permission_classes = [AllowAny]
    throttle_classes = [PublicCatalogThrottle]

    def get(self, request):
        variants = Prefetch(
            "variants",
            queryset=ProductVariant.objects.filter(active=True).order_by("size"),
        )
        qs = (
            Product.objects.filter(active=True)
            .select_related("category", "school")
            .prefetch_related(variants)
            .order_by("name")
        )
        school = request.query_params.get("school")
        if school:
            qs = qs.filter(school_id=school)
        category = request.query_params.get("category")
        if category:
            qs = qs.filter(category__name__iexact=category)

        data = [
            {
                "id": str(p.id),
                "name": p.name,
                "description": p.description,
                "category": p.category.name,
                "school": p.school.name if p.school else None,
                "price": float(p.selling_price),
                "variants": [
                    {"id": str(v.id), "size": v.size, "stock": max(v.stock_quantity, 0)}
                    for v in p.variants.all()
                ],
            }
            for p in qs[:MAX_PUBLIC_PRODUCTS]
        ]
        return Response(data)
