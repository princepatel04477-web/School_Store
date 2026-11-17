import json
import tempfile
from pathlib import Path

from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import City, School, SchoolBranch

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

DIRECTORY = {
    "chains": {
        "KV": {"name": "Kendriya Vidyalaya", "board": "CBSE", "fit": "Best"},
        "JNV": {"name": "Jawahar Navodaya Vidyalaya", "board": "CBSE", "fit": "Poor"},
    },
    "branches": [
        {
            "maps_place_id": "0x1:0x1", "chain": "KV", "school": "Kendriya Vidyalaya",
            "name": "Kendriya Vidyalaya Aliganj", "state": "Uttar Pradesh", "city": "Lucknow",
            "address": "Sector B, Aliganj, Lucknow, 226024", "pincode": "226024",
            "latitude": 26.8901, "longitude": 80.9462, "phone": "05222321234", "website": "",
        },
        {
            "maps_place_id": "0x1:0x2", "chain": "KV", "school": "Kendriya Vidyalaya",
            "name": "Kendriya Vidyalaya Gomti Nagar", "state": "Uttar Pradesh", "city": "Lucknow",
            "address": "Vipul Khand, Gomti Nagar, Lucknow, 226010", "pincode": "226010",
            "latitude": 26.8553, "longitude": 81.0001, "phone": "", "website": "",
        },
        {
            "maps_place_id": "0x1:0x3", "chain": "KV", "school": "Kendriya Vidyalaya",
            "name": "Kendriya Vidyalaya Hamirpur", "state": "Himachal Pradesh", "city": "Hamirpur",
            "address": "Hamirpur, Himachal Pradesh 177001", "pincode": "177001",
            "latitude": 31.68, "longitude": 76.52, "phone": "", "website": "",
        },
        {
            "maps_place_id": "0x1:0x4", "chain": "KV", "school": "Kendriya Vidyalaya",
            "name": "Kendriya Vidyalaya Hamirpur", "state": "Uttar Pradesh", "city": "Hamirpur",
            "address": "Hamirpur, Uttar Pradesh 210301", "pincode": "210301",
            "latitude": 25.95, "longitude": 80.15, "phone": "", "website": "",
        },
        {
            "maps_place_id": "0x1:0x5", "chain": "JNV", "school": "Jawahar Navodaya Vidyalaya",
            "name": "Jawahar Navodaya Vidyalaya Lucknow", "state": "Uttar Pradesh", "city": "Lucknow",
            "address": "Piparsand, Lucknow", "pincode": "",
            "latitude": 26.7, "longitude": 80.9, "phone": "", "website": "",
        },
    ],
}


def write_directory(data) -> str:
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf8")
    json.dump(data, f)
    f.close()
    return f.name


@override_settings(CACHES=LOCMEM)
class ImportSchoolDirectoryTests(TestCase):
    def setUp(self):
        self.path = write_directory(DIRECTORY)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_imports_one_school_per_chain_with_a_branch_per_campus(self):
        call_command("import_school_directory", self.path, verbosity=0)

        kv = School.objects.get(code="CHAIN-KV")
        self.assertTrue(kv.active)
        self.assertIsNone(kv.city_id)
        lucknow = City.objects.get(state="Uttar Pradesh", name="Lucknow")
        self.assertEqual(kv.branches.filter(city=lucknow).count(), 2)
        aliganj = SchoolBranch.objects.get(maps_place_id="0x1:0x1")
        self.assertEqual(aliganj.pincode, "226024")
        self.assertEqual(aliganj.display_name, "Kendriya Vidyalaya Aliganj")

    def test_same_city_name_in_two_states_makes_two_cities(self):
        call_command("import_school_directory", self.path, verbosity=0)
        hamirpurs = City.objects.filter(name="Hamirpur")
        self.assertEqual({c.state for c in hamirpurs}, {"Himachal Pradesh", "Uttar Pradesh"})
        self.assertEqual(len({c.code for c in hamirpurs}), 2)

    def test_poor_fit_chains_are_created_inactive(self):
        call_command("import_school_directory", self.path, verbosity=0)
        self.assertFalse(School.objects.get(code="CHAIN-JNV").active)

    def test_running_again_updates_rows_and_keeps_owner_changes(self):
        call_command("import_school_directory", self.path, verbosity=0)
        branch = SchoolBranch.objects.get(maps_place_id="0x1:0x1")
        branch.active = False
        branch.save()

        changed = json.loads(json.dumps(DIRECTORY))
        changed["branches"][0]["phone"] = "05220000000"
        Path(self.path).write_text(json.dumps(changed), encoding="utf8")
        call_command("import_school_directory", self.path, verbosity=0)

        branch.refresh_from_db()
        self.assertEqual(branch.phone, "05220000000")
        self.assertFalse(branch.active)
        self.assertEqual(SchoolBranch.objects.filter(maps_place_id__startswith="0x1:").count(), 5)

    def test_dry_run_writes_nothing(self):
        call_command("import_school_directory", self.path, "--dry-run", verbosity=0)
        self.assertFalse(SchoolBranch.objects.filter(maps_place_id__startswith="0x1:").exists())
        self.assertFalse(School.objects.filter(code="CHAIN-KV").exists())

    def test_branch_names_are_unique_within_school_and_city(self):
        call_command("import_school_directory", self.path, verbosity=0)
        branch = SchoolBranch.objects.get(maps_place_id="0x1:0x1")
        with self.assertRaises(IntegrityError), transaction.atomic():
            SchoolBranch.objects.create(school=branch.school, city=branch.city, name=branch.name)


