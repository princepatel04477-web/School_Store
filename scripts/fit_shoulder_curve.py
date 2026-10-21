"""Fit the shoulder mass-correction curve (MASS_CURVE in frontend/src/measure/config.ts) to tape checks.

The phone multiplies its camera reading by a curve of BMI:

    d          = BMI - BMI_BASE
    multiplier = gain + alpha * d + beta * d * |d|      (then clamped to min/max)
    shoulder   = camera reading * multiplier

Each tape check says which multiplier that person needed: tape / camera. This
script finds gain, alpha (and beta, if asked) that make those needed multipliers
as close as possible on average (least squares), then prints the line to paste
into config.ts.

Input: a CSV with a header row and these columns (extra columns are ignored):

    height_cm, weight_kg, camera_cm, tape_cm

camera_cm is the "camera ... cm" number from the results screen in test mode
(/shop?measuredebug), the reading BEFORE the weight correction. tape_cm is the
tape across the back, shoulder point to shoulder point, taken the same way for
everyone.

    python scripts/fit_shoulder_curve.py checks.csv
    python scripts/fit_shoulder_curve.py checks.csv --bend     # also fit beta
    python scripts/fit_shoulder_curve.py checks.csv --base 23  # another baseline BMI

Standard library only.
"""

import argparse
import csv
import sys

BMI_BASE = 22.0


def read_checks(path):
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for line, row in enumerate(csv.DictReader(handle), start=2):
            try:
                height = float(row["height_cm"])
                weight = float(row["weight_kg"])
                camera = float(row["camera_cm"])
                tape = float(row["tape_cm"])
            except (KeyError, TypeError, ValueError):
                print(f"line {line}: needs height_cm, weight_kg, camera_cm and tape_cm as numbers; skipped")
                continue
            if min(height, weight, camera, tape) <= 0:
                print(f"line {line}: a value is zero or below; skipped")
                continue
            bmi = weight / (height / 100) ** 2
            rows.append({"bmi": bmi, "camera": camera, "tape": tape, "need": tape / camera})
    return rows


def features(bmi, base, bend):
    d = bmi - base
    return [1.0, d, d * abs(d)] if bend else [1.0, d]


def least_squares(xs, ys):
    """Solve the normal equations (X'X) c = X'y by Gaussian elimination."""
    n = len(xs[0])
    a = [[sum(x[i] * x[j] for x in xs) for j in range(n)] for i in range(n)]
    b = [sum(x[i] * y for x, y in zip(xs, ys)) for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            raise ValueError("not enough spread in BMI to fit this many constants")
        a[col], a[pivot] = a[pivot], a[col]
        b[col], b[pivot] = b[pivot], b[col]
        for r in range(n):
            if r != col:
                f = a[r][col] / a[col][col]
                a[r] = [a[r][c] - f * a[col][c] for c in range(n)]
                b[r] -= f * b[col]
    return [b[i] / a[i][i] for i in range(n)]


def fit(rows, base, bend):
    coeffs = least_squares([features(r["bmi"], base, bend) for r in rows], [r["need"] for r in rows])
    return coeffs + ([] if bend else [0.0])


def predict(row, coeffs, base):
    gain, alpha, beta = coeffs
    d = row["bmi"] - base
    return row["camera"] * (gain + alpha * d + beta * d * abs(d))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv")
    parser.add_argument("--base", type=float, default=BMI_BASE, help="baseline BMI (default 22)")
    parser.add_argument("--bend", action="store_true", help="also fit beta (needs 8 or more checks to mean much)")
    args = parser.parse_args()

    rows = read_checks(args.csv)
    need = 4 if args.bend else 3
    if len(rows) < need:
        sys.exit(f"{len(rows)} usable checks; at least {need} are needed (10 to 20 is better).")

    coeffs = fit(rows, args.base, args.bend)
    print(f"\n{len(rows)} checks, BMI {min(r['bmi'] for r in rows):.1f} to {max(r['bmi'] for r in rows):.1f}\n")
    print(f"{'BMI':>6} {'camera':>7} {'tape':>6} {'fitted':>7} {'error':>6}   {'new person':>10}")
    loo_errors = []
    for i, row in enumerate(rows):
        fitted = predict(row, coeffs, args.base)
        # Leave-one-out: this person predicted by a curve fitted without them.
        others = rows[:i] + rows[i + 1:]
        try:
            loo = predict(row, fit(others, args.base, args.bend), args.base) - row["tape"]
            loo_errors.append(loo)
            loo_text = f"{loo:+.1f}"
        except ValueError:
            loo_text = "-"
        print(f"{row['bmi']:6.1f} {row['camera']:7.1f} {row['tape']:6.1f} {fitted:7.1f} {fitted - row['tape']:+6.1f}   {loo_text:>10}")

    errors = [abs(predict(r, coeffs, args.base) - r["tape"]) for r in rows]
    print(f"\nOn these people: average miss {sum(errors) / len(errors):.1f} cm, worst {max(errors):.1f} cm")
    if loo_errors:
        print(f"On a new person (leave-one-out): average miss {sum(abs(e) for e in loo_errors) / len(loo_errors):.1f} cm, "
              f"worst {max(abs(e) for e in loo_errors):.1f} cm  <- the honest number")

    gain, alpha, beta = coeffs
    print("\nPaste into frontend/src/measure/config.ts:\n")
    print(
        f"export const MASS_CURVE = {{ bmiBase: {args.base:g}, gain: {gain:.4f}, alpha: {alpha:.4f}, "
        f"beta: {beta:.5f}, min: 0.85, max: 1.35 }};\n"
    )


if __name__ == "__main__":
    main()
