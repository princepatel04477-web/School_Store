"""
Kendriya Vidyalaya items the store was missing: PT kit, jackets and coatie,
belt, socks and leggings.

Source: the KVS uniform pattern (92nd Board of Governors, 2012, with its
corrigendum), which suppliers still follow:
- PT, all classes: house T-shirt with white collar in red, blue, green or
  sun yellow, and navy track pants with white piping.
- Winter: grey hooded jacket, full or half sleeve, as an option to the grey
  V-neck sweater or cardigan.
- Belt: blue and grey knitted belt with the KV monogram on the buckle.
- Socks: navy with red lining and grey with red lining (summer and winter).
- Girls: plain grey leggings as an option with the tunic or divided skirt.
The sleeveless coatie is not in the KVS pattern; many Vidyalayas sell it as a
layer over the shirt, so it is offered alongside.

Items with photo None show the shop's drawn placeholder until a photo is added.

Sizes follow the store's existing KV items: junior sizes for Classes 1-5,
senior sizes for Classes 6-12. No stock is created; KV stock is set per city
from the panel, as for the KV items already in the store.

Applied by migration 0015. Safe to run again: items are matched by school +
name and variants by SKU, so nothing is duplicated.
"""

from decimal import Decimal

PHOTO_BASE = "https://school-store.aqualite.workers.dev/products/"
KV_CODE = "CHAIN-KV"

JUNIOR = (1, 5)
SENIOR = (6, 12)
ALL_CLASSES = (1, 12)

JUNIOR_SIZES = ["20", "22", "24", "26", "28", "30"]
SENIOR_SIZES = ["28", "30", "32", "34", "36", "38", "40", "42", "44"]
JUNIOR_PANT_SIZES = ["20", "22", "24", "26", "28"]
SENIOR_PANT_SIZES = ["28", "30", "32", "34", "36", "38", "40"]
LEGGING_SIZES = ["20", "22", "24", "26", "28", "30", "32"]

HOUSES = [
    ("Red", "RED", "kv-house-tshirt-red.webp"),
    ("Blue", "BLUE", "kv-house-tshirt-blue.webp"),
    ("Green", "GREEN", "kv-house-tshirt-green.webp"),
    ("Yellow", "YELLOW", "kv-house-tshirt-yellow.webp"),
]

# An earlier import stored the en dash in KV item names as UTF-8 read as
# cp1252 ("Class 1â€“5"). Shown to parents as is, so it is repaired here.
MOJIBAKE_DASH = "â€“"


def _sized(prefix, sizes):
    return [(size, f"{prefix}-{size}") for size in sizes]


def _banded(name, sku, photo, description, junior_price, senior_price, *,
            gender="unisex", category="uniform", junior_sizes=None, senior_sizes=None):
    """One item in two class bands: Classes 1-5 and Classes 6-12."""
    junior_cost = (Decimal(junior_price) * Decimal("0.6")).quantize(Decimal("1.00"))
    senior_cost = (Decimal(senior_price) * Decimal("0.6")).quantize(Decimal("1.00"))
    return [
        {
            "name": f"{name} (Class 1-5)", "category": category, "gender": gender,
            "classes": JUNIOR, "photo": photo, "description": description,
            "cost": str(junior_cost), "price": junior_price,
            "variants": _sized(f"KV-{sku}-JR", junior_sizes or JUNIOR_SIZES),
        },
        {
            "name": f"{name} (Class 6-12)", "category": category, "gender": gender,
            "classes": SENIOR, "photo": photo, "description": description,
            "cost": str(senior_cost), "price": senior_price,
            "variants": _sized(f"KV-{sku}-SR", senior_sizes or SENIOR_SIZES),
        },
    ]


KV_ITEMS = []

for colour, code, photo in HOUSES:
    shade = "sun yellow" if colour == "Yellow" else colour.lower()
    KV_ITEMS += _banded(
        f"KV {colour} House PT T-Shirt", f"PT-TEE-{code}", photo,
        f"Kendriya Vidyalaya {shade} house T-shirt with white collar and white sleeve bands, "
        "for PT and sports days. Wear your child's house colour.",
        "320.00", "390.00",
    )

KV_ITEMS += _banded(
    "KV Navy PT Track Pants", "PT-TRACK", None,
    "Navy blue track pants with white piping down each side and an elastic waist, for PT and sports days.",
    "340.00", "420.00",
    junior_sizes=JUNIOR_PANT_SIZES, senior_sizes=SENIOR_PANT_SIZES,
)
KV_ITEMS += _banded(
    "KV Grey Hooded Jacket, Full Sleeve", "JACKET-FULL", "kv-hooded-jacket-full.webp",
    "Grey zip-front hooded winter jacket with full sleeves and red stripes on the cuffs and hem.",
    "690.00", "790.00",
)
KV_ITEMS += _banded(
    "KV Grey Hooded Jacket, Half Sleeve", "JACKET-HALF", None,
    "Grey zip-front hooded jacket with half sleeves and red stripes on the sleeve ends and hem. "
    "Worn over the shirt in early winter.",
    "590.00", "680.00",
)
KV_ITEMS += _banded(
    "KV Grey Sleeveless Coatie", "COATIE", "kv-coatie-grey.webp",
    "Grey sleeveless coatie with a V-neck, button front, two welt pockets and red piping. "
    "Worn as a layer over the uniform shirt.",
    "450.00", "520.00",
)

