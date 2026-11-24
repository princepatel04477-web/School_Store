from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

from django.core.management import call_command
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from schools.models import Grade, School

from .kv_catalog import KV_ITEMS, PHOTO_BASE, apply_kv_catalog
from .kv_photos import (
    KV_PHOTOS,
    SUMMER,
    WINTER,
    alt_for_url,
    apply_kv_photos,
    normalise_name,
    thumbnail_for_url,
)
from .models import Category, Product, ProductVariant

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
PRODUCTS_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "products"

# The items that were added by hand on the live store: name, gender, classes, photo they have today.
# The names carry an en dash in the class range, as they do in the live database.
EN = "–"
LIVE_ITEMS = [
    (f"KV Boys Summer Shirt (Class 1{EN}5)", "boy", (1, 5), "kv-boys-1-5-shirt-summer"),
    (f"KV Boys Summer Shirt (Class 6{EN}12)", "boy", (6, 12), "kv-boys-6-12-shirt-summer"),
    (f"KV Boys Winter Full-Sleeve Shirt (Class 1{EN}12)", "boy", (1, 12), "kv-boys-shirt-winter"),
    (f"KV Boys Grey Shorts (Class 1{EN}5)", "boy", (1, 5), "kv-boys-1-5-shorts"),
    (f"KV Boys Grey Trousers (Class 6{EN}12)", "boy", (6, 12), "kv-boys-6-12-trousers"),
    (f"KV Girls Check Tunic (Class 1{EN}2)", "girl", (1, 2), "kv-girls-1-2-tunic"),
    (f"KV Girls Summer Shirt (Class 3{EN}8)", "girl", (3, 8), "kv-girls-3-8-shirt-summer"),
    (f"KV Girls Winter Full-Sleeve Shirt (Class 1{EN}8)", "girl", (1, 8), "kv-girls-shirt-winter"),
    (f"KV Girls Grey Divided Skirt (Class 3{EN}8)", "girl", (3, 8), "kv-girls-3-8-skirt"),
    (f"KV Girls Kurta with Waistcoat (Class 9{EN}12)", "girl", (9, 12), "kv-girls-9-12-kurta"),
    (f"KV Girls Grey Trousers (Class 9{EN}12)", "girl", (9, 12), "kv-girls-9-12-trousers"),
    (f"KV Girls Grey Cardigan (Class 9{EN}12)", "girl", (9, 12), "kv-cardigan-girls-9-12"),
    (f"KV Grey V-Neck Sweater (Class 1{EN}12)", "unisex", (1, 12), "kv-sweater-v-neck"),
]

# These items had no photo on the live store before this change.
WITHOUT_PHOTO_BEFORE = (
    "kv-track-pant-navy", "kv-hooded-jacket-half", "kv-girls-leggings-grey", "kv-socks-navy", "kv-socks-grey",
)

# What the KVS pattern says a child of each class wears as the main garment of the season.
EXPECTED_PRIMARY = {
    SUMMER: {
        "boy": [((1, 5), "kv-boys-1-5-shirt-summer"), ((6, 12), "kv-boys-6-12-shirt-summer")],
        "girl": [
            ((1, 2), "kv-girls-1-2-tunic"),
            ((3, 8), "kv-girls-3-8-shirt-summer"),
            ((9, 12), "kv-girls-9-12-kurta"),
        ],
    },
    WINTER: {
        "boy": [((1, 12), "kv-boys-shirt-winter")],
        # The store sells the winter shirt from Class 1; the KVS pattern has it from Class 3.
        "girl": [((1, 8), "kv-girls-shirt-winter"), ((9, 12), "kv-cardigan-girls-9-12")],
    },
}
# Shown outside the class band the photo was made for (see the note in kv_photos.py).
OUTSIDE_BAND = {("kv-girls-shirt-winter", 1), ("kv-girls-shirt-winter", 2)}


def photo_file(url):
    name = urlparse(url).path.rsplit("/", 1)[-1]
    return name.removesuffix(".webp").removesuffix("-400")


