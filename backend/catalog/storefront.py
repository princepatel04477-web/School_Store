"""
Student catalogue — the ordering read path.

GET /api/catalog/students/<student_id>/products/[?category=<slug>]
    Card-sized list of products valid for that student's school, class and
    gender, plus shared products (shoes, stationery, ID cards).
    - Catalogue body comes from Redis keyed by (school, category), short TTL,
      explicitly invalidated on any product/variant/price change.
    - Stock is fetched fresh on every request and returned as an
      IN_STOCK / LOW_STOCK / OUT_OF_STOCK flag — never cached.
    - Cards carry only: id, name, category, price, one thumbnail URL and the
      available sizes.

GET /api/catalog/students/<student_id>/products/<product_id>/
    Full detail for the product page: description, all image URLs (CDN),
    customisation schema, and fresh per-size stock flags.
"""

from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from inventory.services import best_flag, stock_flags
from schools.models import Student

from .catalogue import (
    entry_matches_student,
    filter_for_student,
    get_school_catalogue,
    parse_class_number,
)
from .images import is_remote_image_url, product_thumbnail
from .models import Product


def _get_student_for(user, student_id) -> Student:
    """Resolve the student and enforce who may shop for them (one query)."""
    student = (
        Student.objects.filter(pk=student_id, active=True)
        .only(
            "id",
            "name",
            "class_name",
            "section",
            "gender",
            "school_id",
            "city_id",
            "parent_id",
        )
        .first()
    )
    if student is None:
        raise NotFound("Student not found.")

    role = getattr(user, "role", None)
    if role == "BOSS" or getattr(user, "is_superuser", False):
        return student
    if role == "ADMIN" and user.city_id and user.city_id == student.city_id:
        return student
    if role in ("SCHOOL_ADMIN", "TEACHER") and user.school_id == student.school_id:
        return student
    if role == "PARENT" and student.parent_id == user.id:
        return student
    raise PermissionDenied("You cannot shop for this student.")


def _card(entry: dict, flags: dict) -> dict:
    """Shape one cached entry into the card payload with fresh stock flags."""
    sizes = [
        {
            "variant_id": size["variant_id"],
            "size": size["size"],
            "stock_status": flags.get(size["variant_id"], "OUT_OF_STOCK"),
        }
        for size in entry["sizes"]
    ]
    return {
        "id": entry["id"],
        "name": entry["name"],
        "category": entry["category"],
        "category_slug": entry["category_slug"],
        "price": entry["price"],
        "thumbnail": entry["thumbnail"],
        "customisation_schema": entry.get("customisation_schema") or [],
        "sizes": sizes,
        "stock_status": best_flag(size["stock_status"] for size in sizes)
        if sizes
        else "OUT_OF_STOCK",
    }


class StudentCatalogueView(APIView):
    """Catalogue list for one student (cached body + fresh stock flags)."""

    def get(self, request, student_id):
        student = _get_student_for(request.user, student_id)
        category = request.query_params.get("category")

        # Cached by (school, category); personalised per student in-process.
        entries = get_school_catalogue(student.school_id, category)
        entries = filter_for_student(entries, student)

        # Stock flags: always fresh, one indexed query, never cached.
        variant_ids = [
            size["variant_id"] for entry in entries for size in entry["sizes"]
        ]
        flags = stock_flags(student.city_id, variant_ids)

        return Response(
            {
                "student": {
                    "id": str(student.id),
                    "name": student.name,
                    "class": student.class_name,
                    "section": student.section,
                    "gender": student.gender,
                    "school": str(student.school_id),
                },
                "count": len(entries),
                "products": [_card(entry, flags) for entry in entries],
            }
        )


class StudentProductDetailView(APIView):
    """Product page: full description + all images, fetched from the DB."""

    def get(self, request, student_id, product_id):
        student = _get_student_for(request.user, student_id)
        product = (
            Product.objects.filter(pk=product_id, active=True)
            .select_related("category", "school")
            .prefetch_related("variants")
            .first()
        )
        if product is None:
            raise NotFound("Product not found.")
        # Scope: must be shared or belong to this student's school…
        if product.school_id and product.school_id != student.school_id:
            raise NotFound("Product not available for this student.")
        # …and match the student's class range and gender.
        targeting = {
            "gender": product.gender,
            "class_from": product.class_from,
            "class_to": product.class_to,
        }
        if not entry_matches_student(
            targeting, parse_class_number(student.class_name), student.gender
        ):
            raise NotFound("Product not available for this student.")

        variants = [v for v in product.variants.all() if v.active]
        flags = stock_flags(student.city_id, [str(v.id) for v in variants])
        sizes = [
            {
                "variant_id": str(variant.id),
                "size": variant.size,
                "sku": variant.sku,
                "stock_status": flags.get(str(variant.id), "OUT_OF_STOCK"),
            }
            for variant in variants
        ]
        return Response(
            {
                "id": str(product.id),
                "name": product.name,
                "description": product.description,
                "category": product.category.name,
                "category_slug": product.category.slug,
                "school": str(product.school_id) if product.school_id else None,
                "price": str(product.selling_price),
                "thumbnail": product_thumbnail(product.images),
                # Full-size CDN URLs; Django never serves the bytes.
                "images": [
                    url for url in (product.images or []) if is_remote_image_url(url)
                ],
                "customisation_schema": product.customisation_schema,
                "sizes": sizes,
                "stock_status": best_flag(s["stock_status"] for s in sizes)
                if sizes
                else "OUT_OF_STOCK",
            }
        )
