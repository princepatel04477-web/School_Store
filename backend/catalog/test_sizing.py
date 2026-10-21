from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from .models import ProductVariant, SizeChartRow
from .sizing import (
    HEIGHT_MAX,
    HEIGHT_MIN,
    WEIGHT_MAX,
    WEIGHT_MIN,
    ChartRow,
    FitWarning,
    Recommendation,
    Status,
    class_age,
    recommend_size,
    refine_with_shoulder,
    suggest,
    validate_fit,
)

D = Decimal


def row(size, h_min, h_max, w_min=None, w_max=None):
    return ChartRow(
        size=size,
        height_cm_min=D(h_min),
        height_cm_max=D(h_max),
        weight_kg_min=D(w_min) if w_min is not None else None,
        weight_kg_max=D(w_max) if w_max is not None else None,
    )


# A shirt chart with no overlaps and a gap between 30 and 32.
CHART = [
    row("28", 116, 128, 18, 26),
    row("30", 129, 140, 24, 34),
    row("32", 146, 155, 32, 45),
    row("34", 156, 168, 42, 58),
]


class RecommendSizeTests(SimpleTestCase):
    def test_height_and_weight_inside_one_size(self):
        self.assertEqual(recommend_size(CHART, D(135), D(30)), (Status.FIT, "30", ""))

    def test_chart_order_does_not_matter(self):
        self.assertEqual(recommend_size(list(reversed(CHART)), D(135), D(30)).size, "30")

    def test_exact_boundaries_are_inside(self):
        self.assertEqual(recommend_size(CHART, D(129), D(24)).size, "30")
        self.assertEqual(recommend_size(CHART, D(140), D(34)).size, "30")

    def test_height_in_gap_between_sizes_gives_both_bigger_first(self):
        result = recommend_size(CHART, D(143), D(33))
        self.assertEqual(result, (Status.BETWEEN, "32", "30"))

    def test_heavier_than_the_size_height_points_to_moves_up_one(self):
        # Height says 30, weight 36 kg is above 30's 34 kg maximum.
        self.assertEqual(recommend_size(CHART, D(135), D(36)), (Status.BETWEEN, "32", "30"))

    def test_lighter_child_is_never_pushed_down(self):
        # 14 kg is below every range; height alone decides.
        self.assertEqual(recommend_size(CHART, D(135), D(14)), (Status.FIT, "30", ""))

    def test_overlapping_ranges_give_both_sizes_bigger_first(self):
        chart = [row("S", 120, 135), row("M", 130, 145), row("L", 140, 155)]
        self.assertEqual(recommend_size(chart, D(132), D(28)), (Status.BETWEEN, "M", "S"))

    def test_touching_ranges_count_as_between(self):
        chart = [row("30", 130, 140), row("32", 140, 150)]
        self.assertEqual(recommend_size(chart, D(140), None), (Status.BETWEEN, "32", "30"))

    def test_weight_settles_an_overlap(self):
        chart = [row("S", 120, 135, 20, 27), row("M", 130, 145, 26, 36)]
        self.assertEqual(recommend_size(chart, D(132), D(30)), (Status.FIT, "M", ""))

    def test_three_overlapping_sizes_keep_the_two_closest(self):
        chart = [row("S", 120, 150), row("M", 130, 160), row("L", 140, 170)]
        # Centres are 135, 145, 155: a 141 cm child is nearest M then S.
        self.assertEqual(recommend_size(chart, D(141), None), (Status.BETWEEN, "M", "S"))

    def test_shorter_than_the_chart(self):
        self.assertEqual(recommend_size(CHART, D(100), D(16)), (Status.BELOW_CHART, "28", ""))

    def test_taller_than_the_chart(self):
        self.assertEqual(recommend_size(CHART, D(180), D(60)), (Status.ABOVE_CHART, "34", ""))

    def test_heavier_than_the_biggest_size(self):
        self.assertEqual(recommend_size(CHART, D(160), D(70)), (Status.ABOVE_CHART, "34", ""))

    def test_gap_and_heavier_than_the_size_above(self):
        self.assertEqual(recommend_size(CHART, D(143), D(50)), (Status.BETWEEN, "34", "32"))

    def test_rows_without_weight_use_height_only(self):
        chart = [row("22", 110, 122), row("24", 123, 134)]
        self.assertEqual(recommend_size(chart, D(125), D(90)), (Status.FIT, "24", ""))

    def test_weight_not_given(self):
        self.assertEqual(recommend_size(CHART, D(150), None), (Status.FIT, "32", ""))

    def test_no_chart_for_product(self):
        self.assertEqual(recommend_size([], D(135), D(30)), (Status.NO_CHART, "", ""))

    def test_one_row_chart(self):
        chart = [row("Free", 100, 180)]
        self.assertEqual(recommend_size(chart, D(150), D(40)).status, Status.FIT)
        self.assertEqual(recommend_size(chart, D(95), D(14)).status, Status.BELOW_CHART)


