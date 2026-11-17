"""
Shoulder width estimator from height and weight (Prompt 7).

Pure Python implementation (standard library only, no numpy).
Predicts child's shoulder width from height, BMI, gender, and class index:
    shoulder_cm = b0 + b1*height_cm + b2*BMI + b3*is_female + b4*class_index

Maintains residual standard deviation (sigma) per gender so the 80% range
(estimate +/- 1.28*sigma) is honest.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from common.constants import CLASS_SORT_ORDERS, normalize_class_name
from .models import ShoulderEstimateModel, SizeChartRow, SizingSample
from .sizing import (
    HEIGHT_MAX,
    HEIGHT_MIN,
    SHOULDER_MAX,
    SHOULDER_MIN,
    WEIGHT_MAX,
    WEIGHT_MIN,
    ChartRow,
    chart_rows_from_models,
    recommend_size,
    validate_fit,
)

# Baseline coefficients when no trained model exists yet
# Derived from Indian pediatric anthropometric distributions
DEFAULT_COEFFICIENTS = {
    "b0": 5.20,
    "b1_height": 0.178,
    "b2_bmi": 0.245,
    "b3_female": -0.32,
    "b4_class": 0.05,
    "without_class": {
        "b0": 5.45,
        "b1_height": 0.182,
        "b2_bmi": 0.250,
        "b3_female": -0.32,
    },
    "sigmas": {
        "all": 1.50,
        "boy": 1.48,
        "girl": 1.52,
    },
}
DEFAULT_SIGMA = 1.50
CONFIDENCE_INTERVAL_Z = 1.28  # 80% coverage under normal distribution (approx 1.28155)


def solve_linear_system(a: list[list[float]], b: list[float]) -> list[float]:
    """Solve the linear system A * x = b using Gaussian elimination with partial pivoting."""
    n = len(b)
    if n == 0 or len(a) != n or any(len(row) != n for row in a):
        raise ValueError("Invalid matrix dimensions")

    a = [row[:] for row in a]
    b = b[:]

    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            raise ValueError("Matrix is singular or ill-conditioned")

        a[col], a[pivot] = a[pivot], a[col]
        b[col], b[pivot] = b[pivot], b[col]

        pivot_val = a[col][col]
        for r in range(n):
            if r != col:
                factor = a[r][col] / pivot_val
                a[r] = [a[r][c] - factor * a[col][c] for c in range(n)]
                b[r] -= factor * b[col]

    return [b[i] / a[i][i] for i in range(n)]


def weighted_least_squares(
    xs: list[list[float]], ys: list[float], weights: list[float]
) -> list[float]:
    """
    Solve weighted least squares (X^T * W * X) * beta = X^T * W * y.
    xs: n x p feature matrix
    ys: n targets
    weights: n positive weights
    """
    n = len(xs)
    if n == 0:
        raise ValueError("Cannot fit with zero samples")
    p = len(xs[0])
    if len(ys) != n or len(weights) != n:
        raise ValueError("Length mismatch between xs, ys, and weights")

    # A = X^T * W * X (p x p)
    a = [[0.0] * p for _ in range(p)]
    for i in range(p):
        for j in range(p):
            a[i][j] = sum(weights[k] * xs[k][i] * xs[k][j] for k in range(n))

    # b = X^T * W * y (p x 1)
    b = [sum(weights[k] * xs[k][i] * ys[k] for k in range(n)) for i in range(p)]

    return solve_linear_system(a, b)


def get_class_index(class_name: str | None) -> int | None:
    """Map class name to integer index: Nursery 0, Junior KG 1, Senior KG 2, Class 1 = 3 ... Class 12 = 14."""
    if not class_name:
        return None
    normalized = normalize_class_name(class_name)
    if not normalized or normalized not in CLASS_SORT_ORDERS:
        return None
    return CLASS_SORT_ORDERS[normalized] - 1


def is_female_gender(gender_val: str | None) -> float:
    """Return 1.0 for female/girl, 0.0 for male/boy, 0.5 for unisex/unknown."""
    if not gender_val:
        return 0.5
    g = str(gender_val).strip().lower()
    if g in ("girl", "female", "f"):
        return 1.0
    if g in ("boy", "male", "m"):
        return 0.0
    return 0.5


@dataclass
class TrainingSample:
    height_cm: float
    weight_kg: float
    shoulder_cm: float
    bmi: float
    is_female: float
    class_index: int | None
    weight: float
    is_real: bool
    gender_key: str  # 'boy', 'girl', or 'unisex'


def fetch_training_data() -> tuple[list[TrainingSample], int, int]:
    """
    Collect training data from:
    1. Real measurements: StudentMeasurement and SizingSample (weight 1.0)
    2. SizeChartRow pseudo-samples (weight 0.3)
    Filter strictly by FIT_LIMITS.
    """
    from schools.models import StudentMeasurement

    samples: list[TrainingSample] = []
    n_real = 0
    n_chart = 0

    # 1a. StudentMeasurement
    real_sm_qs = StudentMeasurement.objects.filter(
        shoulder_cm__isnull=False,
        height_cm__isnull=False,
        weight_kg__isnull=False,
    ).select_related("student")

    for sm in real_sm_qs:
        # Check source and confidence criteria:
        # tape (MANUAL), or camera with confidence >= 0.7 and not shoulder_edited
        if sm.source == StudentMeasurement.Source.MANUAL:
            pass  # tape measure is trusted
        elif sm.source == StudentMeasurement.Source.CAMERA:
            if sm.shoulder_edited:
                continue
            if sm.shoulder_confidence is None or sm.shoulder_confidence < Decimal("0.70"):
                continue
        else:
            continue

        h = float(sm.height_cm)
        w = float(sm.weight_kg)
        s = float(sm.shoulder_cm)
        if not (float(HEIGHT_MIN) <= h <= float(HEIGHT_MAX)):
            continue
        if not (float(WEIGHT_MIN) <= w <= float(WEIGHT_MAX)):
            continue
        if not (float(SHOULDER_MIN) <= s <= float(SHOULDER_MAX)):
            continue

        bmi = w / ((h / 100.0) ** 2)
        gender_str = getattr(sm.student, "gender", "")
        fem = is_female_gender(gender_str)
        gender_key = "girl" if fem == 1.0 else ("boy" if fem == 0.0 else "unisex")
        c_idx = get_class_index(getattr(sm.student, "class_name", ""))

        samples.append(
            TrainingSample(
                height_cm=h,
                weight_kg=w,
                shoulder_cm=s,
                bmi=bmi,
                is_female=fem,
                class_index=c_idx,
                weight=1.0,
                is_real=True,
                gender_key=gender_key,
            )
        )
        n_real += 1

    # 1b. SizingSample
    sample_qs = SizingSample.objects.filter(
        shoulder_cm__isnull=False,
        height_cm__isnull=False,
        weight_kg__isnull=False,
    ).select_related("product")

    for ss in sample_qs:
        if ss.shoulder_confidence is not None and ss.shoulder_confidence < Decimal("0.70"):
            continue
        h = float(ss.height_cm)
        w = float(ss.weight_kg)
        s = float(ss.shoulder_cm)
        if not (float(HEIGHT_MIN) <= h <= float(HEIGHT_MAX)):
            continue
        if not (float(WEIGHT_MIN) <= w <= float(WEIGHT_MAX)):
            continue
        if not (float(SHOULDER_MIN) <= s <= float(SHOULDER_MAX)):
            continue

        bmi = w / ((h / 100.0) ** 2)
        prod_gender = getattr(ss.product, "gender", "") if ss.product else ""
        fem = is_female_gender(prod_gender)
        gender_key = "girl" if fem == 1.0 else ("boy" if fem == 0.0 else "unisex")
        c_idx = get_class_index(ss.student_class)

        samples.append(
            TrainingSample(
                height_cm=h,
                weight_kg=w,
                shoulder_cm=s,
                bmi=bmi,
                is_female=fem,
                class_index=c_idx,
                weight=1.0,
                is_real=True,
                gender_key=gender_key,
            )
        )
        n_real += 1

    # 1c. "Fits well" feedback lines from OrderItem (Prompt 9: weak sample, weight 0.5)
    from orders.models import OrderItem
    fits_well_items = OrderItem.objects.filter(
        fit_feedback="FITS_WELL",
        fit_height_cm__isnull=False,
        fit_weight_kg__isnull=False,
    ).select_related("variant__product", "order")

    for oi in fits_well_items:
        h = float(oi.fit_height_cm)
        w = float(oi.fit_weight_kg)
        if not (float(HEIGHT_MIN) <= h <= float(HEIGHT_MAX)):
            continue
        if not (float(WEIGHT_MIN) <= w <= float(WEIGHT_MAX)):
            continue

        chart_row = SizeChartRow.objects.filter(
            variant=oi.variant,
            shoulder_cm_min__isnull=False,
            shoulder_cm_max__isnull=False,
        ).first()

        if chart_row:
            s = (float(chart_row.shoulder_cm_min) + float(chart_row.shoulder_cm_max)) / 2.0
            if float(SHOULDER_MIN) <= s <= float(SHOULDER_MAX):
                bmi = w / ((h / 100.0) ** 2)
                prod = getattr(oi.variant, "product", None)
                prod_gender = getattr(prod, "gender", "") if prod else ""
                fem = is_female_gender(prod_gender)
                gender_key = "girl" if fem == 1.0 else ("boy" if fem == 0.0 else "unisex")
                c_idx = get_class_index(getattr(oi.order, "student_class", ""))

                samples.append(
                    TrainingSample(
                        height_cm=h,
                        weight_kg=w,
                        shoulder_cm=s,
                        bmi=bmi,
                        is_female=fem,
                        class_index=c_idx,
                        weight=0.5,
                        is_real=True,
                        gender_key=gender_key,
                    )
                )
                n_real += 1

    # 1d. "Fits well" feedback lines from anonymised SizingSample (weight 0.5)
    sizing_fits_well = SizingSample.objects.filter(
        fit_feedback="FITS_WELL",
        height_cm__isnull=False,
        weight_kg__isnull=False,
    ).select_related("product")

    for ss in sizing_fits_well:
        h = float(ss.height_cm)
        w = float(ss.weight_kg)
        if not (float(HEIGHT_MIN) <= h <= float(HEIGHT_MAX)):
            continue
        if not (float(WEIGHT_MIN) <= w <= float(WEIGHT_MAX)):
            continue

        target_size = ss.final_size or ss.chosen_size
        if not target_size or not ss.product:
            continue

        chart_row = SizeChartRow.objects.filter(
            variant__product=ss.product,
            variant__size=target_size,
            shoulder_cm_min__isnull=False,
            shoulder_cm_max__isnull=False,
        ).first()

        if chart_row:
            s = (float(chart_row.shoulder_cm_min) + float(chart_row.shoulder_cm_max)) / 2.0
            if float(SHOULDER_MIN) <= s <= float(SHOULDER_MAX):
                bmi = w / ((h / 100.0) ** 2)
                prod_gender = getattr(ss.product, "gender", "") if ss.product else ""
                fem = is_female_gender(prod_gender)
                gender_key = "girl" if fem == 1.0 else ("boy" if fem == 0.0 else "unisex")
                c_idx = get_class_index(ss.student_class)

                samples.append(
                    TrainingSample(
                        height_cm=h,
                        weight_kg=w,
                        shoulder_cm=s,
                        bmi=bmi,
                        is_female=fem,
                        class_index=c_idx,
                        weight=0.5,
                        is_real=True,
                        gender_key=gender_key,
                    )
                )
                n_real += 1

    # Compute median BMI of real data if available, else standard 16.5
    real_bmis = [s.bmi for s in samples if s.is_real]
    median_bmi = 16.5
    if real_bmis:
        sorted_bmis = sorted(real_bmis)
        mid = len(sorted_bmis) // 2
        median_bmi = sorted_bmis[mid]

    # 2. SizeChartRow pseudo-samples
    chart_rows = SizeChartRow.objects.filter(
        shoulder_cm_min__isnull=False,
        shoulder_cm_max__isnull=False,
        height_cm_min__isnull=False,
        height_cm_max__isnull=False,
    ).select_related("variant__product")

    for row in chart_rows:
        h = (float(row.height_cm_min) + float(row.height_cm_max)) / 2.0
        s = (float(row.shoulder_cm_min) + float(row.shoulder_cm_max)) / 2.0

        if row.weight_kg_min is not None and row.weight_kg_max is not None:
            w = (float(row.weight_kg_min) + float(row.weight_kg_max)) / 2.0
        else:
            w = median_bmi * ((h / 100.0) ** 2)

        if not (float(HEIGHT_MIN) <= h <= float(HEIGHT_MAX)):
            continue
        if not (float(WEIGHT_MIN) <= w <= float(WEIGHT_MAX)):
            continue
        if not (float(SHOULDER_MIN) <= s <= float(SHOULDER_MAX)):
            continue

        bmi = w / ((h / 100.0) ** 2)
        prod = getattr(row.variant, "product", None)
        prod_gender = getattr(prod, "gender", "") if prod else ""
        fem = is_female_gender(prod_gender)
        gender_key = "girl" if fem == 1.0 else ("boy" if fem == 0.0 else "unisex")

        samples.append(
            TrainingSample(
                height_cm=h,
                weight_kg=w,
                shoulder_cm=s,
                bmi=bmi,
                is_female=fem,
                class_index=None,
                weight=0.3,
                is_real=False,
                gender_key=gender_key,
            )
        )
        n_chart += 1

    return samples, n_real, n_chart


def evaluate_prediction(
    coeffs_dict: dict,
    height_cm: float,
    bmi: float,
    is_female: float,
    class_index: int | None = None,
) -> float:
    """Evaluate shoulder estimate with or without class_index."""
    if class_index is not None and "b4_class" in coeffs_dict and coeffs_dict.get("b4_class") is not None:
        b0 = coeffs_dict.get("b0", 0.0)
        b1 = coeffs_dict.get("b1_height", 0.0)
        b2 = coeffs_dict.get("b2_bmi", 0.0)
        b3 = coeffs_dict.get("b3_female", 0.0)
        b4 = coeffs_dict.get("b4_class", 0.0)
        return b0 + b1 * height_cm + b2 * bmi + b3 * is_female + b4 * float(class_index)

    wc = coeffs_dict.get("without_class", coeffs_dict)
    b0 = wc.get("b0", 0.0)
    b1 = wc.get("b1_height", 0.0)
    b2 = wc.get("b2_bmi", 0.0)
    b3 = wc.get("b3_female", 0.0)
    return b0 + b1 * height_cm + b2 * bmi + b3 * is_female


def train_model(version: str | None = None, activate_if_better: bool = True) -> dict[str, Any]:
    """
    Train a new shoulder estimation model.
    Runs 5-fold cross-validation when n_real >= 30.
    Activates only if not worse than the currently active model.
    """
    if not version:
        version = timezone.now().strftime("%Y%m%d-%H%M%S")

    samples, n_real, n_chart = fetch_training_data()
    total_samples = len(samples)
    if total_samples < 4:
        # Not enough samples to fit even pseudo-data: return baseline without failure
        active_model = ShoulderEstimateModel.objects.filter(active=True).first()
        if not active_model:
            model = ShoulderEstimateModel.objects.create(
                version=version,
                gender="all",
                coefficients=DEFAULT_COEFFICIENTS,
                sigma_cm=DEFAULT_SIGMA,
                n_real=n_real,
                n_chart=n_chart,
                rmse_cm=DEFAULT_SIGMA,
                active=True,
            )
            return {
                "version": version,
                "n_real": n_real,
                "n_chart": n_chart,
                "sigma_cm": DEFAULT_SIGMA,
                "mae_cm": DEFAULT_SIGMA,
                "rmse_cm": DEFAULT_SIGMA,
                "activated": True,
            }
        return {
            "version": version,
            "n_real": n_real,
            "n_chart": n_chart,
            "sigma_cm": active_model.sigma_cm,
            "mae_cm": active_model.rmse_cm,
            "rmse_cm": active_model.rmse_cm,
            "activated": False,
        }

    # 1. Fit 4-feature model: [1.0, height_cm, bmi, is_female]
    xs_4 = [[1.0, s.height_cm, s.bmi, s.is_female] for s in samples]
    ys = [s.shoulder_cm for s in samples]
    ws = [s.weight for s in samples]

    try:
        beta_4 = weighted_least_squares(xs_4, ys, ws)
    except Exception:
        # In case matrix is singular (e.g. all heights identical)
        beta_4 = [
            DEFAULT_COEFFICIENTS["without_class"]["b0"],
            DEFAULT_COEFFICIENTS["without_class"]["b1_height"],
            DEFAULT_COEFFICIENTS["without_class"]["b2_bmi"],
            DEFAULT_COEFFICIENTS["without_class"]["b3_female"],
        ]

    # 2. Fit 5-feature model (samples with class_index)
    samples_with_class = [s for s in samples if s.class_index is not None]
    if len(samples_with_class) >= 8:
        xs_5 = [[1.0, s.height_cm, s.bmi, s.is_female, float(s.class_index)] for s in samples_with_class]
        ys_5 = [s.shoulder_cm for s in samples_with_class]
        ws_5 = [s.weight for s in samples_with_class]
        try:
            beta_5 = weighted_least_squares(xs_5, ys_5, ws_5)
        except Exception:
            beta_5 = beta_4 + [0.0]
    else:
        beta_5 = beta_4 + [0.0]

    coeffs_dict = {
        "b0": round(beta_5[0], 5),
        "b1_height": round(beta_5[1], 5),
        "b2_bmi": round(beta_5[2], 5),
        "b3_female": round(beta_5[3], 5),
        "b4_class": round(beta_5[4], 5),
        "without_class": {
            "b0": round(beta_4[0], 5),
            "b1_height": round(beta_4[1], 5),
            "b2_bmi": round(beta_4[2], 5),
            "b3_female": round(beta_4[3], 5),
        },
    }

    # 3. Compute residuals & sigmas per gender
    eval_samples = [s for s in samples if s.is_real] if n_real >= 10 else samples
    residuals_by_gender: dict[str, list[float]] = {"all": [], "boy": [], "girl": []}
    sq_errs = []

    for s in eval_samples:
        pred = evaluate_prediction(coeffs_dict, s.height_cm, s.bmi, s.is_female, s.class_index)
        diff = s.shoulder_cm - pred
        sq_errs.append(diff * diff)
        residuals_by_gender["all"].append(diff)
        if s.gender_key == "boy":
            residuals_by_gender["boy"].append(diff)
        elif s.gender_key == "girl":
            residuals_by_gender["girl"].append(diff)

    def calc_sigma(diffs: list[float], min_samples: int = 5) -> float:
        if len(diffs) < min_samples:
            return DEFAULT_SIGMA
        mean_diff = sum(diffs) / len(diffs)
        var = sum((d - mean_diff) ** 2 for d in diffs) / max(1, len(diffs) - 1)
        return max(0.8, math.sqrt(var))

    sigma_all = calc_sigma(residuals_by_gender["all"])
    sigma_boy = calc_sigma(residuals_by_gender["boy"]) if len(residuals_by_gender["boy"]) >= 5 else sigma_all
    sigma_girl = calc_sigma(residuals_by_gender["girl"]) if len(residuals_by_gender["girl"]) >= 5 else sigma_all

    coeffs_dict["sigmas"] = {
        "all": round(sigma_all, 3),
        "boy": round(sigma_boy, 3),
        "girl": round(sigma_girl, 3),
    }

    rmse = math.sqrt(sum(sq_errs) / len(sq_errs)) if sq_errs else DEFAULT_SIGMA

    # 4. 5-fold cross-validation when n_real >= 30
    cv_mae: float | None = None
    real_samples = [s for s in samples if s.is_real]
    if len(real_samples) >= 30:
        k = 5
        fold_size = len(real_samples) // k
        fold_maes = []
        for fold in range(k):
            val_start = fold * fold_size
            val_end = val_start + fold_size if fold < k - 1 else len(real_samples)
            val_set = real_samples[val_start:val_end]
            train_set = real_samples[:val_start] + real_samples[val_end:] + [s for s in samples if not s.is_real]

            xs_cv = [[1.0, s.height_cm, s.bmi, s.is_female] for s in train_set]
            ys_cv = [s.shoulder_cm for s in train_set]
            ws_cv = [s.weight for s in train_set]
            try:
                b_cv = weighted_least_squares(xs_cv, ys_cv, ws_cv)
                fold_errors = [
                    abs(v.shoulder_cm - (b_cv[0] + b_cv[1] * v.height_cm + b_cv[2] * v.bmi + b_cv[3] * v.is_female))
                    for v in val_set
                ]
                fold_maes.append(sum(fold_errors) / len(fold_errors))
            except Exception:
                continue
        if fold_maes:
            cv_mae = sum(fold_maes) / len(fold_maes)

    report_mae = cv_mae if cv_mae is not None else rmse

    # 5. Activation decision: only activate if not worse than the currently active model
    active_model = ShoulderEstimateModel.objects.filter(active=True).first()
    should_activate = True
    if active_model:
        # Compare error metric (RMSE or CV MAE)
        active_metric = active_model.rmse_cm
        candidate_metric = report_mae
        # Margin: candidate must not be significantly worse (> 0.05 cm worse)
        if candidate_metric > active_metric + 0.05:
            should_activate = False

    with transaction.atomic():
        if should_activate and activate_if_better:
            ShoulderEstimateModel.objects.filter(active=True).update(active=False)

        new_model = ShoulderEstimateModel.objects.create(
            version=version,
            gender="all",
            coefficients=coeffs_dict,
            sigma_cm=round(sigma_all, 3),
            n_real=n_real,
            n_chart=n_chart,
            rmse_cm=round(rmse, 3),
            active=should_activate if activate_if_better else False,
        )

    return {
        "version": version,
        "n_real": n_real,
        "n_chart": n_chart,
        "sigma_cm": round(sigma_all, 2),
        "sigma_boy": round(sigma_boy, 2),
        "sigma_girl": round(sigma_girl, 2),
        "mae_cm": round(report_mae, 2),
        "rmse_cm": round(rmse, 2),
        "activated": new_model.active,
    }


def estimate_shoulder(
    height_cm: float | Decimal,
    weight_kg: float | Decimal,
    gender: str | None = None,
    class_name: str | None = None,
    model: ShoulderEstimateModel | None = None,
) -> dict[str, Any]:
    """
    Estimate shoulder width range and confidence bounds.
    Returns:
    {
        "shoulder_cm": float,
        "shoulder_low_cm": float,
        "shoulder_high_cm": float,
        "sigma_cm": float,
        "model_version": str,
        "n_real": int,
    }
    """
    h = float(height_cm)
    w = float(weight_kg)
    bmi = w / ((h / 100.0) ** 2)
    fem = is_female_gender(gender)
    c_idx = get_class_index(class_name)

    if model is None:
        model = ShoulderEstimateModel.objects.filter(active=True).order_by("-trained_at").first()

    coeffs = model.coefficients if model else DEFAULT_COEFFICIENTS
    version = model.version if model else "baseline-v1"
    n_real = model.n_real if model else 0

    est = evaluate_prediction(coeffs, h, bmi, fem, c_idx)

    # Determine gender-specific sigma
    sigmas = coeffs.get("sigmas", {})
    g_key = "girl" if fem == 1.0 else ("boy" if fem == 0.0 else "all")
    sigma = float(sigmas.get(g_key, sigmas.get("all", DEFAULT_SIGMA)))

    # Clamp estimate to physiological limits
    est_clamped = max(float(SHOULDER_MIN), min(float(SHOULDER_MAX), est))
    delta = CONFIDENCE_INTERVAL_Z * sigma
    low = max(float(SHOULDER_MIN), est_clamped - delta)
    high = min(float(SHOULDER_MAX), est_clamped + delta)

    return {
        "shoulder_cm": round(est_clamped, 1),
        "shoulder_low_cm": round(low, 1),
        "shoulder_high_cm": round(high, 1),
        "sigma_cm": round(sigma, 2),
        "model_version": version,
        "n_real": n_real,
    }


def calculate_overlap_fraction(s_low: float, s_high: float, r_min: float, r_max: float) -> float:
    """Calculate what fraction of the estimated interval [s_low, s_high] falls inside [r_min, r_max]."""
    if s_high <= s_low:
        return 1.0 if (r_min <= s_low <= r_max) else 0.0
    overlap_low = max(s_low, r_min)
    overlap_high = min(s_high, r_max)
    if overlap_high <= overlap_low:
        return 0.0
    return (overlap_high - overlap_low) / (s_high - s_low)


def recommend_size_from_estimate(
    school_id: Any | None = None,
    class_id: Any | None = None,
    class_name: str | None = None,
    gender: str | None = None,
    height_cm: Any = None,
    weight_kg: Any = None,
    product_id: Any | None = None,
) -> dict[str, Any]:
    """
    Public entry point for size estimation from height and weight (Prompt 7 / 8).
    Scores size chart rows by overlap with the 80% estimated shoulder range.
    Straddling ranges pick the larger size with smaller as alt_size.
    Returns honest confidence (High / Medium / Low).
    """
    # 1. Validation
    check = validate_fit(height_cm, weight_kg, class_name=class_name)
    if not check.ok:
        return {
            "errors": check.errors,
            "shoulder_cm": None,
            "shoulder_low_cm": None,
            "shoulder_high_cm": None,
            "confidence": "low",
            "recommended_size": "",
            "alt_size": "",
            "reason": "Invalid height or weight values.",
            "model_version": "",
        }

    h_val = float(check.height_cm)
    w_val = float(check.weight_kg)

    # 2. Shoulder prediction
    estimate = estimate_shoulder(h_val, w_val, gender=gender, class_name=class_name)
    s_est = estimate["shoulder_cm"]
    s_low = estimate["shoulder_low_cm"]
    s_high = estimate["shoulder_high_cm"]
    version = estimate["model_version"]
    n_real = estimate["n_real"]

    # 3. Fetch size chart rows
    chart_qs = SizeChartRow.objects.select_related("variant__product").filter(
        variant__active=True,
        variant__product__active=True,
    )

    if product_id:
        chart_qs = chart_qs.filter(variant__product_id=product_id)
    elif school_id:
        chart_qs = chart_qs.filter(variant__product__school_id=school_id)
        if gender:
            g_str = str(gender).strip().lower()
            if g_str in ("boy", "male"):
                chart_qs = chart_qs.filter(variant__product__gender__in=["boy", "unisex"])
            elif g_str in ("girl", "female"):
                chart_qs = chart_qs.filter(variant__product__gender__in=["girl", "unisex"])

    chart_models = list(chart_qs.order_by("height_cm_min", "height_cm_max"))
    if not chart_models:
        return {
            "shoulder_cm": s_est,
            "shoulder_low_cm": s_low,
            "shoulder_high_cm": s_high,
            "confidence": "low",
            "recommended_size": "",
            "alt_size": "",
            "reason": "No size chart found for this selection.",
            "model_version": version,
        }

    # Check if rows have shoulder ranges
    rows_with_shoulder = [
        r for r in chart_models if r.shoulder_cm_min is not None and r.shoulder_cm_max is not None
    ]

    # If no shoulder ranges in chart: fall back to existing height-only behavior
    if not rows_with_shoulder:
        existing_chart_rows = chart_rows_from_models(chart_models)
        base_rec = recommend_size(existing_chart_rows, Decimal(str(h_val)), Decimal(str(w_val)))
        return {
            "shoulder_cm": None,
            "shoulder_low_cm": None,
            "shoulder_high_cm": None,
            "confidence": "medium" if base_rec.status == "FIT" else "low",
            "recommended_size": base_rec.size,
            "alt_size": base_rec.alt_size,
            "reason": "Size recommended from height and weight (chart has no shoulder data).",
            "model_version": version,
        }

    # 4. Score each row by overlap fraction with the 80% estimated shoulder range
    scored_rows: list[dict[str, Any]] = []
    for idx, r in enumerate(rows_with_shoulder):
        r_min = float(r.shoulder_cm_min)
        r_max = float(r.shoulder_cm_max)
        overlap = calculate_overlap_fraction(s_low, s_high, r_min, r_max)

        h_mid = (float(r.height_cm_min) + float(r.height_cm_max)) / 2.0
        h_dist = abs(h_val - h_mid)

        scored_rows.append(
            {
                "row": r,
                "size": r.variant.size,
                "order_idx": idx,
                "overlap": overlap,
                "height_dist": h_dist,
                "shoulder_min": r_min,
                "shoulder_max": r_max,
            }
        )

    # Sort descending by overlap, then ascending by height_dist, then order_idx
    scored_rows.sort(key=lambda item: (-item["overlap"], item["height_dist"], item["order_idx"]))

    top = scored_rows[0]
    overlap_top = top["overlap"]

    # Check for straddling: top candidate has positive overlap, and second candidate also has overlap
    has_straddle = False
    second = None
    if len(scored_rows) > 1 and scored_rows[1]["overlap"] > 0.15:
        has_straddle = True
        second = scored_rows[1]

    # Select recommended_size and alt_size
    if has_straddle and second:
        # Straddling two sizes: pick larger as recommended, smaller as alt_size
        if top["order_idx"] >= second["order_idx"]:
            rec_size = top["size"]
            alt_size = second["size"]
        else:
            rec_size = second["size"]
            alt_size = top["size"]
    else:
        rec_size = top["size"]
        alt_size = ""
        # If single fit but next size up exists, can offer as looser fit alt_size
        nxt_idx = top["order_idx"] + 1
        if nxt_idx < len(rows_with_shoulder):
            alt_size = rows_with_shoulder[nxt_idx].variant.size

    # Check boundaries (outside chart)
    min_chart_shoulder = min(r["shoulder_min"] for r in scored_rows)
    max_chart_shoulder = max(r["shoulder_max"] for r in scored_rows)

    if s_high < min_chart_shoulder:
        rec_size = rows_with_shoulder[0].variant.size
        alt_size = ""
        confidence = "low"
        reason = "Child's measurements fall below the smallest size in the chart."
    elif s_low > max_chart_shoulder:
        rec_size = rows_with_shoulder[-1].variant.size
        alt_size = ""
        confidence = "low"
        reason = "Child's measurements exceed the largest size in the chart."
    elif overlap_top >= 0.70 and n_real >= 30 and not has_straddle:
        confidence = "high"
        reason = "Most children of this height and weight fit this size."
    elif overlap_top >= 0.50 or has_straddle:
        confidence = "medium"
        if n_real < 30:
            reason = "Estimated from height and weight using size charts. For exact fit, measure shoulders."
        elif has_straddle:
            reason = "Good guess. Between sizes we picked the bigger one."
        else:
            reason = "Good guess based on height and weight."
    else:
        confidence = "low"
        reason = "Not sure. Measure the shoulders for an exact fit."

    return {
        "shoulder_cm": s_est,
        "shoulder_low_cm": s_low,
        "shoulder_high_cm": s_high,
        "confidence": confidence,
        "recommended_size": rec_size,
        "alt_size": alt_size,
        "reason": reason,
        "model_version": version,
    }


def check_size_chart_biases() -> list[dict]:
    """
    Check if > 15% of answers for a school/class/gender chart say "TOO_TIGHT" (Prompt 9).
    Flags that chart ("Customers find this chart runs small") in the admin panel for human review.
    Does not change charts automatically.
    """
    from collections import defaultdict
    from orders.models import OrderItem
    from catalog.models import SizingSample

    chart_stats: dict[tuple, dict] = defaultdict(
        lambda: {"too_tight": 0, "fits_well": 0, "too_loose": 0, "total": 0}
    )

    # 1. OrderItems with feedback
    items = OrderItem.objects.filter(
        fit_feedback__in=["TOO_TIGHT", "FITS_WELL", "TOO_LOOSE"]
    ).select_related("order__school", "variant__product")

    for oi in items:
        school_name = oi.order.school.name if oi.order and oi.order.school else "General"
        student_class = oi.order.student_class if oi.order else ""
        prod = oi.variant.product if oi.variant else None
        prod_gender = prod.gender if prod else "unisex"
        prod_name = prod.name if prod else "Uniform"

        key = (school_name, student_class, prod_gender, prod_name)
        fb = oi.fit_feedback
        if fb == "TOO_TIGHT":
            chart_stats[key]["too_tight"] += 1
        elif fb == "FITS_WELL":
            chart_stats[key]["fits_well"] += 1
        elif fb == "TOO_LOOSE":
            chart_stats[key]["too_loose"] += 1
        chart_stats[key]["total"] += 1

    # 2. SizingSamples with feedback
    samples = SizingSample.objects.filter(
        fit_feedback__in=["TOO_TIGHT", "FITS_WELL", "TOO_LOOSE"]
    ).select_related("product__school")

    for ss in samples:
        school_name = ss.product.school.name if ss.product and ss.product.school else "General"
        student_class = ss.student_class or ""
        prod = ss.product
        prod_gender = prod.gender if prod else "unisex"
        prod_name = prod.name if prod else "Uniform"

        key = (school_name, student_class, prod_gender, prod_name)
        fb = ss.fit_feedback
        if fb == "TOO_TIGHT":
            chart_stats[key]["too_tight"] += 1
        elif fb == "FITS_WELL":
            chart_stats[key]["fits_well"] += 1
        elif fb == "TOO_LOOSE":
            chart_stats[key]["too_loose"] += 1
        chart_stats[key]["total"] += 1

    flagged = []
    for (school_name, student_class, prod_gender, prod_name), counts in sorted(chart_stats.items()):
        total = counts["total"]
        if total == 0:
            continue
        too_tight_pct = (counts["too_tight"] / total) * 100.0
        if too_tight_pct > 15.0:
            cls_part = f" - Class {student_class}" if student_class else ""
            chart_label = f"{school_name}{cls_part} - {prod_gender.title()} ({prod_name})"
            flagged.append({
                "school_name": school_name,
                "student_class": student_class,
                "gender": prod_gender,
                "product_name": prod_name,
                "chart_key": chart_label,
                "total_answers": total,
                "too_tight_count": counts["too_tight"],
                "too_tight_pct": round(too_tight_pct, 1),
                "flag": "Customers find this chart runs small",
            })

    return flagged


def get_size_advice_accuracy_report() -> dict:
    """
    Metrics for the Boss/Admin "Size advice accuracy" card (Prompt 9):
    - answers_this_season
    - fits_well_total, fits_well_pct
    - by_source: {estimate: {total, fits_well, fits_well_pct}, camera: ..., tape: ...}
    - by_confidence: {high: {total, fits_well, fits_well_pct}, medium: ..., low: ...}
    - flagged_charts: list of flagged charts
    """
    from orders.models import OrderItem
    from catalog.models import SizingSample

    items = list(
        OrderItem.objects.filter(
            fit_feedback__in=["TOO_TIGHT", "FITS_WELL", "TOO_LOOSE"]
        ).select_related("order__school", "variant__product")
    )
    samples = list(
        SizingSample.objects.filter(
            fit_feedback__in=["TOO_TIGHT", "FITS_WELL", "TOO_LOOSE"]
        ).select_related("product__school")
    )

    total_answers = len(items) + len(samples)
    fits_well_total = (
        sum(1 for i in items if i.fit_feedback == "FITS_WELL")
        + sum(1 for s in samples if s.fit_feedback == "FITS_WELL")
    )
    fits_well_pct = round((fits_well_total / total_answers) * 100.0, 1) if total_answers > 0 else 0.0

    def resolve_source(record) -> str:
        src = getattr(record, "fit_source", "") or ""
        src = src.upper()
        if src == "ESTIMATE":
            return "estimate"
        if src == "CAMERA":
            return "camera"
        if src in ("MANUAL", "TAPE"):
            return "tape"

        conf = getattr(record, "fit_shoulder_confidence", None) or getattr(record, "shoulder_confidence", None)
        shoulder = getattr(record, "fit_shoulder_cm", None) or getattr(record, "shoulder_cm", None)
        if conf is not None:
            return "camera"
        if shoulder is not None:
            return "tape"
        return "estimate"

    def resolve_confidence(record) -> str:
        conf = getattr(record, "fit_shoulder_confidence", None) or getattr(record, "shoulder_confidence", None)
        status = getattr(record, "recommendation_status", "")
        if conf is not None:
            c = float(conf)
            if c >= 0.70:
                return "high"
            if c >= 0.50:
                return "medium"
            return "low"
        if status:
            s = status.upper()
            if "HIGH" in s or s == "FIT":
                return "high"
            if "MEDIUM" in s or s == "BETWEEN":
                return "medium"
            if "LOW" in s or "CHART" in s:
                return "low"
        return "medium"

    source_buckets = {
        "estimate": {"total": 0, "fits_well": 0},
        "camera": {"total": 0, "fits_well": 0},
        "tape": {"total": 0, "fits_well": 0},
    }
    confidence_buckets = {
        "high": {"total": 0, "fits_well": 0},
        "medium": {"total": 0, "fits_well": 0},
        "low": {"total": 0, "fits_well": 0},
    }

    for record in items + samples:
        src = resolve_source(record)
        conf = resolve_confidence(record)
        is_ok = (record.fit_feedback == "FITS_WELL")

        if src in source_buckets:
            source_buckets[src]["total"] += 1
            if is_ok:
                source_buckets[src]["fits_well"] += 1

        if conf in confidence_buckets:
            confidence_buckets[conf]["total"] += 1
            if is_ok:
                confidence_buckets[conf]["fits_well"] += 1

    by_source = {
        k: {
            "total": v["total"],
            "fits_well": v["fits_well"],
            "fits_well_pct": round((v["fits_well"] / v["total"]) * 100.0, 1) if v["total"] > 0 else 0.0,
        }
        for k, v in source_buckets.items()
    }

    by_confidence = {
        k: {
            "total": v["total"],
            "fits_well": v["fits_well"],
            "fits_well_pct": round((v["fits_well"] / v["total"]) * 100.0, 1) if v["total"] > 0 else 0.0,
        }
        for k, v in confidence_buckets.items()
    }

    return {
        "answers_this_season": total_answers,
        "fits_well_total": fits_well_total,
        "fits_well_pct": fits_well_pct,
        "by_source": by_source,
        "by_confidence": by_confidence,
        "flagged_charts": check_size_chart_biases(),
    }

