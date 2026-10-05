"""
Shared catalogue read path — the hottest read in the system.

Design:
- The *catalogue list* for one (school, category) pair is cached in Redis
  under a versioned key with a short TTL. Explicit invalidation happens by
  bumping CATALOG_CACHE_VERSION_KEY whenever a Product, ProductVariant,
  Category, or price changes (see the model save()/delete() hooks).
- Stock is NEVER part of the cached payload. Availability is returned as an
  in-stock / low / out flag fetched fresh per request (inventory.services),
  so a stale catalogue entry can never show wrong availability.
- Cached entries carry only what the product card shows (id, name, price,
  one CDN thumbnail URL, available sizes) plus the targeting columns needed
  to filter per student in-process. Full description and all images are
  served by the product *detail* endpoint, straight from the database.
- The list is built with a fixed number of queries (1 products + 1 variants
  via prefetch_related) regardless of product count.
"""

import re

from django.conf import settings
from django.core.cache import cache
from django.db.models import Prefetch, Q

from common.cache_utils import CATALOG_CACHE_VERSION_KEY, get_cache_version

from .images import product_thumbnail
from .models import Product, ProductVariant

# Pre-primary classes sort below class 1 so "class 1-12" uniforms never
# match them, while unranged items always do.
_CLASS_ALIASES = {"nursery": 0, "pre-k": 0, "prek": 0, "kg": 0, "lkg": 0, "ukg": 0, "jr kg": 0, "sr kg": 0}
_CLASS_NUMBER_RE = re.compile(r"\d+")


def parse_class_number(class_name) -> int | None:
    """Best-effort numeric class for range matching ("5" -> 5, "KG" -> 0)."""
    if class_name is None:
        return None
    text = str(class_name).strip().lower()
    if text in _CLASS_ALIASES:
        return _CLASS_ALIASES[text]
    match = _CLASS_NUMBER_RE.search(text)
    return int(match.group()) if match else None


def catalogue_cache_key(school_id, category) -> str:
    """Redis key for one (school, category) catalogue list.

    The version prefix makes invalidation explicit: any product/variant/price
    change bumps CATALOG_CACHE_VERSION_KEY and every old key simply expires
    via its short TTL.
    """
    version = get_cache_version(CATALOG_CACHE_VERSION_KEY)
    school_part = str(school_id) if school_id else "shared"
    category_part = (str(category).strip().lower() or "all") if category else "all"
    return f"catalog:list:v{version}:school:{school_part}:category:{category_part}"


def build_school_catalogue(school_id, category=None) -> list[dict]:
    """Build card-sized catalogue entries in a FIXED number of queries (2)."""
    variant_prefetch = Prefetch(
        "variants",
        queryset=(
            ProductVariant.objects.filter(active=True)
            .only("id", "product_id", "size")
            .order_by("size", "id")
        ),
    )
    qs = (
        Product.objects.filter(active=True)
        .select_related("category")
        .prefetch_related(variant_prefetch)
        .only(
            "id",
            "name",
            "images",
            "selling_price",
            "gender",
            "class_from",
            "class_to",
            "customisation_schema",
            "school_id",
            "category_id",
            "category__name",
            "category__slug",
        )
        .order_by("name", "id")
    )
    if school_id:
        # School-specific items for THIS school, plus shared items.
        qs = qs.filter(Q(school_id=school_id) | Q(school__isnull=True))
    else:
        qs = qs.filter(school__isnull=True)
    if category:
        cat_str = str(category).strip()
        qs = qs.filter(
            Q(category__slug__iexact=cat_str)
            | Q(category__name__iexact=cat_str)
            | Q(category__slug__icontains=cat_str)
            | Q(category__name__icontains=cat_str)
        )

    return [
        {
            "id": str(product.id),
            "name": product.name,
            "category": product.category.name,
            "category_slug": product.category.slug,
            "price": str(product.selling_price),
            "thumbnail": product_thumbnail(product.images),
            "customisation_schema": product.customisation_schema,
            # Targeting metadata (filtered out of API responses; used to
            # narrow the shared school cache down to one student).
            "school": str(product.school_id) if product.school_id else None,
            "gender": product.gender,
            "class_from": product.class_from,
            "class_to": product.class_to,
            "sizes": [
                {"variant_id": str(variant.id), "size": variant.size}
                for variant in product.variants.all()
            ],
        }
        for product in qs
    ]


def get_school_catalogue(school_id, category=None) -> list[dict]:
    """Cached catalogue for (school, category): short TTL + explicit versioning."""
    key = catalogue_cache_key(school_id, category)
    try:
        cached = cache.get(key)
    except Exception:
        # Redis being down must never take the catalogue down with it.
        key = None
        cached = None
    if cached is not None:
        return cached

    entries = build_school_catalogue(school_id, category)
    if key:
        try:
            cache.set(key, entries, timeout=settings.CATALOG_CACHE_TTL)
        except Exception:
            pass
    return entries


def entry_matches_student(entry: dict, class_number, gender) -> bool:
    """Class-range and gender targeting for one cached catalogue entry."""
    if entry["gender"] not in (Product.Gender.BOTH, "BOTH", "UNISEX") and entry["gender"] != gender:
        return False
    class_from = entry.get("class_from")
    class_to = entry.get("class_to")
    if class_from is None and class_to is None:
        return True
    if class_number is None:
        # Unparseable class: only unranged items apply.
        return False
    if class_from is not None and class_number < class_from:
        return False
    if class_to is not None and class_number > class_to:
        return False
    return True


def filter_for_student(entries: list[dict], student) -> list[dict]:
    """Narrow a school's cached catalogue to one student's class and gender."""
    class_number = parse_class_number(student.class_name)
    return [
        entry
        for entry in entries
        if entry_matches_student(entry, class_number, student.gender)
    ]
