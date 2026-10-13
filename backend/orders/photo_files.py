"""Shared rules for child-photo files stored on an order item."""

from datetime import timedelta

from django.conf import settings
from django.db.models import OuterRef, Prefetch, Subquery
from django.utils import timezone

from .models import Order, OrderItem, OrderStatusEvent, PhotoConsent
from .storage import delete_object

_DERIVATIVE_SUFFIXES = ("_print", "_thumb", "_status", "_error", "_width", "_height", "_retention")


def image_field_names(data: dict) -> list[str]:
    """Field keys whose value is an uploaded photo, plus leftovers after a purge."""
    names: list[str] = []
    for key, value in data.items():
        if key.endswith(_DERIVATIVE_SUFFIXES):
            continue
        if isinstance(value, str) and value.startswith("customisations/"):
            names.append(key)
    for key, value in data.items():
        if not key.endswith("_thumb"):
            continue
        field = key[: -len("_thumb")]
        if field in names:
            continue
        if isinstance(value, str) and value.startswith("customisations/"):
            names.append(field)
    return names


def purpose_for_item(item: OrderItem) -> str | None:
    product = item.variant.product
    schema = product.customisation_schema or []
    if isinstance(schema, dict):
        fields = schema.get("fields") or []
    elif isinstance(schema, list):
        fields = schema
    else:
        fields = []
    keys = {field.get("key") for field in fields if isinstance(field, dict)}
    category = getattr(product, "category", None)
    slug = (getattr(category, "slug", "") or "").lower()
    label = " ".join(
        part.lower()
        for part in (
            getattr(product, "name", "") or "",
            getattr(category, "name", "") or "",
        )
        if part
    )
    if "student_photo" in keys or "id-card" in slug or "id card" in label:
        return PhotoConsent.Purpose.ID_CARD
    if "cover_photo" in keys or slug == "stationery" or "notebook" in label:
        return PhotoConsent.Purpose.NOTEBOOK
    return None


def live_keep_for_next_year(student_id, purpose: str | None) -> bool:
    if purpose != PhotoConsent.Purpose.ID_CARD:
        return False
    return PhotoConsent.objects.filter(
        student_id=student_id,
        purpose=purpose,
        withdrawn_at__isnull=True,
        keep_for_next_year=True,
    ).exists()


def purge_item_photos(item: OrderItem, *, keep_thumb: bool) -> int:
    """
    Delete original and print files. The thumbnail stays only when keep_thumb is set.
    Returns how many stored keys were removed from the item.
    """
    data = dict(item.customisation_data or {})
    removed = 0
    changed = False
    for field in image_field_names(data):
        drop_suffixes = ["", "_print"]
        if not keep_thumb:
            drop_suffixes.append("_thumb")
        for suffix in drop_suffixes:
            storage_key_name = field if suffix == "" else f"{field}{suffix}"
            storage_key = data.get(storage_key_name)
            if not isinstance(storage_key, str) or not storage_key.startswith("customisations/"):
                continue
            delete_object(storage_key)
            data.pop(storage_key_name, None)
            removed += 1
            changed = True
        if data.get(f"{field}_retention") != "PURGED":
            data[f"{field}_retention"] = "PURGED"
            changed = True
    if changed:
        item.customisation_data = data
        item.save(update_fields=["customisation_data"])
    return removed


def delete_student_photos(student_id) -> int:
    """Parent withdrawal: remove every photo file for this child, including thumbnails."""
    items = OrderItem.objects.filter(order__student_id=student_id).select_related(
        "variant__product__category"
    )
    removed = 0
    for item in items:
        removed += purge_item_photos(item, keep_thumb=False)
    return removed


def purge_delivered_child_photos_now() -> int:
    """Delete photo files on orders delivered more than PHOTO_RETENTION_DAYS ago."""
    days = int(getattr(settings, "PHOTO_RETENTION_DAYS", 30))
    cutoff = timezone.now() - timedelta(days=days)
    latest_delivery = OrderStatusEvent.objects.filter(
        order_id=OuterRef("pk"),
        status=Order.Status.DELIVERED,
    ).order_by("-timestamp")
    orders = (
        Order.objects.filter(status=Order.Status.DELIVERED)
        .annotate(delivered_at=Subquery(latest_delivery.values("timestamp")[:1]))
        .filter(delivered_at__isnull=False, delivered_at__lte=cutoff)
        .prefetch_related(
            Prefetch(
                "items",
                queryset=OrderItem.objects.select_related("variant__product__category"),
            )
        )
    )
    removed = 0
    keep_cache: dict[tuple, bool] = {}
    for order in orders:
        for item in order.items.all():
            purpose = purpose_for_item(item)
            cache_key = (order.student_id, purpose)
            if cache_key not in keep_cache:
                keep_cache[cache_key] = live_keep_for_next_year(order.student_id, purpose)
            removed += purge_item_photos(item, keep_thumb=keep_cache[cache_key])
    return removed
