"""
Stock services — the ONLY sanctioned write path for stock.

Rules enforced here:
- Every stock change is recorded as a StockMovement (stock-in, sale, return,
  manual adjustment). ``stock_quantity`` is never edited directly.
- Quantities change via an atomic conditional ``UPDATE ... SET stock_quantity
  = stock_quantity + delta`` (``F()`` expression). There is no read-modify-
  write in Python, so concurrent movements can never lose updates, and a
  decrement simply matches zero rows when stock is insufficient.
- Availability for the catalogue is exposed as an in-stock / low / out flag,
  always fetched fresh (it is never part of any cached catalogue payload).
"""

from django.db import transaction
from django.db.models import F
from django.db.models.functions import Now

from .models import StockBalance, StockMovement

IN_STOCK = "IN_STOCK"
LOW_STOCK = "LOW_STOCK"
OUT_OF_STOCK = "OUT_OF_STOCK"

_FLAG_RANK = {IN_STOCK: 2, LOW_STOCK: 1, OUT_OF_STOCK: 0}


class InsufficientStockError(Exception):
    """The movement would drive a city/variant balance below zero."""


def stock_flag(quantity, threshold) -> str:
    if quantity is None or quantity <= 0:
        return OUT_OF_STOCK
    if quantity <= (threshold or 0):
        return LOW_STOCK
    return IN_STOCK


def stock_flags(city_id, variant_ids) -> dict:
    """Fresh per-variant availability flags for one city — one indexed query.

    Variants with no balance row for the city count as OUT_OF_STOCK.
    Raw quantities are intentionally not returned to the catalogue.
    """
    flags = {str(variant_id): OUT_OF_STOCK for variant_id in variant_ids}
    if not city_id or not variant_ids:
        return flags
    rows = StockBalance.objects.filter(
        city_id=city_id, variant_id__in=list(variant_ids)
    ).values_list("variant_id", "stock_quantity", "low_stock_threshold")
    for variant_id, quantity, threshold in rows:
        flags[str(variant_id)] = stock_flag(quantity, threshold)
    return flags


def best_flag(flags) -> str:
    """Product-level availability = the best of its variants' flags."""
    best = OUT_OF_STOCK
    for flag in flags:
        if _FLAG_RANK[flag] > _FLAG_RANK[best]:
            best = flag
    return best


def apply_stock_movement(
    *,
    variant,
    city_id,
    quantity_change: int,
    reason: str,
    reference_order=None,
    created_by=None,
    school_id=None,
) -> StockMovement:
    """Apply one audited stock change atomically.

    Increment: ensures the (city, variant) balance row exists, then applies
    ``UPDATE ... SET stock_quantity = stock_quantity + delta``.
    Decrement: conditional ``UPDATE ... WHERE stock_quantity >= -delta``; if
    no row matches, the balance would go negative (or does not exist) and
    InsufficientStockError is raised — nothing is written.
    """
    if quantity_change == 0:
        raise ValueError("A stock movement must change the quantity.")

    with transaction.atomic():
        balance_qs = StockBalance.objects.filter(
            city_id=city_id, variant_id=variant.pk
        )
        if quantity_change > 0:
            StockBalance.objects.get_or_create(
                city_id=city_id,
                variant_id=variant.pk,
                defaults={"stock_quantity": 0},
            )
        else:
            balance_qs = balance_qs.filter(stock_quantity__gte=-quantity_change)

        updated = balance_qs.update(
            stock_quantity=F("stock_quantity") + quantity_change,
            updated_at=Now(),
        )
        if not updated:
            raise InsufficientStockError(
                f"Stock for variant {variant.pk} in city {city_id} cannot go "
                f"below zero (requested change {quantity_change})."
            )

        return StockMovement.objects.create(
            variant_id=variant.pk,
            city_id=city_id,
            school_id=school_id
            or variant.school_id
            or (reference_order.school_id if reference_order else None),
            quantity_change=quantity_change,
            reason=reason,
            reference_order=reference_order,
            created_by=created_by,
        )
