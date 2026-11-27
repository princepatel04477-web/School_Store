import json
import re
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import City, School, SchoolBranch

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
FILE = Path(__file__).resolve().parent / "data" / "gujarat_kv_schools.json"


class GujaratKendriyaVidyalayaFile(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.data = json.loads(FILE.read_text(encoding="utf8"))

    def test_file_lists_all_47_schools_in_gujarat(self):
        branches = self.data["branches"]
        self.assertEqual(len(branches), 47)
        self.assertEqual({b["state"] for b in branches}, {"Gujarat"})
        self.assertEqual({b["chain"] for b in branches}, {"KV"})
        names = [b["name"] for b in branches]
        self.assertEqual(len(names), len(set(names)))

    def test_every_udise_code_is_unique_and_only_the_2026_campus_has_none(self):
        codes = [b["udise_code"] for b in self.data["branches"] if b["udise_code"]]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertTrue(all(re.fullmatch(r"24\d{9}", c) for c in codes))
        none = [b["name"] for b in self.data["branches"] if not b["udise_code"]]
        self.assertEqual(none, ["Kendriya Vidyalaya 100 Bn. CRPF Vastral"])

    def test_every_branch_has_a_city_district_pincode_and_website(self):
        for b in self.data["branches"]:
            self.assertTrue(b["city"] and b["district"], b["name"])
            self.assertTrue(b["website"].startswith("https://"), b["name"])
            if b["udise_code"]:
                self.assertRegex(b["pincode"], r"^\d{6}$", b["name"])
                self.assertTrue(b["address"].endswith(b["pincode"]), b["name"])

    def test_positions_that_are_given_lie_in_gujarat(self):
        for b in self.data["branches"]:
            if b["latitude"] is None:
                self.assertIsNone(b["longitude"])
                continue
            self.assertTrue(20.0 <= b["latitude"] <= 25.0, b["name"])
            self.assertTrue(68.0 <= b["longitude"] <= 74.6, b["name"])

    @override_settings(CACHES=LOCMEM)
    def test_import_makes_the_schools_show_in_the_state_city_branch_picker(self):
        call_command("import_school_directory", str(FILE), verbosity=0)
        self.assertEqual(SchoolBranch.objects.filter(school__code="CHAIN-KV").count(), 47)
        self.assertEqual(SchoolBranch.objects.exclude(udise_code=None).count(), 46)
        self.assertTrue(School.objects.get(code="CHAIN-KV").active)
        # Hazira and Vastral are areas of Surat and Ahmedabad, not cities of their own.
        self.assertFalse(City.objects.filter(state="Gujarat", name__in=["Hazira", "Vastral"]).exists())
        surat = City.objects.get(state="Gujarat", name="Surat")
        self.assertEqual(SchoolBranch.objects.filter(city=surat).count(), 3)

        client = APIClient()
        states = client.get("/api/public/states/").json()
        gujarat = next(s for s in states if s["name"] == "Gujarat")
        self.assertGreaterEqual(gujarat["city_count"], 25)
        cities = client.get("/api/public/cities/", {"state": "Gujarat"}).json()
        ahmedabad = next(c for c in cities if c["name"] == "Ahmedabad")
        branches = client.get(f"/api/public/cities/{ahmedabad['id']}/branches/").json()
        names = {b["name"] for b in branches}
        self.assertIn("Kendriya Vidyalaya Sabarmati", names)
        self.assertIn("Kendriya Vidyalaya 100 Bn. CRPF Vastral", names)

    @override_settings(CACHES=LOCMEM)
    def test_import_twice_changes_nothing(self):
        call_command("import_school_directory", str(FILE), verbosity=0)
        call_command("import_school_directory", str(FILE), verbosity=0)
        self.assertEqual(SchoolBranch.objects.filter(school__code="CHAIN-KV").count(), 47)
