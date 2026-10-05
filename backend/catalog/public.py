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
from inventory.services import stock_flag
from schools.models import School

from .images import product_thumbnail
from .models import Product, ProductVariant


from schools.models import City, Grade, School, SchoolBranch


class PublicCatalogThrottle(AnonRateThrottle):
    scope = "public_catalog"


class PublicSchoolListView(APIView):
    """
    Step 1: List of active schools sorted A to Z by name in the database query,
    with search query (?search=), cached in Redis and on client.
    """
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicCatalogThrottle]

    def get(self, request):
        search = (request.query_params.get("search") or "").strip()
        cache_key = None
        if not search:
            try:
                cache_key = versioned_cache_key(
                    "catalog:public:schools",
                    "all",
                    SCHOOL_LIST_CACHE_VERSION_KEY,
                )
                cached = cache.get(cache_key)
                if cached is not None:
                    return Response(cached)
            except Exception:
                pass

        qs = School.objects.filter(active=True).order_by("name")
        if search:
            qs = qs.filter(name__icontains=search)

        data = [
            {"id": str(s.id), "name": s.name, "code": s.code}
            for s in qs.only("id", "name", "code")
        ]

        if cache_key and not search:
            try:
                cache.set(cache_key, data, timeout=600)
            except Exception:
                pass

        return Response(data)


class PublicSchoolCitiesView(APIView):
    """
    Step 2: Show only the cities where the selected school has a branch (or main school city),
    sorted A to Z. Cached in Redis.
    """
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicCatalogThrottle]

    def get(self, request, school_id):
        try:
            school_uuid = UUID(str(school_id))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValidationError({"school": "Provide a valid school UUID."}) from exc

        school = School.objects.filter(pk=school_uuid, active=True).only("id", "city_id").first()
        if school is None:
            raise NotFound("School not found.")

        cache_key = None
        try:
            cache_key = versioned_cache_key(
                "catalog:public:school_cities",
                str(school_uuid),
                SCHOOL_LIST_CACHE_VERSION_KEY,
            )
            cached = cache.get(cache_key)
            if cached is not None:
                return Response(cached)
        except Exception:
            pass

        # Branch cities + main school city
        branch_city_ids = list(
            SchoolBranch.objects.filter(school_id=school_uuid, active=True)
            .values_list("city_id", flat=True)
        )
        if school.city_id:
            branch_city_ids.append(school.city_id)

        cities = (
            City.objects.filter(id__in=branch_city_ids, active=True)
            .order_by("name")
            .only("id", "name", "code")
        )
        data = [{"id": str(c.id), "name": c.name, "code": c.code} for c in cities]

        if cache_key:
            try:
                cache.set(cache_key, data, timeout=600)
            except Exception:
                pass

        return Response(data)


class PublicGradeListView(APIView):
    """
    Step 3: Show the 15 grades in fixed order Nursery, Junior KG, Senior KG, 1 to 12.
    Sorted by sort_order. Cached in Redis.
    """
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicCatalogThrottle]

    def get(self, request):
        cache_key = None
        try:
            cache_key = versioned_cache_key(
                "catalog:public:grades",
                "all",
                CATALOG_CACHE_VERSION_KEY,
            )
            cached = cache.get(cache_key)
            if cached is not None:
                return Response(cached)
        except Exception:
            pass

        grades = Grade.objects.all().order_by("sort_order").only("id", "name", "sort_order")
        data = [
            {"id": str(g.id), "name": g.name, "sort_order": g.sort_order}
            for g in grades
        ]

        if cache_key:
            try:
                cache.set(cache_key, data, timeout=3600)
            except Exception:
                pass

        return Response(data)


class PublicProductPagination(BoundedCursorPagination):
    ordering = "id"


