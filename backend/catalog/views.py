from rest_framework import viewsets

from common.cache_mixin import VersionedListCacheMixin
from common.cache_utils import CATALOG_CACHE_VERSION_KEY
from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin

from .models import Category, Product, ProductVariant
from .serializers import (
    CategorySerializer,
    ProductSerializer,
    ProductVariantSerializer,
)


class ProductPagination(BoundedCursorPagination):
    ordering = "id"


class VariantPagination(BoundedCursorPagination):
    ordering = "sku"


class CategoryViewSet(VersionedListCacheMixin, viewsets.ModelViewSet):
    cache_version_key = CATALOG_CACHE_VERSION_KEY
    cache_namespace = "catalog:categories"
    queryset = Category.objects.order_by("display_order", "name")
    serializer_class = CategorySerializer
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS",)


class ProductViewSet(
    VersionedListCacheMixin,
    ScopedQuerysetMixin,
    viewsets.ModelViewSet,
):
    cache_version_key = CATALOG_CACHE_VERSION_KEY
    cache_namespace = "catalog:products"
    queryset = (
        Product.objects.select_related("category", "school")
        .prefetch_related("variants")
        .order_by("id")
    )
    serializer_class = ProductSerializer
    pagination_class = ProductPagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS", "ADMIN")

    scope_city_field = "city_id"
    scope_school_field = "school_id"
    scope_parent_field = None
    include_null_scope_for_catalog = True

    def get_queryset(self):
        qs = super().get_queryset()
        category_id = self.request.query_params.get("category")
        school_id = self.request.query_params.get("school")
        if category_id:
            qs = qs.filter(category_id=category_id)
        if school_id:
            qs = qs.filter(school_id=school_id)
        return qs

    def perform_update(self, serializer):
        old_price = serializer.instance.selling_price
        old_cost = serializer.instance.cost_price
        prod = serializer.save()
        if prod.selling_price != old_price or prod.cost_price != old_cost:
            from common.audit import log_audit_event
            from common.models import AuditLog
            log_audit_event(
                action=AuditLog.Action.PRICE_CHANGED,
                target_type="Product",
                target_id=prod.pk,
                actor=self.request.user,
                details={
                    "name": prod.name,
                    "old_price": str(old_price),
                    "new_price": str(prod.selling_price),
                    "old_cost_price": str(old_cost),
                    "new_cost_price": str(prod.cost_price),
                },
                request=self.request,
            )



class ProductVariantViewSet(
    VersionedListCacheMixin,
    ScopedQuerysetMixin,
    viewsets.ModelViewSet,
):
    cache_version_key = CATALOG_CACHE_VERSION_KEY
    cache_namespace = "catalog:variants"
    queryset = ProductVariant.objects.select_related(
        "product", "product__category", "school"
    ).order_by("sku")
    serializer_class = ProductVariantSerializer
    pagination_class = VariantPagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS", "ADMIN")

    scope_city_field = "city_id"
    scope_school_field = "school_id"
    scope_parent_field = None
    include_null_scope_for_catalog = False

    def perform_update(self, serializer):
        old_price = serializer.instance.price
        old_cost = serializer.instance.cost_price
        variant = serializer.save()
        if variant.price != old_price or variant.cost_price != old_cost:
            from common.audit import log_audit_event
            from common.models import AuditLog
            log_audit_event(
                action=AuditLog.Action.PRICE_CHANGED,
                target_type="ProductVariant",
                target_id=variant.pk,
                actor=self.request.user,
                details={
                    "sku": variant.sku,
                    "old_price": str(old_price),
                    "new_price": str(variant.price),
                    "old_cost_price": str(old_cost),
                    "new_cost_price": str(variant.cost_price),
                },
                request=self.request,
            )


from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework.exceptions import ValidationError
from .catalogue import validate_product_match
from schools.models import Student


class CartValidateView(APIView):
    """
    POST /api/cart/validate/ and /api/cart/add/
    Re-check on the server that the product/variant matches the selected school, class, and gender.
    Reject mismatches with 400.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        variant_id = request.data.get("variant") or request.data.get("variant_id")
        product_id = request.data.get("product") or request.data.get("product_id")
        school_id = request.data.get("school") or request.data.get("school_id")
        class_param = (
            request.data.get("class")
            or request.data.get("grade")
            or request.data.get("class_name")
        )
        gender_param = request.data.get("gender")
        student_id = request.data.get("student") or request.data.get("student_id")

        if student_id:
            try:
                student = (
                    Student.objects.select_related("school", "grade")
                    .filter(pk=student_id)
                    .first()
                )
                if student:
                    school_id = school_id or student.school_id
                    class_param = class_param or student.grade or student.class_name
                    gender_param = gender_param or student.gender
            except Exception:
                pass

        if not variant_id and not product_id:
            raise ValidationError({"item": "Variant ID or Product ID is required."})
        if not school_id:
            raise ValidationError({"school": "School is required."})
        if not class_param:
            raise ValidationError({"class": "Class is required."})
        if not gender_param:
            raise ValidationError({"gender": "Gender is required ('boy' or 'girl')."})

        product = None
        if variant_id:
            try:
                variant = (
                    ProductVariant.objects.select_related("product")
                    .prefetch_related("product__grades")
                    .filter(pk=variant_id)
                    .first()
                )
                if not variant:
                    raise ValidationError({"variant": "Variant not found."})
                product = variant.product
            except (ValueError, TypeError):
                raise ValidationError({"variant": "Invalid variant UUID."})
        elif product_id:
            try:
                product = (
                    Product.objects.prefetch_related("grades")
                    .filter(pk=product_id)
                    .first()
                )
                if not product:
                    raise ValidationError({"product": "Product not found."})
            except (ValueError, TypeError):
                raise ValidationError({"product": "Invalid product UUID."})

        validate_product_match(
            product=product,
            school_id=school_id,
            class_name_or_grade=class_param,
            gender=gender_param,
        )

        return Response(
            {
                "valid": True,
                "message": "Product matches selected school, class, and gender.",
                "product_id": str(product.id),
            }
        )