@override_settings(CACHES=LOCMEM)
class PublicBranchPickerTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        path = write_directory(DIRECTORY)
        call_command("import_school_directory", path, verbosity=0)
        Path(path).unlink()
        cls.kv = School.objects.get(code="CHAIN-KV")
        cls.lucknow = City.objects.get(state="Uttar Pradesh", name="Lucknow")

    def setUp(self):
        self.client = APIClient()

    def test_states_list_only_states_with_open_branches(self):
        res = self.client.get("/api/public/states/")
        self.assertEqual(res.status_code, 200)
        by_name = {s["name"]: s["city_count"] for s in res.json()}
        self.assertEqual(by_name["Uttar Pradesh"], 2)
        self.assertEqual(by_name["Himachal Pradesh"], 1)

    def test_cities_in_a_state_count_open_branches(self):
        res = self.client.get("/api/public/cities/", {"state": "Uttar Pradesh"})
        self.assertEqual(res.status_code, 200)
        by_name = {c["name"]: c["branch_count"] for c in res.json()}
        # The Lucknow JNV belongs to an inactive school, so it is not counted.
        self.assertEqual(by_name, {"Hamirpur": 1, "Lucknow": 2})

    def test_cities_need_a_state(self):
        self.assertEqual(self.client.get("/api/public/cities/").status_code, 400)

    def test_branches_in_a_city_carry_their_school(self):
        res = self.client.get(f"/api/public/cities/{self.lucknow.id}/branches/")
        self.assertEqual(res.status_code, 200)
        rows = res.json()
        self.assertEqual([r["name"] for r in rows], ["Kendriya Vidyalaya Aliganj", "Kendriya Vidyalaya Gomti Nagar"])
        self.assertEqual(rows[0]["school"]["id"], str(self.kv.id))
        self.assertEqual(rows[0]["pincode"], "226024")

    def test_branch_search_matches_area_and_pincode(self):
        url = f"/api/public/cities/{self.lucknow.id}/branches/"
        self.assertEqual([r["name"] for r in self.client.get(url, {"search": "gomti"}).json()],
                         ["Kendriya Vidyalaya Gomti Nagar"])
        self.assertEqual([r["name"] for r in self.client.get(url, {"search": "226024"}).json()],
                         ["Kendriya Vidyalaya Aliganj"])

    def test_closed_branch_drops_out_after_cache(self):
        url = f"/api/public/cities/{self.lucknow.id}/branches/"
        self.assertEqual(len(self.client.get(url).json()), 2)
        SchoolBranch.objects.filter(maps_place_id="0x1:0x2").first().delete()
        self.assertEqual(len(self.client.get(url).json()), 1)

    def test_school_filter_limits_every_level(self):
        other = School.objects.create(name="Other School", code="OTHER-1")
        SchoolBranch.objects.create(school=other, city=self.lucknow, name="Other School Lucknow")
        q = {"school": str(self.kv.id)}
        self.assertEqual(len(self.client.get(f"/api/public/cities/{self.lucknow.id}/branches/").json()), 3)
        self.assertEqual(len(self.client.get(f"/api/public/cities/{self.lucknow.id}/branches/", q).json()), 2)
        cities = self.client.get("/api/public/cities/", {"state": "Uttar Pradesh", **q}).json()
        self.assertEqual({c["name"]: c["branch_count"] for c in cities}["Lucknow"], 2)
        self.assertEqual(self.client.get("/api/public/states/", {"school": "nope"}).status_code, 400)

    def test_products_use_the_branch_city_for_a_chain_school(self):
        from .models import Grade

        call_command("seed_data", verbosity=0)
        grade = Grade.objects.order_by("sort_order").first()
        res = self.client.get("/api/public/products/", {
            "school": str(self.kv.id), "city": str(self.lucknow.id), "grade": str(grade.id), "gender": "boy",
        })
        self.assertEqual(res.status_code, 200)
        other_city = City.objects.get(code="SUR")
        res = self.client.get("/api/public/products/", {
            "school": str(self.kv.id), "city": str(other_city.id), "grade": str(grade.id), "gender": "boy",
        })
        self.assertEqual(res.status_code, 400)


