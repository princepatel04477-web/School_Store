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