class ValidateFitTests(SimpleTestCase):
    def test_typical_child_passes_without_warnings(self):
        check = validate_fit("132", "28", "Class 4")
        self.assertTrue(check.ok)
        self.assertEqual((check.height_cm, check.weight_kg), (D("132.0"), D("28.0")))
        self.assertEqual(check.warnings, [])

    def test_numbers_and_strings_are_both_accepted(self):
        self.assertTrue(validate_fit(132.5, 28, None).ok)
        self.assertEqual(validate_fit(" 132.46 ", "28", None).height_cm, D("132.5"))

    def test_limits_are_inclusive(self):
        self.assertTrue(validate_fit(HEIGHT_MIN, WEIGHT_MIN).ok)
        self.assertTrue(validate_fit(HEIGHT_MAX, WEIGHT_MAX).ok)

    def test_out_of_range(self):
        check = validate_fit(HEIGHT_MAX + 1, WEIGHT_MIN - 1)
        self.assertEqual(check.errors, {"height_cm": "OUT_OF_RANGE", "weight_kg": "OUT_OF_RANGE"})
        # A height typed in metres or a weight in grams is caught too.
        self.assertEqual(validate_fit("1.32", "28").errors, {"height_cm": "OUT_OF_RANGE"})
        self.assertEqual(validate_fit("132", "28000").errors, {"weight_kg": "OUT_OF_RANGE"})

    def test_zero_and_negative(self):
        self.assertEqual(validate_fit(0, -5).errors, {"height_cm": "OUT_OF_RANGE", "weight_kg": "OUT_OF_RANGE"})

    def test_missing_and_not_a_number(self):
        self.assertEqual(validate_fit("", None).errors, {"height_cm": "REQUIRED", "weight_kg": "REQUIRED"})
        self.assertEqual(
            validate_fit("tall", "NaN").errors,
            {"height_cm": "NOT_A_NUMBER", "weight_kg": "NOT_A_NUMBER"},
        )
        self.assertEqual(validate_fit(True, "Infinity").errors["height_cm"], "NOT_A_NUMBER")
        self.assertEqual(validate_fit("132", "Infinity").errors, {"weight_kg": "NOT_A_NUMBER"})

    def test_height_unusual_for_class_is_a_warning_not_an_error(self):
        check = validate_fit(175, 40, "Class 1")
        self.assertTrue(check.ok)
        self.assertIn(FitWarning.HEIGHT_UNUSUAL_FOR_CLASS, check.warnings)

    def test_weight_unusual_for_class(self):
        check = validate_fit(165, 110, "Class 10")
        self.assertIn(FitWarning.WEIGHT_UNUSUAL_FOR_CLASS, check.warnings)
        self.assertNotIn(FitWarning.HEIGHT_UNUSUAL_FOR_CLASS, check.warnings)

    def test_height_and_weight_unusual_together(self):
        check = validate_fit(190, 15, None)
        self.assertEqual(check.warnings, [FitWarning.HEIGHT_WEIGHT_UNUSUAL])

    def test_unknown_class_skips_class_warnings(self):
        self.assertEqual(validate_fit(175, 40, "Class 99").warnings, [])

    def test_class_age(self):
        self.assertEqual(class_age("Nursery"), 3)
        self.assertEqual(class_age("5"), 10)
        self.assertEqual(class_age("Class 12"), 17)
        self.assertIsNone(class_age(""))


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class PublicSizeFitEndpointTests(TestCase):
    URL = "/api/public/size-fit/"

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.shirt = ProductVariant.objects.get(sku="DPS-SHIRT-30").product
        cls.polo = ProductVariant.objects.get(sku="FHS-POLO-S").product
        for i, variant in enumerate(cls.shirt.variants.order_by("sku")):
            SizeChartRow.objects.create(
                variant=variant,
                height_cm_min=116 + i * 12,
                height_cm_max=127 + i * 12,
                weight_kg_min=18 + i * 8,
                weight_kg_max=26 + i * 8,
                chest_cm_min=60 + i * 4,
                chest_cm_max=63 + i * 4,
            )

    def setUp(self):
        cache.clear()

    def post(self, body):
        return APIClient().post(self.URL, body, format="json")

    def test_chart_and_recommendation_per_product(self):
        res = self.post({
            "products": [str(self.shirt.id), str(self.polo.id)],
            "height_cm": 133,
            "weight_kg": 30,
            "class": "Class 4",
        })
        self.assertEqual(res.status_code, 200, res.data)
        shirt = res.data["products"][str(self.shirt.id)]
        self.assertEqual([r["size"] for r in shirt["chart"]][:2], ["28 (Class 1-3)", "30 (Class 4-6)"])
        self.assertEqual(shirt["chart"][1]["chest_cm_min"], 64.0)
        self.assertEqual(shirt["recommendation"], {"status": "FIT", "size": "30 (Class 4-6)", "alt_size": ""})
        polo = res.data["products"][str(self.polo.id)]
        self.assertEqual(polo, {"chart": [], "recommendation": {"status": "NO_CHART", "size": "", "alt_size": ""}})
        self.assertEqual(res.data["fit"], {"height_cm": 133.0, "weight_kg": 30.0, "shoulder_cm": None, "warnings": []})

    def test_chart_only_when_no_measurements(self):
        res = self.post({"products": [str(self.shirt.id)]})
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["fit"])
        self.assertIsNone(res.data["products"][str(self.shirt.id)]["recommendation"])
        self.assertEqual(len(res.data["products"][str(self.shirt.id)]["chart"]), 4)

    def test_switched_off_sizes_are_left_out(self):
        ProductVariant.objects.filter(sku="DPS-SHIRT-34").update(active=False)
        res = self.post({"products": [str(self.shirt.id)]})
        self.assertEqual(len(res.data["products"][str(self.shirt.id)]["chart"]), 3)

    def test_bad_input_is_refused(self):
        self.assertEqual(self.post({"products": []}).status_code, 400)
        self.assertEqual(self.post({"products": ["nope"]}).status_code, 400)
        self.assertEqual(self.post({"products": [str(self.shirt.id)] * 61}).status_code, 400)
        res = self.post({"products": [str(self.shirt.id)], "height_cm": 300, "weight_kg": 30})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["height_cm"], ["OUT_OF_RANGE"])
        res = self.post({"products": [str(self.shirt.id)], "height_cm": 130})
        self.assertEqual(res.data["weight_kg"], ["REQUIRED"])

    def test_shoulder_is_accepted_and_returned(self):
        res = self.post({
            "products": [str(self.shirt.id)], "height_cm": 133, "weight_kg": 30,
            "shoulder_cm": 31.2, "shoulder_confidence": 0.8,
        })
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["fit"]["shoulder_cm"], 31.2)
        # Typed by hand from a tape measure: no confidence, still accepted.
        res = self.post({"products": [str(self.shirt.id)], "height_cm": 133, "weight_kg": 30, "shoulder_cm": 31.2})
        self.assertEqual(res.data["fit"]["shoulder_cm"], 31.2)

    def test_soft_warnings_are_returned(self):
        res = self.post({"products": [str(self.shirt.id)], "height_cm": 175, "weight_kg": 40, "class": "Class 1"})
        self.assertEqual(res.status_code, 200)
        self.assertIn(FitWarning.HEIGHT_UNUSUAL_FOR_CLASS, res.data["fit"]["warnings"])


