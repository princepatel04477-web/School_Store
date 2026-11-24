# Shoulder Width Estimator: Height & Weight Modeling

## Overview
The shoulder width estimator predicts a child's shoulder width from height and weight when no camera or tape measurement is available.
Because shoulder width varies significantly across body types even with identical height and weight, the model does not return a single point estimate. Instead, it computes an **80% confidence range** and an **honest confidence indicator** (High, Medium, Low).

---

## 1. Mathematical Formulation

The core model is a Weighted Ordinary Least Squares (WOLS) multivariate regression:

$$\text{shoulder\_cm} = b_0 + b_1 \cdot \text{height\_cm} + b_2 \cdot \text{BMI} + b_3 \cdot \text{is\_female} + b_4 \cdot \text{class\_index}$$

Where:
- $\text{BMI} = \frac{\text{weight\_kg}}{(\text{height\_cm} / 100)^2}$
- $\text{is\_female} \in \{0.0, 1.0, 0.5\}$ ($1.0$ for girls, $0.0$ for boys, $0.5$ for unisex/unknown)
- $\text{class\_index}$ maps school grades: Nursery = 0, Junior KG = 1, Senior KG = 2, Class 1 = 3, ..., Class 12 = 14 (fitted only when grade is known)
- In the absence of class, the 4-parameter model ($b_0, b_1, b_2, b_3$) is used.

### Residual Standard Deviation & 80% Confidence Range
Residual standard deviation ($\sigma$) is computed separately per gender ($\sigma_{\text{boy}}, \sigma_{\text{girl}}, \sigma_{\text{all}}$) on real measurement rows:

$$\sigma = \sqrt{\frac{\sum_i w_i (y_i - \hat{y}_i)^2}{\sum_i w_i - p}}$$

The **80% confidence interval** (two-sided normal coverage $Z_{0.90} \approx 1.28$) is:

$$[\text{shoulder\_low\_cm}, \text{shoulder\_high\_cm}] = [\hat{y} - 1.28 \cdot \sigma, \hat{y} + 1.28 \cdot \sigma]$$

---

## 2. Training Data & Weighting Scheme

The training pipeline integrates two distinct sources, strictly constrained within `FIT_LIMITS`:

1. **Real Measurements (Weight: 1.0)**:
   - `StudentMeasurement` rows from manual tape measurements (`source == MANUAL`).
   - Camera measurements (`source == CAMERA`) meeting high-quality criteria: `shoulder_confidence >= 0.70` and `shoulder_edited == False`.
   - Anonymized `SizingSample` rows with verified shoulder readings.
2. **Size Chart Pseudo-Samples (Weight: 0.3)**:
   - For every `SizeChartRow` containing valid height and shoulder ranges:
     - $\text{height} = \frac{H_{\min} + H_{\max}}{2}$
     - $\text{shoulder} = \frac{S_{\min} + S_{\max}}{2}$
     - $\text{weight} = \frac{W_{\min} + W_{\max}}{2}$ (or derived from the real dataset's median BMI if row omits weight).
   - This bootstrap prior anchors the curve before real measurements accumulate.

---

## 3. Size Recommendation & Confidence Rules

Given a school/product size chart:
1. Each size chart row is scored by the **overlap fraction** of the child's 80% range with the row's shoulder bracket:
   $$\text{overlap} = \frac{\max(0, \min(S_{\text{high}}, R_{\max}) - \max(S_{\text{low}}, R_{\min}))}{S_{\text{high}} - S_{\text{low}}}$$
2. **Straddling Rule**: If the 80% range overlaps across two sizes, the system selects the **larger size** as `recommended_size` (providing room for growth) and provides the smaller size as `alt_size`.
3. **Confidence States**:
   - **High**: $\ge 70\%$ of the range falls inside one size **AND** $n_{\text{real}} \ge 30$.
     - *Label*: `"Most children of this height and weight fit this size."`
   - **Medium**: Overlap $\ge 50\%$ or straddling two sizes. (If $n_{\text{real}} < 30$, confidence is capped at Medium).
     - *Label*: `"Good guess. Between sizes we picked the bigger one."` / `"Estimated from height and weight using size charts."`
   - **Low**: Overlap $< 50\%$ or outside chart ranges.
     - *Label*: `"Not sure. Measure the shoulders for an exact fit."`

---

## 4. Retraining & Continuous Learning

- **Management Command**:
  ```bash
  python manage.py train_shoulder_model
  ```
  Runs weighted least squares, performs 5-fold cross validation when $n_{\text{real}} \ge 30$, reports MAE/RMSE, and activates the new version only if performance does not degrade relative to the active model.
- **Automated Celery Beat**:
  Runs every **Sunday at 03:00 IST** via `catalog.tasks.retrain_shoulder_model`.
- **Privacy & Safety**:
  No child names, photos, or identifiers are ever stored in `ShoulderEstimateModel`. Request bodies are never logged.

---

## 5. Honest Physical Limits

An estimate based strictly on height and weight typically carries an absolute uncertainty of **1.5 to 3.0 cm** due to skeletal variation, posture, and body fat distribution.
When exact uniform fit is critical, parents are guided to:
1. Use the in-app **camera measurement tool** (optical computer vision).
2. Measure across the back using a **tailor's tape measure**.
A measured shoulder always supersedes the statistical estimate.