@override_settings(CACHES=LOCMEM)
class KvPhotosTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.kv = School.objects.create(name="Kendriya Vidyalaya", code="CHAIN-KV", active=True)
        apply_kv_catalog(School, Grade, Category, Product, ProductVariant)
        uniform = Category.objects.get(slug="uniform")
        by_class = {int(g.name[6:]): g for g in Grade.objects.filter(name__startswith="Class ")}
        for name, gender, (low, high), photo in LIVE_ITEMS:
            product = Product.objects.create(
                name=name, school=cls.kv, category=uniform, gender=gender,
                class_from=low, class_to=high, cost_price=Decimal("6.00"),
                selling_price=Decimal("10.00"), images=[f"{PHOTO_BASE}{photo}.webp"],
            )
            product.grades.set([by_class[n] for n in range(low, high + 1)])
        for stem in WITHOUT_PHOTO_BEFORE:
            Product.objects.filter(school=cls.kv, images=[f"{PHOTO_BASE}{stem}.webp"]).update(images=[])
        cls.changed = apply_kv_photos(School, Product)

    def kv_products(self):
        return Product.objects.filter(school=self.kv)

    def test_every_photo_is_shipped_at_the_right_size(self):
        for photo in KV_PHOTOS:
            full = PRODUCTS_DIR / f"{photo.file}.webp"
            self.assertTrue(full.exists(), full.name)
            with Image.open(full) as image:
                if photo.replaced:
                    self.assertEqual(image.size, (1000, 1000), full.name)
                else:
                    self.assertEqual(image.width, image.height, full.name)
            if photo.replaced:
                thumb = PRODUCTS_DIR / f"{photo.file}-400.webp"
                self.assertTrue(thumb.exists(), thumb.name)
                with Image.open(thumb) as image:
                    self.assertEqual(image.size, (400, 400), thumb.name)

    def test_photo_names_are_lowercase_kebab_case(self):
        for photo in KV_PHOTOS:
            self.assertRegex(photo.file, r"^[a-z0-9]+(-[a-z0-9]+)*$")

    def test_every_kv_item_has_one_photo_with_alt_text(self):
        self.assertGreater(self.kv_products().count(), 0)
        for product in self.kv_products():
            self.assertEqual(len(product.images), 1, product.name)
            self.assertTrue(alt_for_url(product.images[0]), product.name)

    def test_every_item_in_the_table_exists(self):
        names = {normalise_name(p.name) for p in self.kv_products()}
        for photo in KV_PHOTOS:
            for name in photo.products:
                self.assertIn(normalise_name(name), names)

    def test_new_photos_replace_and_older_photos_stay(self):
        by_name = {normalise_name(p.name): p for p in self.kv_products()}
        coatie = by_name["KV Grey Sleeveless Coatie (Class 6-12)"]
        self.assertEqual(coatie.images, [f"{PHOTO_BASE}kv-coatie-grey.webp"])
        half_jacket = by_name["KV Grey Hooded Jacket, Half Sleeve (Class 1-5)"]
        self.assertEqual(half_jacket.images, [f"{PHOTO_BASE}kv-hooded-jacket-half.webp"])
        # No new photo yet for these: the image they had is untouched.
        self.assertEqual(
            by_name["KV Red House PT T-Shirt (Class 1-5)"].images,
            [f"{PHOTO_BASE}kv-house-tshirt-red.webp"],
        )
        self.assertEqual(
            by_name["KV Boys Summer Shirt (Class 1-5)"].images,
            [f"{PHOTO_BASE}kv-boys-1-5-shirt-summer.webp"],
        )

    def test_running_again_changes_nothing_and_adds_nothing(self):
        count = self.kv_products().count()
        self.assertGreater(self.changed, 0)
        self.assertEqual(apply_kv_photos(School, Product), 0)
        self.assertEqual(self.kv_products().count(), count)

    def test_an_older_photo_never_overwrites_an_image_already_there(self):
        product = Product.objects.get(school=self.kv, name="KV Blue House PT T-Shirt (Class 6-12)")
        product.images = ["https://example.com/custom.webp"]
        product.save()
        try:
            apply_kv_photos(School, Product)
            product.refresh_from_db()
            self.assertEqual(product.images, ["https://example.com/custom.webp"])
        finally:
            product.images = [f"{PHOTO_BASE}kv-house-tshirt-blue.webp"]
            product.save()

    def test_no_kv_school_is_a_no_op(self):
        School.objects.filter(code="CHAIN-KV").delete()
        self.assertEqual(apply_kv_photos(School, Product), 0)

    def test_catalog_items_use_the_photos_in_the_table(self):
        files = {name: photo.file for photo in KV_PHOTOS for name in photo.products}
        for spec in KV_ITEMS:
            self.assertEqual(spec["photo"], f"{files[spec['name']]}.webp", spec["name"])

    def test_items_stay_within_their_photos_class_band(self):
        by_file = {photo.file: photo for photo in KV_PHOTOS}
        for product in self.kv_products():
            photo = by_file[photo_file(product.images[0])]
            low, high = photo.classes
            for number in range(product.class_from, product.class_to + 1):
                if (photo.file, number) in OUTSIDE_BAND:
                    continue
                self.assertTrue(low <= number <= high, f"{product.name}: Class {number} outside {photo.file}")

    def test_thumbnail_is_the_400_file_only_for_photos_that_have_one(self):
        self.assertEqual(
            thumbnail_for_url(f"{PHOTO_BASE}kv-coatie-grey.webp"), f"{PHOTO_BASE}kv-coatie-grey-400.webp"
        )
        # The thumbnail lives next to the stored image, whatever host that is.
        self.assertEqual(
            thumbnail_for_url("http://localhost:5173/products/kv-coatie-grey.webp?v=2"),
            "http://localhost:5173/products/kv-coatie-grey-400.webp",
        )
        self.assertIsNone(thumbnail_for_url(f"{PHOTO_BASE}kv-house-tshirt-red.webp"))
        self.assertIsNone(thumbnail_for_url(f"{PHOTO_BASE}shoes-white-pt.webp"))

    def listed(self, number, gender):
        """Every KV item the store shows for one class and boy/girl, from the public API."""
        client = APIClient()
        path = f"/api/public/products/?school={self.kv.id}&class=Class {number}&gender={gender}"
        items = []
        while path:
            response = client.get(path)
            self.assertEqual(response.status_code, 200, response.content)
            items += response.json()["results"]
            nxt = response.json()["next"]
            path = nxt[nxt.index("/api/"):] if nxt else None
        return [item for item in items if item["school"] == "Kendriya Vidyalaya"]

    def test_api_gives_card_thumbnail_full_image_and_alt(self):
        items = {item["name"]: item for item in self.listed(9, "girl")}
        kurta = next(item for name, item in items.items() if "Kurta" in name)
        self.assertEqual(kurta["thumbnail"], f"{PHOTO_BASE}kv-girls-9-12-kurta-400.webp")
        self.assertEqual(kurta["image"], f"{PHOTO_BASE}kv-girls-9-12-kurta.webp")
        self.assertEqual(kurta["image_alt"], "Kendriya Vidyalaya girls Class IX-XII kurta with grey waistcoat")

    def test_every_class_gender_and_season_has_exactly_one_primary_photo(self):
        by_file = {photo.file: photo for photo in KV_PHOTOS}
        for number in range(1, 13):
            for gender in ("boy", "girl"):
                shown = self.listed(number, gender)
                self.assertGreater(len(shown), 0)
                for item in shown:
                    # Cards and sheet show the same photo, one per item, never a stranger's band.
                    self.assertEqual(photo_file(item["thumbnail"]), photo_file(item["image"]))
                    photo = by_file[photo_file(item["image"])]
                    if (photo.file, number) not in OUTSIDE_BAND:
                        self.assertTrue(photo.classes[0] <= number <= photo.classes[1], (number, item["name"]))
                    self.assertIn(photo.gender, (gender, "unisex"), item["name"])
                for season in (SUMMER, WINTER):
                    primary = sorted(
                        photo_file(item["image"])
                        for item in shown
                        if by_file[photo_file(item["image"])].primary
                        and by_file[photo_file(item["image"])].season == season
                    )
                    expected = [f for (low, high), f in EXPECTED_PRIMARY[season][gender] if low <= number <= high]
                    self.assertEqual(primary, expected, f"Class {number} {gender} {season}")

    def test_girls_in_class_nine_never_see_the_class_one_tunic(self):
        files = {photo_file(item["image"]) for item in self.listed(9, "girl")}
        self.assertNotIn("kv-girls-1-2-tunic", files)
        self.assertNotIn("kv-girls-3-8-shirt-summer", files)
        tunic = {photo_file(item["image"]) for item in self.listed(1, "girl")}
        self.assertIn("kv-girls-1-2-tunic", tunic)
