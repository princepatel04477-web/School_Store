from pathlib import Path

from django.test import SimpleTestCase

from .images import product_gallery
from .kv_catalog import PHOTO_BASE
from .kv_photos import PLAIN_FILES, plain_first_images, plain_url, thumbnail_for_url

PRODUCTS_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "products"


class PlainFirstImagesTests(SimpleTestCase):
    def test_model_photo_moves_second_behind_the_plain_shot(self):
        model = f"{PHOTO_BASE}kv-boys-1-5-shirt-summer.webp"
        self.assertEqual(
            plain_first_images("KV Boys Summer Shirt (Class 1–5)", [model]),
            [f"{PHOTO_BASE}plain/kv-boys-1-5-shirt-summer.webp", model],
        )

    def test_running_again_changes_nothing(self):
        once = plain_first_images("KV Knitted Belt with Monogram Buckle", [f"{PHOTO_BASE}kv-belt-knitted.webp"])
        self.assertEqual(plain_first_images("KV Knitted Belt with Monogram Buckle", once), once)

    def test_items_without_a_plain_shot_are_left_alone(self):
        self.assertIsNone(plain_first_images("KV Grey Sleeveless Coatie (Class 1-5)", [f"{PHOTO_BASE}kv-coatie-grey.webp"]))
        self.assertIsNone(plain_first_images("Standard Classic School Uniform Tie", [f"{PHOTO_BASE}tie-standard-navy.webp"]))

    def test_hand_added_pt_shirts_get_their_house_colour(self):
        upload = f"{PHOTO_BASE.replace('/products/', '/media/products/')}x/blue-by-mistake.webp"
        for name, colour in [("KV PT Uniform Green", "green"), ("KV PT Uniform Red", "red"), ("KV Uniform Yellow", "yellow")]:
            self.assertEqual(
                plain_first_images(name, [upload]),
                [plain_url(f"kv-house-tshirt-{colour}"), f"{PHOTO_BASE}kv-house-tshirt-{colour}.webp"],
            )

    def test_every_plain_shot_ships_in_two_sizes(self):
        for file in PLAIN_FILES:
            self.assertTrue((PRODUCTS_DIR / "plain" / f"{file}.webp").exists(), file)
            self.assertTrue((PRODUCTS_DIR / "plain" / f"{file}-400.webp").exists(), file)

    def test_gallery_lists_every_photo_with_its_card_file(self):
        images = plain_first_images("KV Boys Grey Shorts (Class 1-5)", [f"{PHOTO_BASE}kv-boys-1-5-shorts.webp"])
        gallery = product_gallery(images)
        self.assertEqual([item["image"] for item in gallery], images)
        self.assertEqual(gallery[0]["thumbnail"], f"{PHOTO_BASE}plain/kv-boys-1-5-shorts-400.webp")
        self.assertEqual(thumbnail_for_url(images[0]), gallery[0]["thumbnail"])
