import io
import uuid
from pathlib import Path
from PIL import Image, ImageOps

from django.conf import settings
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from common.cache_mixin import VersionedListCacheMixin
from common.cache_utils import CATALOG_CACHE_VERSION_KEY, invalidate_catalog_cache
from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin

from .models import Category, Product, ProductVariant, ProductCityPrice
from .serializers import (
    CategorySerializer,
    ProductSerializer,
    ProductVariantSerializer,
    ProductCityPriceSerializer,
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
        # `grades` is serialised for every product: prefetch it or each row costs an extra query
        .prefetch_related("variants", "grades")
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
        gender = self.request.query_params.get("gender")
        active = self.request.query_params.get("active")
        search = self.request.query_params.get("search")
        class_param = self.request.query_params.get("class") or self.request.query_params.get("grade")

        if category_id:
            qs = qs.filter(category_id=category_id)
        if school_id:
            qs = qs.filter(school_id=school_id)
        if gender:
            qs = qs.filter(gender=gender)
        if active is not None:
            if str(active).lower() in ("true", "1"):
                qs = qs.filter(active=True)
            elif str(active).lower() in ("false", "0"):
                qs = qs.filter(active=False)
        if search:
            qs = qs.filter(name__icontains=search.strip())
        if class_param:
            import re
            m = re.search(r"\d+", str(class_param))
            if m:
                c_num = int(m.group())
                qs = qs.filter(
                    Q(grades__name__icontains=str(class_param))
                    | (Q(class_from__lte=c_num) & Q(class_to__gte=c_num))
                ).distinct()
        return qs

    @action(
        detail=True,
        methods=["post"],
        url_path="photo",
        parser_classes=[MultiPartParser, FormParser],
    )
    def photo(self, request, pk=None):
        product = self.get_object()
        user = request.user
        if not user or not user.is_authenticated:
            raise PermissionDenied("Authentication required.")
        if user.role not in ("BOSS", "ADMIN") and not getattr(user, "is_superuser", False):
            raise PermissionDenied("Only Boss and City Admins can upload product photos.")

        if user.role == "ADMIN" and user.city_id:
            if product.city_id and product.city_id != user.city_id:
                raise PermissionDenied("Admins can only manage products for their own city.")
            if product.school and product.school.city_id and product.school.city_id != user.city_id:
                raise PermissionDenied("Admins can only manage products for schools in their own city.")

        upload_file = (
            request.FILES.get("photo")
            or request.FILES.get("file")
            or request.FILES.get("image")
        )
        if not upload_file:
            raise ValidationError({"photo": "No image file provided in request."})

        max_bytes = 8 * 1024 * 1024  # 8 MB
        if upload_file.size > max_bytes:
            raise ValidationError({"photo": "File size exceeds the 8 MB limit."})

        raw_bytes = upload_file.read()
        if len(raw_bytes) > max_bytes:
            raise ValidationError({"photo": "File size exceeds the 8 MB limit."})

        # Validate with Pillow (Image.verify())
        try:
            stream = io.BytesIO(raw_bytes)
            with Image.open(stream) as img:
                img.verify()
                fmt = (img.format or "").upper()
                if fmt not in ("JPEG", "JPG", "PNG", "WEBP"):
                    raise ValidationError(
                        {"photo": "Only JPG, PNG, and WebP images are allowed."}
                    )
        except (ValidationError, Exception) as exc:
            if isinstance(exc, ValidationError):
                raise
            raise ValidationError({"photo": "Uploaded file is not a valid image."})

        # Process: square, 900x900, WebP at quality 84
        stream.seek(0)
        with Image.open(stream) as img:
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")

            fitted = ImageOps.fit(img, (900, 900), method=Image.Resampling.LANCZOS)

            dest_dir = Path(settings.MEDIA_ROOT) / "products" / str(product.id)
            dest_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid.uuid4()}.webp"
            dest_path = dest_dir / filename

            fitted.save(dest_path, format="WEBP", quality=84)

        photo_url = f"https://school-store.aqualite.workers.dev/media/products/{product.id}/{filename}"
        current_images = list(product.images or [])
        if photo_url in current_images:
            current_images.remove(photo_url)
        current_images.insert(0, photo_url)
        product.images = current_images
        product.save()
        invalidate_catalog_cache()

        serializer = self.get_serializer(product)
        return Response(serializer.data)

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

    def perform_destroy(self, instance):
        user = self.request.user
        if getattr(user, "role", None) == "ADMIN" and user.city_id:
            if instance.city_id and instance.city_id != user.city_id:
                raise PermissionDenied("Admins can only delete products for their own city.")
            if instance.school and instance.school.city_id and instance.school.city_id != user.city_id:
                raise PermissionDenied("Admins can only delete products for schools in their own city.")

        instance.active = False
        instance.save(update_fields=["active", "updated_at"])
        instance.variants.all().update(active=False)
        invalidate_catalog_cache()



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

    def get_queryset(self):
        qs = super().get_queryset()
        product_id = self.request.query_params.get("product")
        school_id = self.request.query_params.get("school")
        if product_id:
            qs = qs.filter(product_id=product_id)
        if school_id:
            qs = qs.filter(school_id=school_id)
        return qs

    def perform_update(self, serializer):
        old_price = getattr(serializer.instance, "price", None)
        old_cost = getattr(serializer.instance, "cost_price", None)
        variant = serializer.save()
        new_price = getattr(variant, "price", None)
        new_cost = getattr(variant, "cost_price", None)
        if (old_price is not None and new_price != old_price) or (old_cost is not None and new_cost != old_cost):
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
                    "new_price": str(new_price),
                    "old_cost_price": str(old_cost),
                    "new_cost_price": str(new_cost),
                },
                request=self.request,
            )

    def perform_destroy(self, instance):
        user = self.request.user
        if getattr(user, "role", None) == "ADMIN" and user.city_id:
            if instance.city_id and instance.city_id != user.city_id:
                raise PermissionDenied("Admins can only delete variants for their own city.")
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])
        invalidate_catalog_cache()


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