KV_ITEMS += [
    {
        "name": "KV Girls Grey Leggings (Class 1-8)", "category": "uniform", "gender": "girl",
        "classes": (1, 8), "photo": None,
        "description": "Plain grey full-length cotton leggings, worn with the tunic or divided skirt.",
        "cost": "160.00", "price": "270.00", "variants": _sized("KV-LEGGINGS", LEGGING_SIZES),
    },
    {
        "name": "KV Knitted Belt with Monogram Buckle", "category": "uniform-accessories",
        "product_type": "BELT", "gender": "unisex", "classes": ALL_CLASSES,
        "photo": "kv-belt-knitted.webp",
        "description": "Blue and grey knitted elastic belt with the Kendriya Vidyalaya monogram on the buckle.",
        "cost": "95.00", "price": "180.00",
        "variants": [("Junior (24 Inch)", "KV-BELT-24"), ("Senior (32 Inch)", "KV-BELT-32")],
    },
    {
        "name": "KV Navy Socks with Red Stripes (Pack of 2)", "category": "uniform-accessories",
        "product_type": "SOCKS", "gender": "unisex", "classes": ALL_CLASSES,
        "photo": None,
        "description": "Navy blue cotton school socks with red stripes at the top. Pack of 2 pairs.",
        "cost": "95.00", "price": "180.00",
        "variants": [("Size 4-6 (Junior)", "KV-SOCK-NAVY-JR"), ("Size 7-9 (Senior)", "KV-SOCK-NAVY-SR")],
    },
    {
        "name": "KV Grey Socks with Red Stripes (Pack of 2)", "category": "uniform-accessories",
        "product_type": "SOCKS", "gender": "unisex", "classes": ALL_CLASSES,
        "photo": None,
        "description": "Grey cotton school socks with red stripes at the top. Pack of 2 pairs.",
        "cost": "95.00", "price": "180.00",
        "variants": [("Size 4-6 (Junior)", "KV-SOCK-GREY-JR"), ("Size 7-9 (Senior)", "KV-SOCK-GREY-SR")],
    },
]


def apply_kv_catalog(School, Grade, Category, Product, ProductVariant):
    """Add the missing KV items and repair garbled KV names. Returns how many items were added."""
    school = School.objects.filter(code=KV_CODE).first()
    if school is None:
        return 0  # directory not imported yet (tests, fresh installs)

    for product in Product.objects.filter(school=school, name__contains=MOJIBAKE_DASH):
        product.name = product.name.replace(MOJIBAKE_DASH, "-")
        product.description = product.description.replace(MOJIBAKE_DASH, "-")
        product.save(update_fields=["name", "description", "updated_at"])
    for product in Product.objects.filter(school=school, description__contains=MOJIBAKE_DASH):
        product.description = product.description.replace(MOJIBAKE_DASH, "-")
        product.save(update_fields=["description", "updated_at"])

    by_class = {}
    for grade in Grade.objects.filter(name__startswith="Class "):
        by_class[int(grade.name[6:])] = grade
    categories = {c.slug: c for c in Category.objects.all()}

    added = 0
    for spec in KV_ITEMS:
        category = categories.get(spec["category"])
        if category is None:
            continue
        product = Product.objects.filter(name=spec["name"], school=school).first()
        if product is None:
            product = Product(name=spec["name"], school=school)
            added += 1
        product.city_id = school.city_id
        product.category = category
        product.product_type = spec.get("product_type")
        product.gender = spec["gender"]
        product.description = spec["description"]
        product.cost_price = Decimal(spec["cost"])
        product.selling_price = Decimal(spec["price"])
        product.images = [PHOTO_BASE + spec["photo"]] if spec["photo"] else []
        product.class_from, product.class_to = spec["classes"]
        product.needs_review = False
        product.active = True
        product.save()
        low, high = spec["classes"]
        product.grades.set([by_class[n] for n in range(low, high + 1) if n in by_class])

        for size, sku in spec["variants"]:
            variant = ProductVariant.objects.filter(sku=sku).first() or ProductVariant(sku=sku)
            variant.product = product
            variant.school_id = school.id
            variant.city_id = school.city_id
            variant.size = size
            variant.active = True
            variant.save()
    return added
