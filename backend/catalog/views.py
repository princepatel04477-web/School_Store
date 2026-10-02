from rest_framework import viewsets
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin
from .models import Category, Product, ProductVariant, StockMovement
from .serializers import (
    CategorySerializer,
    ProductSerializer,
    ProductVariantSerializer,
    StockMovementSerializer,
)


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.order_by("display_order", "name")
    serializer_class = CategorySerializer
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS",)


class ProductViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = (
        Product.objects.select_related("category", "school")
        .prefetch_related("variants")
        .order_by("name")
    )
    serializer_class = ProductSerializer
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


class ProductVariantViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = ProductVariant.objects.select_related(
        "product", "product__category", "school"
    ).order_by("sku")
    serializer_class = ProductVariantSerializer
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS", "ADMIN")

    scope_city_field = "city_id"
    scope_school_field = "school_id"
    scope_parent_field = None
    include_null_scope_for_catalog = False


class StockMovementViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = StockMovement.objects.select_related("variant").order_by("-created_at")
    serializer_class = StockMovementSerializer
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN")
    write_roles = ("BOSS", "ADMIN")

    scope_city_field = "city_id"
    scope_school_field = "school_id"
    scope_parent_field = None