UDISE_ONLY = {
    "maps_place_id": None, "source": "udise", "chain": "KV", "school": "Kendriya Vidyalaya",
    "name": "PM SHRI Kendriya Vidyalaya Amc Lucknow", "state": "Uttar Pradesh", "city": "Lucknow",
    "address": "Lucknow, Uttar Pradesh 226002", "pincode": "226002", "latitude": None, "longitude": None,
    "phone": "", "website": "", "udise_code": "09270918001",
}


@override_settings(CACHES=LOCMEM)
class UdiseCodeImportTests(TestCase):
    def directory(self, *extra, aliganj_code="09270900001"):
        data = json.loads(json.dumps(DIRECTORY))
        data["branches"][0]["udise_code"] = aliganj_code
        data["branches"] += list(extra)
        return write_directory(data)

    def test_udise_only_branch_has_no_location(self):
        path = self.directory(UDISE_ONLY)
        call_command("import_school_directory", path, verbosity=0)
        Path(path).unlink()
        branch = SchoolBranch.objects.get(udise_code="09270918001")
        self.assertIsNone(branch.maps_place_id)
        self.assertIsNone(branch.latitude)
        self.assertEqual(branch.city.name, "Lucknow")

    def test_rerun_matches_on_udise_code_when_the_place_id_changes(self):
        path = self.directory()
        call_command("import_school_directory", path, verbosity=0)
        data = json.loads(Path(path).read_text(encoding="utf8"))
        data["branches"][0]["maps_place_id"] = "0x9:0x9"
        Path(path).write_text(json.dumps(data), encoding="utf8")
        call_command("import_school_directory", path, verbosity=0)
        Path(path).unlink()
        branch = SchoolBranch.objects.get(udise_code="09270900001")
        self.assertEqual(branch.maps_place_id, "0x9:0x9")
        self.assertEqual(SchoolBranch.objects.filter(name="Kendriya Vidyalaya Aliganj").count(), 1)

    def test_deactivate_missing_switches_off_branches_that_left_the_file(self):
        path = self.directory()
        call_command("import_school_directory", path, verbosity=0)
        data = json.loads(Path(path).read_text(encoding="utf8"))
        data["branches"] = [b for b in data["branches"] if b["maps_place_id"] != "0x1:0x2"]
        Path(path).write_text(json.dumps(data), encoding="utf8")
        call_command("import_school_directory", path, "--deactivate-missing", verbosity=0)
        Path(path).unlink()
        self.assertFalse(SchoolBranch.objects.get(maps_place_id="0x1:0x2").active)
        self.assertTrue(SchoolBranch.objects.get(maps_place_id="0x1:0x1").active)

    def test_branches_endpoint_returns_and_searches_the_code(self):
        path = self.directory(UDISE_ONLY)
        call_command("import_school_directory", path, verbosity=0)
        Path(path).unlink()
        city = City.objects.get(state="Uttar Pradesh", name="Lucknow")
        url = f"/api/public/cities/{city.id}/branches/"
        rows = APIClient().get(url).json()
        self.assertIn("09270918001", [r["udise_code"] for r in rows])
        found = APIClient().get(url, {"search": "0927091"}).json()
        self.assertEqual([r["udise_code"] for r in found], ["09270918001"])
