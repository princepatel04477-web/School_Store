"""
Size recommendation from a child's height, weight and class (plan A1).

Pure functions, no database access: callers pass chart rows in, so the same
logic serves the public size check and the order log, and is cheap to test.

How a size is chosen:
  1. Height first. The candidates are the sizes whose height range covers the
     child. A height in a gap between two sizes counts as "between" them.
  2. Weight refines it. A size whose weight range the child is heavier than
     is dropped; if that drops every candidate, the next size up is offered.
     Being lighter never pushes a size down (a smaller size would be short).
  3. When two sizes fit, both are returned with the bigger one first, so the
     parent can pick it for room to grow.
  4. Outside the chart, the nearest end of it is returned with a status that
     says so. A product with no chart returns NO_CHART.

Shoulder width (measured on the phone, plan A2/A3) only refines a suggestion
when FIT_USE_SHOULDER is on; see `suggest` and `refine_with_shoulder`.

Class is not used to pick a size (the chart rows have no class column). It
feeds the soft "please check this number" warnings in `validate_fit`, and the
class-label fallback on the phone when the parent skips height and weight.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import NamedTuple

from django.conf import settings

from common.constants import CLASS_SORT_ORDERS, normalize_class_name


def _load_limits() -> dict:
    path = Path(settings.BASE_DIR).parent / "shared" / "fit_limits.json"
    if not path.exists():
        path = Path(settings.BASE_DIR) / "shared" / "fit_limits.json"
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


_LIMITS = _load_limits()
HEIGHT_MIN = Decimal(str(_LIMITS["height_cm"]["min"]))
HEIGHT_MAX = Decimal(str(_LIMITS["height_cm"]["max"]))
WEIGHT_MIN = Decimal(str(_LIMITS["weight_kg"]["min"]))
WEIGHT_MAX = Decimal(str(_LIMITS["weight_kg"]["max"]))
SHOULDER_MIN = Decimal(str(_LIMITS["shoulder_cm"]["min"]))
SHOULDER_MAX = Decimal(str(_LIMITS["shoulder_cm"]["max"]))

# Rough middle height (cm) and weight (kg) by age for Indian children, boys
# and girls together (after the IAP 2015 charts). Only used for the soft
# "please check" warning, so the bands around them are deliberately wide.
_TYPICAL_HEIGHT = {3: 95, 4: 102, 5: 108, 6: 114, 7: 120, 8: 126, 9: 131, 10: 137,
                   11: 142, 12: 148, 13: 153, 14: 158, 15: 161, 16: 163, 17: 164}
_TYPICAL_WEIGHT = {3: 14, 4: 16, 5: 18, 6: 20, 7: 22, 8: 25, 9: 28, 10: 31,
                   11: 35, 12: 39, 13: 43, 14: 47, 15: 50, 16: 52, 17: 54}
HEIGHT_BAND_CM = 25
WEIGHT_BAND_LOW, WEIGHT_BAND_HIGH = Decimal("0.6"), Decimal("2.0")
BMI_MIN, BMI_MAX = Decimal("10"), Decimal("40")
ONE_DECIMAL = Decimal("0.1")


class Status:
    FIT = "FIT"
    BETWEEN = "BETWEEN"
    BELOW_CHART = "BELOW_CHART"
    ABOVE_CHART = "ABOVE_CHART"
    NO_CHART = "NO_CHART"


class FitWarning:
    HEIGHT_UNUSUAL_FOR_CLASS = "HEIGHT_UNUSUAL_FOR_CLASS"
    WEIGHT_UNUSUAL_FOR_CLASS = "WEIGHT_UNUSUAL_FOR_CLASS"
    HEIGHT_WEIGHT_UNUSUAL = "HEIGHT_WEIGHT_UNUSUAL"


@dataclass
class FitCheck:
    height_cm: Decimal | None = None
    weight_kg: Decimal | None = None
    # Optional, from the camera step on the phone (plan A2/A3). Only numbers.
    shoulder_cm: Decimal | None = None
    shoulder_confidence: Decimal | None = None
    errors: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass(frozen=True)
class ChartRow:
    size: str
    height_cm_min: Decimal
    height_cm_max: Decimal
    weight_kg_min: Decimal | None = None
    weight_kg_max: Decimal | None = None
    shoulder_cm_min: Decimal | None = None
    shoulder_cm_max: Decimal | None = None


class Recommendation(NamedTuple):
    status: str
    size: str = ""
    alt_size: str = ""


# --------------------------------------------------------------------------- #
# Input checks
# --------------------------------------------------------------------------- #
def _to_decimal(value) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() else None


def class_age(class_name: str | None) -> int | None:
    """Typical age at the start of the year: Nursery 3, Class 1 6, Class 12 17."""
    name = normalize_class_name(class_name)
    if not name or name not in CLASS_SORT_ORDERS:
        return None
    return CLASS_SORT_ORDERS[name] + 2


def validate_fit(
    height_cm,
    weight_kg,
    class_name: str | None = None,
    shoulder_cm=None,
    shoulder_confidence=None,
) -> FitCheck:
    """
    Hard limits (errors, from shared/fit_limits.json) reject typing mistakes.
    Soft limits (warnings) only ask the parent to check an unusual number.
    The shoulder width is optional. One from the camera comes with the phone's
    confidence (0 to 1); one typed by hand from a tape measure has none.
    """
    check = FitCheck()
    _check_shoulder(check, shoulder_cm, shoulder_confidence)
    height = _to_decimal(height_cm)
    weight = _to_decimal(weight_kg)

    if height_cm in (None, ""):
        check.errors["height_cm"] = "REQUIRED"
    elif height is None:
        check.errors["height_cm"] = "NOT_A_NUMBER"
    elif not HEIGHT_MIN <= height <= HEIGHT_MAX:
        check.errors["height_cm"] = "OUT_OF_RANGE"

    if weight_kg in (None, ""):
        check.errors["weight_kg"] = "REQUIRED"
    elif weight is None:
        check.errors["weight_kg"] = "NOT_A_NUMBER"
    elif not WEIGHT_MIN <= weight <= WEIGHT_MAX:
        check.errors["weight_kg"] = "OUT_OF_RANGE"

    if check.errors:
        check.shoulder_cm = check.shoulder_confidence = None
        return check

    check.height_cm = height.quantize(ONE_DECIMAL, rounding=ROUND_HALF_UP)
    check.weight_kg = weight.quantize(ONE_DECIMAL, rounding=ROUND_HALF_UP)

    age = class_age(class_name)
    if age is not None:
        typical_height = _TYPICAL_HEIGHT[age]
        if abs(height - typical_height) > HEIGHT_BAND_CM:
            check.warnings.append(FitWarning.HEIGHT_UNUSUAL_FOR_CLASS)
        typical_weight = Decimal(_TYPICAL_WEIGHT[age])
        if not typical_weight * WEIGHT_BAND_LOW <= weight <= typical_weight * WEIGHT_BAND_HIGH:
            check.warnings.append(FitWarning.WEIGHT_UNUSUAL_FOR_CLASS)

    bmi = weight / ((height / 100) ** 2)
    if not BMI_MIN <= bmi <= BMI_MAX:
        check.warnings.append(FitWarning.HEIGHT_WEIGHT_UNUSUAL)
    return check


def _check_shoulder(check: FitCheck, shoulder_cm, confidence) -> None:
    if shoulder_cm in (None, "") and confidence in (None, ""):
        return
    shoulder = _to_decimal(shoulder_cm)
    sure = _to_decimal(confidence)
    if shoulder_cm in (None, ""):
        check.errors["shoulder_cm"] = "REQUIRED"
    elif shoulder is None:
        check.errors["shoulder_cm"] = "NOT_A_NUMBER"
    elif not SHOULDER_MIN <= shoulder <= SHOULDER_MAX:
        check.errors["shoulder_cm"] = "OUT_OF_RANGE"
    if confidence in (None, ""):
        sure = None  # typed by hand
    elif sure is None:
        check.errors["shoulder_confidence"] = "NOT_A_NUMBER"
    elif not Decimal(0) <= sure <= Decimal(1):
        check.errors["shoulder_confidence"] = "OUT_OF_RANGE"
    if "shoulder_cm" not in check.errors and "shoulder_confidence" not in check.errors:
        check.shoulder_cm = shoulder.quantize(ONE_DECIMAL, rounding=ROUND_HALF_UP)
        check.shoulder_confidence = (
            sure.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP) if sure is not None else None
        )


# --------------------------------------------------------------------------- #
# Recommendation
# --------------------------------------------------------------------------- #
def _heavier_than(row: ChartRow, weight: Decimal | None) -> bool:
    return weight is not None and row.weight_kg_max is not None and weight > row.weight_kg_max


def _bigger_first(rows: list[ChartRow], pair: list[ChartRow]) -> Recommendation:
    smaller, bigger = sorted(pair, key=rows.index)
    return Recommendation(Status.BETWEEN, bigger.size, smaller.size)


def recommend_size(
    rows: list[ChartRow],
    height_cm: Decimal,
    weight_kg: Decimal | None = None,
) -> Recommendation:
    """`rows` are one product's chart; pass validated numbers (see validate_fit)."""
    if not rows:
        return Recommendation(Status.NO_CHART)

    rows = sorted(rows, key=lambda r: (r.height_cm_min, r.height_cm_max, r.size))
    height = Decimal(height_cm)
    weight = Decimal(weight_kg) if weight_kg is not None else None

    by_height = [r for r in rows if r.height_cm_min <= height <= r.height_cm_max]

    if not by_height:
        if height < rows[0].height_cm_min:
            return Recommendation(Status.BELOW_CHART, rows[0].size)
        if height > max(r.height_cm_max for r in rows):
            return Recommendation(Status.ABOVE_CHART, rows[-1].size)
        # In a gap between two sizes: the last one that ends below the child
        # and the first one that starts above.
        below = [r for r in rows if r.height_cm_max < height][-1]
        above = next(r for r in rows if r.height_cm_min > height)
        if _heavier_than(above, weight):
            nxt = rows.index(above) + 1
            if nxt < len(rows):
                return _bigger_first(rows, [above, rows[nxt]])
            return Recommendation(Status.ABOVE_CHART, above.size)
        return _bigger_first(rows, [below, above])

    fits = [r for r in by_height if not _heavier_than(r, weight)]

    if not fits:
        # Heavier than every size the height allows: offer the next size up.
        biggest = max(by_height, key=rows.index)
        nxt = rows.index(biggest) + 1
        if nxt < len(rows):
            return _bigger_first(rows, [biggest, rows[nxt]])
        return Recommendation(Status.ABOVE_CHART, biggest.size)

    if len(fits) == 1:
        return Recommendation(Status.FIT, fits[0].size)

    # Several sizes fit (overlapping ranges): keep the two whose height range
    # is centred closest to the child.
    def distance(row: ChartRow) -> Decimal:
        return abs((row.height_cm_min + row.height_cm_max) / 2 - height)

    closest = sorted(fits, key=lambda r: (distance(r), rows.index(r)))[:2]
    return _bigger_first(rows, closest)