class PublicProductList(APIView):
    """
    GET /api/public/products/?school=<uuid>&city=<uuid>&grade=<uuid>[&gender=<MALE|FEMALE>][&category=<name>]

    Returns only shopper-facing product cards matching school, city and grade.
    Enforces that school, city and grade are mandatory parameters.
    """

    authentication_classes = []  # ignore stale/invalid tokens; this is anonymous
    permission_classes = [AllowAny]
    throttle_classes = [PublicCatalogThrottle]
    pagination_class = PublicProductPagination

    def get(self, request):
        school_id = request.query_params.get("school")
        city_id = request.query_params.get("city")
        grade_id = request.query_params.get("grade")

        # Requirement 5: The catalogue endpoint requires school, city and grade.
        if not school_id or not city_id or not grade_id:
            raise ValidationError({
                "detail": "School, city, and grade parameters are all required to view products."
            })

        try:
            school_uuid = UUID(school_id)
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValidationError({"school": "Provide a valid school UUID."}) from exc

        try:
            city_uuid = UUID(city_id)
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValidationError({"city": "Provide a valid city UUID."}) from exc

        try:
            grade_uuid = UUID(grade_id)
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValidationError({"grade": "Provide a valid grade UUID."}) from exc

        school = School.objects.filter(pk=school_uuid, active=True).only("id", "city_id").first()
        if school is None:
            raise NotFound("School not found.")

        # Ensure the selected school actually operates in the chosen city
        # either directly or via SchoolBranch.
        has_branch = SchoolBranch.objects.filter(school_id=school_uuid, city_id=city_uuid, active=True).exists()
        if not has_branch and school.city_id != city_uuid:
            raise ValidationError({"city": "The selected school does not operate in this city."})

        grade = Grade.objects.filter(pk=grade_uuid).first()
        if grade is None:
            raise NotFound("Grade not found.")

        # Performance: Cache key per exact filter combination
        cache_key = None
        try:
            cache_key = versioned_cache_key(
                "catalog:public:filtered",
                request.build_absolute_uri(),
                CATALOG_CACHE_VERSION_KEY,
                SCHOOL_LIST_CACHE_VERSION_KEY,
            )
            cached_data = cache.get(cache_key)
        except Exception:
            cache_key = None
            cached_data = None

        if cached_data is not None:
            return Response(cached_data)

        balance_qs = StockBalance.objects.filter(city_id=city_uuid)
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

        # Requirement 9: Product query uses (school, category, gender, active) index
        # and grade link table (grade, product) index.
        category = request.query_params.get("category")
        gender = request.query_params.get("gender")

        qs = (
            Product.objects.filter(active=True)
            .filter(Q(school_id=school_uuid) | Q(school__isnull=True))
            .filter(grades=grade)
            .select_related("category", "school")
            .prefetch_related(variants)
            .order_by("id")
        )

        if category:
            qs = qs.filter(
                Q(category__name__iexact=category) | Q(category__slug__iexact=category)
            )

        # Requirement 4: Filter with Male and Female. Products marked "Both" appear under either.
        if gender:
            gender_val = gender.upper()
            if gender_val in (Product.Gender.MALE, Product.Gender.FEMALE):
                qs = qs.filter(Q(gender=gender_val) | Q(gender=Product.Gender.BOTH))

        # Requirement 3: Filter by product_type through the API (e.g. SOCKS, BELT, TIE)
        product_type = request.query_params.get("product_type")
        if product_type:
            pt_val = product_type.upper().strip()
            if pt_val in (Product.ProductType.SOCKS, Product.ProductType.BELT, Product.ProductType.TIE):
                qs = qs.filter(product_type=pt_val)

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request, view=self)

        # Requirement 9: Returns only card fields
        data = [
            {
                "id": str(product.id),
                "name": product.name,
                "description": product.description[:300],
                "category": product.category.name,
                "product_type": product.product_type,
                "gender": product.gender,
                "school": product.school.name if product.school else None,
                "price": float(product.selling_price),
                "thumbnail": product_thumbnail(product.images),
                "customisation_schema": product.customisation_schema,
                "variants": [
                    {
                        "id": str(variant.id),
                        "size": variant.size,
                        "stock_status": (
                            stock_flag(
                                variant.selected_city_balances[0].stock_quantity,
                                variant.selected_city_balances[0].low_stock_threshold,
                            )
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
