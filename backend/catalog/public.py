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

        qs = School.objects.filter(active=True).select_related("city").order_by("name")
        if search:
            qs = qs.filter(name__icontains=search)

        data = [
            {
                "id": str(s.id),
                "name": s.name,
                "code": s.code,
                "city": str(s.city_id) if s.city_id else None,
                "city_name": s.city.name if s.city_id else "",
                "home_delivery": s.home_delivery_enabled,
                "school_pickup": s.school_pickup_enabled,
            }
            for s in qs.only(
                "id", "name", "code", "home_delivery_enabled", "school_pickup_enabled", "city__id", "city__name"
            )
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
        grade_id = request.query_params.get("class") or request.query_params.get("grade")
        gender = request.query_params.get("gender")

        if not school_id and not grade_id and not gender:
            raise ValidationError({
                "detail": "School, city, and grade parameters are all required to view products."
            })

        # 1. School is required and must be valid
        if not school_id:
            raise ValidationError({"school": "School parameter is required to view products."})
        try:
            school_uuid = UUID(str(school_id))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValidationError({"school": "Provide a valid school UUID."}) from exc

        school = School.objects.filter(pk=school_uuid, active=True).only("id", "city_id").first()
        if school is None:
            raise ValidationError({"school": "School not found or inactive."})

        # 2. Class is required and must be valid
        if not grade_id:
            raise ValidationError({"class": "Class parameter is required to view products."})

        grade = None
        try:
            grade_uuid = UUID(str(grade_id))
            grade = Grade.objects.filter(pk=grade_uuid).first()
        except (TypeError, ValueError, AttributeError):
            pass

        if grade is None:
            from common.constants import normalize_class_name
            normalized = normalize_class_name(str(grade_id))
            if normalized:
                grade = Grade.objects.filter(
                    Q(name__iexact=normalized) | Q(name__iexact=str(grade_id).strip())
                ).first()

        if grade is None:
            raise ValidationError({"class": f"Invalid class '{grade_id}'. Must be a valid school class."})

        # 3. Gender is required and must be boy or girl
        if not gender:
            raise ValidationError({"gender": "Gender parameter is required ('boy' or 'girl')."})

        gender_val = str(gender).strip().lower()
        if gender_val in ("boy", "male", "m"):
            selected_gender = Product.Gender.BOY
        elif gender_val in ("girl", "female", "f"):
            selected_gender = Product.Gender.GIRL
        else:
            raise ValidationError({"gender": f"Invalid gender '{gender}'. Must be 'boy' or 'girl'."})

        # 4. City (validated if provided, otherwise defaults to school's city)
        city_uuid = None
        if city_id:
            try:
                city_uuid = UUID(str(city_id))
            except (TypeError, ValueError, AttributeError) as exc:
                raise ValidationError({"city": "Provide a valid city UUID."}) from exc

            has_branch = SchoolBranch.objects.filter(school_id=school_uuid, city_id=city_uuid, active=True).exists()
            if not has_branch and school.city_id != city_uuid:
                raise ValidationError({"city": "The selected school does not operate in this city."})
        else:
            city_uuid = school.city_id

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

        balance_qs = StockBalance.objects.filter(city_id=city_uuid) if city_uuid else StockBalance.objects.none()
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

        category = request.query_params.get("category")

        # Class matching:
        # Match products explicitly assigned to this grade via M2M `grades`,
        # or products without explicit grades where class falls within class_from..class_to.
        import re
        class_num = int(re.search(r"\d+", grade.name).group()) if re.search(r"\d+", grade.name) else 0

        grade_filter = Q(grades=grade)
        range_filter = Q(grades__isnull=True) & (
            (Q(class_from__isnull=True) & Q(class_to__isnull=True))
            | (
                (Q(class_from__isnull=True) | Q(class_from__lte=class_num))
                & (Q(class_to__isnull=True) | Q(class_to__gte=class_num))
            )
        )

        qs = (
            Product.objects.filter(active=True)
            .filter(needs_review=False)
            .filter(gender__isnull=False)
            .filter(Q(school_id=school_uuid) | Q(school__isnull=True))
            .filter(grade_filter | range_filter)
            .filter(Q(gender=selected_gender) | Q(gender=Product.Gender.UNISEX))
            .distinct()
            .select_related("category", "school")
            .prefetch_related(variants)
            .order_by("id")
        )

        if category:
            qs = qs.filter(
                Q(category__name__iexact=category) | Q(category__slug__iexact=category)
            )

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
                "needs_review": product.needs_review,
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


class PublicSizeFitView(APIView):
    """
    POST /api/public/size-fit/
        {"products": [<uuid>, ...], "height_cm": 132, "weight_kg": 29, "class": "Class 4",
         "shoulder_cm": 31.5, "shoulder_confidence": 0.82}   # shoulder: optional, from the camera step

    Returns each product's size chart (cm, kg) and, when height and weight are
    given, the recommended size. Height and weight are not stored here; they
    are kept only on the order line when the parent places an order.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicCatalogThrottle]
    MAX_PRODUCTS = 60

    def post(self, request):
        from .models import SizeChartRow
        from .sizing import chart_rows_from_models, suggest, validate_fit

        raw_ids = request.data.get("products")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise ValidationError({"products": "Send a list of product ids."})
        if len(raw_ids) > self.MAX_PRODUCTS:
            raise ValidationError({"products": f"At most {self.MAX_PRODUCTS} products at a time."})
        try:
            product_ids = list(dict.fromkeys(str(UUID(str(pid))) for pid in raw_ids))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValidationError({"products": "Every product id must be a UUID."}) from exc

        height, weight = request.data.get("height_cm"), request.data.get("weight_kg")
        check = None
        if height not in (None, "") or weight not in (None, ""):
            check = validate_fit(
                height,
                weight,
                request.data.get("class"),
                shoulder_cm=request.data.get("shoulder_cm"),
                shoulder_confidence=request.data.get("shoulder_confidence"),
            )
            if not check.ok:
                raise ValidationError({field: [code] for field, code in check.errors.items()})

        charts: dict = {pid: [] for pid in product_ids}
        for row in (
            SizeChartRow.objects.select_related("variant")
            .filter(
                variant__product_id__in=product_ids,
                variant__active=True,
                variant__product__active=True,
            )
            .order_by("height_cm_min", "height_cm_max")
        ):
            charts[str(row.variant.product_id)].append(row)

        def number(value):
            return float(value) if value is not None else None

        products = {}
        for pid, rows in charts.items():
            recommendation = None
            if check is not None:
                result = suggest(chart_rows_from_models(rows), check)
                recommendation = {"status": result.status, "size": result.size, "alt_size": result.alt_size}
            products[pid] = {
                "chart": [
                    {
                        "variant_id": str(row.variant_id),
                        "size": row.variant.size,
                        "height_cm_min": number(row.height_cm_min),
                        "height_cm_max": number(row.height_cm_max),
                        "weight_kg_min": number(row.weight_kg_min),
                        "weight_kg_max": number(row.weight_kg_max),
                        "shoulder_cm_min": number(row.shoulder_cm_min),
                        "shoulder_cm_max": number(row.shoulder_cm_max),
                        "chest_cm_min": number(row.chest_cm_min),
                        "chest_cm_max": number(row.chest_cm_max),
                        "length_cm": number(row.length_cm),
                    }
                    for row in rows
                ],
                "recommendation": recommendation,
            }

        fit = None
        if check is not None:
            fit = {
                "height_cm": number(check.height_cm),
                "weight_kg": number(check.weight_kg),
                "shoulder_cm": number(check.shoulder_cm),
                "warnings": check.warnings,
            }
        return Response({"fit": fit, "products": products})