def refine_with_shoulder(
    rows: list[ChartRow], result: Recommendation, shoulder_cm: Decimal
) -> Recommendation:
    """
    Narrows a height + weight suggestion with the shoulder width measured on
    the phone (plan A5):
      - two sizes suggested and the shoulder fits exactly one of them -> that one;
      - one size suggested and the shoulder is wider than its range -> it and
        the next size up, bigger first.
    Anything else (no shoulder ranges, outside the chart) is left as it was.
    """
    if result.status not in (Status.FIT, Status.BETWEEN):
        return result
    rows = sorted(rows, key=lambda r: (r.height_cm_min, r.height_cm_max, r.size))
    by_size = {row.size: row for row in rows}
    shoulder = Decimal(shoulder_cm)

    def fits(row: ChartRow) -> bool | None:
        if row.shoulder_cm_min is None or row.shoulder_cm_max is None:
            return None
        return row.shoulder_cm_min <= shoulder <= row.shoulder_cm_max

    if result.status == Status.BETWEEN:
        bigger, smaller = by_size.get(result.size), by_size.get(result.alt_size)
        if bigger is None or smaller is None:
            return result
        big_fits, small_fits = fits(bigger), fits(smaller)
        if big_fits is True and small_fits is False:
            return Recommendation(Status.FIT, bigger.size)
        if small_fits is True and big_fits is False:
            return Recommendation(Status.FIT, smaller.size)
        return result

    row = by_size.get(result.size)
    if row is None or row.shoulder_cm_max is None or shoulder <= row.shoulder_cm_max:
        return result
    nxt = rows.index(row) + 1
    if nxt < len(rows):
        return Recommendation(Status.BETWEEN, rows[nxt].size, row.size)
    return result