def srow(size, h_min, h_max, s_min=None, s_max=None):
    return ChartRow(
        size=size,
        height_cm_min=D(h_min),
        height_cm_max=D(h_max),
        shoulder_cm_min=D(s_min) if s_min is not None else None,
        shoulder_cm_max=D(s_max) if s_max is not None else None,
    )


SHOULDER_CHART = [srow("30", 129, 140, 28, 31), srow("32", 141, 152, 31.5, 34), srow("34", 153, 165, 34.5, 38)]


class ShoulderTests(SimpleTestCase):
    def test_shoulder_is_optional(self):
        check = validate_fit(135, 30)
        self.assertTrue(check.ok)
        self.assertIsNone(check.shoulder_cm)

    def test_shoulder_needs_sane_numbers_and_confidence_is_optional(self):
        typed = validate_fit(135, 30, shoulder_cm=31)
        self.assertTrue(typed.ok)
        self.assertEqual((typed.shoulder_cm, typed.shoulder_confidence), (D("31.0"), None))
        self.assertEqual(validate_fit(135, 30, shoulder_confidence=0.8).errors, {"shoulder_cm": "REQUIRED"})
        self.assertEqual(
            validate_fit(135, 30, shoulder_cm=95, shoulder_confidence=1.5).errors,
            {"shoulder_cm": "OUT_OF_RANGE", "shoulder_confidence": "OUT_OF_RANGE"},
        )
        self.assertEqual(
            validate_fit(135, 30, shoulder_cm="wide", shoulder_confidence=0.9).errors,
            {"shoulder_cm": "NOT_A_NUMBER"},
        )
        check = validate_fit(135, 30, shoulder_cm="31.26", shoulder_confidence="0.8126")
        self.assertEqual((check.shoulder_cm, check.shoulder_confidence), (D("31.3"), D("0.813")))

    def test_two_sizes_and_the_shoulder_fits_one(self):
        between = Recommendation(Status.BETWEEN, "32", "30")
        self.assertEqual(refine_with_shoulder(SHOULDER_CHART, between, D(29)), (Status.FIT, "30", ""))
        self.assertEqual(refine_with_shoulder(SHOULDER_CHART, between, D(33)), (Status.FIT, "32", ""))
        # Fits neither: leave the choice to the parent.
        self.assertEqual(refine_with_shoulder(SHOULDER_CHART, between, D(40)), between)

    def test_one_size_but_wider_shoulders_adds_the_next_size(self):
        fit = Recommendation(Status.FIT, "30")
        self.assertEqual(refine_with_shoulder(SHOULDER_CHART, fit, D(32.5)), (Status.BETWEEN, "32", "30"))
        self.assertEqual(refine_with_shoulder(SHOULDER_CHART, fit, D(30)), fit)
        biggest = Recommendation(Status.FIT, "34")
        self.assertEqual(refine_with_shoulder(SHOULDER_CHART, biggest, D(40)), biggest)

    def test_chart_without_shoulder_ranges_is_unchanged(self):
        chart = [srow("30", 129, 140), srow("32", 141, 152)]
        between = Recommendation(Status.BETWEEN, "32", "30")
        self.assertEqual(refine_with_shoulder(chart, between, D(29)), between)
        self.assertEqual(refine_with_shoulder(chart, Recommendation(Status.FIT, "30"), D(40)), (Status.FIT, "30", ""))

    def test_suggest_ignores_the_shoulder_until_switched_on(self):
        check = validate_fit(135, 30, shoulder_cm=32.5, shoulder_confidence=0.9)
        with override_settings(FIT_USE_SHOULDER=False):
            self.assertEqual(suggest(SHOULDER_CHART, check), (Status.FIT, "30", ""))
        with override_settings(FIT_USE_SHOULDER=True, FIT_SHOULDER_MIN_CONFIDENCE=0.6):
            self.assertEqual(suggest(SHOULDER_CHART, check), (Status.BETWEEN, "32", "30"))
        unsure = validate_fit(135, 30, shoulder_cm=32.5, shoulder_confidence=0.4)
        with override_settings(FIT_USE_SHOULDER=True, FIT_SHOULDER_MIN_CONFIDENCE=0.6):
            self.assertEqual(suggest(SHOULDER_CHART, unsure), (Status.FIT, "30", ""))


class MeasureConfigTests(TestCase):
    def test_phone_reads_the_shoulder_calibration_factor(self):
        with override_settings(SHOULDER_CALIBRATION_FACTOR=1.08):
            res = APIClient().get("/api/public/measure-config/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"shoulder_calibration_factor": 1.08})
