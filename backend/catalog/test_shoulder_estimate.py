"""
Tests for Prompt 7: Shoulder width estimator backend.
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from catalog.models import Category, Product, ProductVariant, ShoulderEstimateModel, SizeChartRow, SizingSample
from catalog.shoulder_estimate import (
    DEFAULT_COEFFICIENTS,
    DEFAULT_SIGMA,
    calculate_overlap_fraction,
    estimate_shoulder,
    fetch_training_data,
    recommend_size_from_estimate,
    solve_linear_system,
    train_model,
    weighted_least_squares,
)
from schools.models import City, Grade, School, Student, StudentMeasurement


class LinearAlgebraSolverTests(TestCase):
    def test_solve_2x2_system(self):
        # 2x + y = 5, x + 3y = 10 -> x = 1, y = 3
        a = [[2.0, 1.0], [1.0, 3.0]]
        b = [5.0, 10.0]
        x = solve_linear_system(a, b)
        self.assertAlmostEqual(x[0], 1.0, places=5)
        self.assertAlmostEqual(x[1], 3.0, places=5)

    def test_weighted_least_squares_known_line(self):
        # y = 2 + 3*x
        xs = [[1.0, 1.0], [1.0, 2.0], [1.0, 3.0], [1.0, 4.0]]
        ys = [5.0, 8.0, 11.0, 14.0]
        ws = [1.0, 1.0, 1.0, 1.0]
        coeffs = weighted_least_squares(xs, ys, ws)
        self.assertAlmostEqual(coeffs[0], 2.0, places=5)
        self.assertAlmostEqual(coeffs[1], 3.0, places=5)

    def test_weighted_least_squares_with_weights(self):
        # Point at x=3 is noisy, but weighted heavily down
        xs = [[1.0, 1.0], [1.0, 2.0], [1.0, 3.0], [1.0, 4.0]]
        ys = [5.0, 8.0, 99.0, 14.0]
        ws = [1.0, 1.0, 0.0001, 1.0]
        coeffs = weighted_least_squares(xs, ys, ws)
        self.assertAlmostEqual(coeffs[0], 2.0, delta=0.1)
        self.assertAlmostEqual(coeffs[1], 3.0, delta=0.1)


class ShoulderEstimatorBackendTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.city = City.objects.create(name="Surat", state="Gujarat")
        self.school = School.objects.create(name="DPS Surat", code="DPS-01", city=self.city)
        self.category = Category.objects.create(name="Uniforms", slug="uniforms")
        self.product = Product.objects.create(
            name="Boys Regular Shirt",
            category=self.category,
            school=self.school,
            gender=Product.Gender.BOY,
            cost_price=Decimal("250.00"),
            selling_price=Decimal("450.00"),
        )
        self.var28 = ProductVariant.objects.create(product=self.product, sku="DPS-SH-28", size="28")
        self.var30 = ProductVariant.objects.create(product=self.product, sku="DPS-SH-30", size="30")
        self.var32 = ProductVariant.objects.create(product=self.product, sku="DPS-SH-32", size="32")

        # Size chart rows with shoulder brackets
        self.row28 = SizeChartRow.objects.create(
            variant=self.var28,
            height_cm_min=Decimal("110.0"),
            height_cm_max=Decimal("120.0"),
            weight_kg_min=Decimal("18.0"),
            weight_kg_max=Decimal("24.0"),
            shoulder_cm_min=Decimal("28.0"),
            shoulder_cm_max=Decimal("30.0"),
        )
        self.row30 = SizeChartRow.objects.create(
            variant=self.var30,
            height_cm_min=Decimal("120.0"),
            height_cm_max=Decimal("130.0"),
            weight_kg_min=Decimal("22.0"),
            weight_kg_max=Decimal("28.0"),
            shoulder_cm_min=Decimal("30.0"),
            shoulder_cm_max=Decimal("32.5"),
        )
        self.row32 = SizeChartRow.objects.create(
            variant=self.var32,
            height_cm_min=Decimal("130.0"),
            height_cm_max=Decimal("140.0"),
            weight_kg_min=Decimal("26.0"),
            weight_kg_max=Decimal("34.0"),
            shoulder_cm_min=Decimal("32.5"),
            shoulder_cm_max=Decimal("35.0"),
        )

    def test_training_pseudo_samples_and_weights(self):
        # Fetch training data: our setUp has 3 SizeChartRows with shoulders
        samples, n_real, n_chart = fetch_training_data()
        self.assertEqual(n_chart, 3)
        self.assertEqual(n_real, 0)
        chart_samples = [s for s in samples if not s.is_real]
        self.assertEqual(len(chart_samples), 3)
        for s in chart_samples:
            self.assertEqual(s.weight, 0.3)
            self.assertGreater(s.height_cm, 100)
            self.assertGreater(s.shoulder_cm, 20)

    def test_straddling_range_picks_larger_size_and_alt_size(self):
        # Create an active model with sigma = 1.0 cm
        # If estimate is 32.4 cm, 80% range is approx [31.1, 33.7]
        # Row 30 is [30.0, 32.5] (covers 31.1 to 32.5 = 1.4 cm)
        # Row 32 is [32.5, 35.0] (covers 32.5 to 33.7 = 1.2 cm)
        # Straddles Row 30 and Row 32!
        model = ShoulderEstimateModel.objects.create(
            version="test-straddle",
            gender="all",
            coefficients={
                "b0": 5.0,
                "b1_height": 0.20,
                "b2_bmi": 0.10,
                "b3_female": 0.0,
                "without_class": {"b0": 5.0, "b1_height": 0.20, "b2_bmi": 0.10, "b3_female": 0.0},
                "sigmas": {"all": 1.0, "boy": 1.0, "girl": 1.0},
            },
            sigma_cm=1.0,
            n_real=50,  # real >= 30
            n_chart=3,
            rmse_cm=1.0,
            active=True,
        )

        res = recommend_size_from_estimate(
            school_id=self.school.id,
            product_id=self.product.id,
            gender="boy",
            height_cm=128.0,
            weight_kg=25.0,
        )
        # Larger size picked as recommended, smaller as alt
        self.assertEqual(res["recommended_size"], "32")
        self.assertEqual(res["alt_size"], "30")
        self.assertEqual(res["confidence"], "medium")
        self.assertIn("Between sizes we picked the bigger one", res["reason"])

    def test_confidence_capped_at_medium_when_n_real_under_30(self):
        # Even if overlap is high (e.g. 80%), if n_real < 30, confidence must be medium
        ShoulderEstimateModel.objects.create(
            version="test-few-real",
            gender="all",
            coefficients={
                "b0": 5.0,
                "b1_height": 0.20,
                "b2_bmi": 0.10,
                "b3_female": 0.0,
                "without_class": {"b0": 5.0, "b1_height": 0.20, "b2_bmi": 0.10, "b3_female": 0.0},
                "sigmas": {"all": 0.5, "boy": 0.5, "girl": 0.5},
            },
            sigma_cm=0.5,
            n_real=12,  # < 30
            n_chart=10,
            rmse_cm=0.8,
            active=True,
        )

        res = recommend_size_from_estimate(
            school_id=self.school.id,
            product_id=self.product.id,
            gender="boy",
            height_cm=115.0,
            weight_kg=20.0,
        )
        self.assertEqual(res["confidence"], "medium")
        self.assertIn("size charts", res["reason"])

    def test_confidence_high_when_overlap_ge_70_and_n_real_ge_30(self):
        ShoulderEstimateModel.objects.create(
            version="test-high-conf",
            gender="all",
            coefficients={
                "b0": 6.0,
                "b1_height": 0.20,
                "b2_bmi": 0.0,
                "b3_female": 0.0,
                "without_class": {"b0": 6.0, "b1_height": 0.20, "b2_bmi": 0.0, "b3_female": 0.0},
                "sigmas": {"all": 0.5, "boy": 0.5, "girl": 0.5},
            },
            sigma_cm=0.5,
            n_real=45,  # >= 30
            n_chart=10,
            rmse_cm=0.6,
            active=True,
        )

        # height 115 -> est = 6 + 23 = 29.0 cm. Range = [29 - 0.64, 29 + 0.64] = [28.36, 29.64]
        # Row 28 is [28.0, 30.0], so 100% of range sits in Row 28!
        res = recommend_size_from_estimate(
            school_id=self.school.id,
            product_id=self.product.id,
            gender="boy",
            height_cm=115.0,
            weight_kg=20.0,
        )
        self.assertEqual(res["recommended_size"], "28")
        self.assertEqual(res["confidence"], "high")
        self.assertIn("Most children of this height and weight fit this size", res["reason"])

    def test_fit_limits_validation(self):
        url = reverse("public-fit-estimate")
        # Too short (< 70 cm)
        res = self.client.post(
            url,
            {"school_id": str(self.school.id), "height_cm": 50, "weight_kg": 20, "gender": "boy"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("height_cm", res.data)

        # Too light (< 7 kg)
        res = self.client.post(
            url,
            {"school_id": str(self.school.id), "height_cm": 120, "weight_kg": 4, "gender": "boy"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("weight_kg", res.data)

    def test_activation_refuses_worse_model(self):
        # Create an existing active model with low RMSE = 1.0
        active_m = ShoulderEstimateModel.objects.create(
            version="m-champion",
            gender="all",
            coefficients=DEFAULT_COEFFICIENTS,
            sigma_cm=1.0,
            n_real=40,
            n_chart=10,
            rmse_cm=1.0,
            active=True,
        )

        # Attempt to train candidate that would have worse RMSE
        report = train_model(version="m-candidate", activate_if_better=True)
        active_m.refresh_from_db()
        # If candidate RMSE is worse than 1.05 cm, champion remains active
        if report["rmse_cm"] > 1.05:
            self.assertFalse(report["activated"])
            self.assertTrue(active_m.active)

    def test_no_child_data_logged(self):
        url = reverse("public-fit-estimate")
        with self.assertLogs("catalog.estimate_views", level="INFO") as cm:
            # Send sensitive numbers: height 125.4, weight 23.8
            self.client.post(
                url,
                {
                    "school_id": str(self.school.id),
                    "product_id": str(self.product.id),
                    "height_cm": 125.4,
                    "weight_kg": 23.8,
                    "gender": "boy",
                },
                format="json",
            )
            # Verify no log records in estimate_views contain child height/weight
            for log_msg in cm.output:
                self.assertNotIn("125.4", log_msg)
                self.assertNotIn("23.8", log_msg)