def suggest(rows: list[ChartRow], check: FitCheck) -> Recommendation:
    """
    The suggestion used by the shop and the order log. The shoulder width only
    counts when FIT_USE_SHOULDER is on (after the A4 calibration says it helps)
    and the phone was sure enough of the reading.
    """
    result = recommend_size(rows, check.height_cm, check.weight_kg)
    if (
        getattr(settings, "FIT_USE_SHOULDER", False)
        and check.shoulder_cm is not None
        and check.shoulder_confidence is not None
        and check.shoulder_confidence >= Decimal(str(settings.FIT_SHOULDER_MIN_CONFIDENCE))
    ):
        return refine_with_shoulder(rows, result, check.shoulder_cm)
    return result


def chart_rows_from_models(size_chart_rows) -> list[ChartRow]:
    """SizeChartRow objects (with `variant` loaded) -> ChartRow values."""
    return [
        ChartRow(
            size=row.variant.size,
            height_cm_min=row.height_cm_min,
            height_cm_max=row.height_cm_max,
            weight_kg_min=row.weight_kg_min,
            weight_kg_max=row.weight_kg_max,
            shoulder_cm_min=row.shoulder_cm_min,
            shoulder_cm_max=row.shoulder_cm_max,
        )
        for row in size_chart_rows
    ]
