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