class ProductCityPriceViewSet(viewsets.ModelViewSet):
    queryset = ProductCityPrice.objects.select_related(
        "product", "city", "product__school"
    ).order_by("city__name", "product__name")
    serializer_class = ProductCityPriceSerializer
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN")
    write_roles = ("BOSS", "ADMIN")
    scope_city_field = "city_id"

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if getattr(user, "role", None) == "ADMIN" and user.city_id:
            qs = qs.filter(city_id=user.city_id)

        city = self.request.query_params.get("city")
        product = self.request.query_params.get("product")
        school = self.request.query_params.get("school")
        if city:
            qs = qs.filter(city_id=city)
        if product:
            qs = qs.filter(product_id=product)
        if school:
            qs = qs.filter(product__school_id=school)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        city = serializer.validated_data.get("city")
        if getattr(user, "role", None) == "ADMIN" and user.city_id:
            if city.id != user.city_id:
                raise PermissionDenied("Admins can only set prices for their own city.")

        # Upsert: if an override already exists for this (product, city), update it
        product = serializer.validated_data["product"]
        existing = ProductCityPrice.objects.filter(product=product, city=city).first()
        if existing:
            existing.selling_price = serializer.validated_data["selling_price"]
            if "cost_price" in serializer.validated_data:
                existing.cost_price = serializer.validated_data["cost_price"]
            if "active" in serializer.validated_data:
                existing.active = serializer.validated_data["active"]
            existing.save()
            serializer.instance = existing
        else:
            serializer.save()
        invalidate_catalog_cache()

    def perform_update(self, serializer):
        user = self.request.user
        if getattr(user, "role", None) == "ADMIN" and user.city_id:
            if serializer.instance.city_id != user.city_id:
                raise PermissionDenied("Admins can only update prices for their own city.")
        serializer.save()
        invalidate_catalog_cache()

    def perform_destroy(self, instance):
        user = self.request.user
        if getattr(user, "role", None) == "ADMIN" and user.city_id:
            if instance.city_id != user.city_id:
                raise PermissionDenied("Admins can only delete prices for their own city.")
        instance.delete()
        invalidate_catalog_cache()


