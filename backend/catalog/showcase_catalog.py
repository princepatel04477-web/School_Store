"""
Real photos for every store item, and each school's full uniform set.

The photos are part of the React build, so the Cloudflare Worker serves them
from PHOTO_BASE. Applied by migration 0011 (live database) and by
``seed_data`` (fresh databases). Safe to run again: items are matched by
school + name and SKUs, so nothing is duplicated, and existing stock counts
are never changed.

``apply_showcase_catalog`` takes the model classes so the migration can pass
its historical models; it does not rely on the models' save() side effects.
"""

from decimal import Decimal

PHOTO_BASE = "https://school-store.aqualite.workers.dev/products/"

# Items already in the store: (school code or None for general items, name) -> photo
EXISTING_PHOTOS = {
    ("DPS-SUR", "DPS Everyday Formal Half-Sleeve Shirt"): "uniform-dps-shirt.webp",
    ("FHS-SUR", "Fountainhead Signature Polo Tee"): "uniform-fhs-polo.webp",
    ("UDG-AMD", "Udgam Ceremonial Winter Blazer"): "uniform-udgam-blazer.webp",
    (None, "All-Weather Black Velcro School Shoes"): "shoes-black-velcro.webp",
    ("DPS-SUR", "DPS Formal Black Oxford Shoes"): "shoes-dps-oxford.webp",
    (None, "Action White PT Sports Shoes"): "shoes-white-pt.webp",
    ("DPS-SUR", "DPS Cotton Ribbed School Socks (Pack of 3)"): "socks-dps.webp",
    (None, "Standard Plain Navy School Socks (Pack of 2)"): "socks-navy.webp",
    (None, "Standard Elastic School Uniform Belt"): "belt-elastic-standard.webp",
    ("DPS-SUR", "DPS Monogrammed Leatherette School Belt"): "belt-dps-leatherette.webp",
    ("UDG-AMD", "Udgam Woven Crest School Tie"): "tie-udgam-crest.webp",
    ("DPS-SUR", "DPS Official Crest School Tie"): "tie-dps-crest.webp",
    (None, "Standard Classic School Uniform Tie"): "tie-standard-navy.webp",
    (None, "Personalised Photo Notebook Pack (Set of 6)"): "notebook-photo.webp",
    (None, "Smart RFID PVC Student ID Card with Lanyard"): "idcard.webp",
}

# The junior girls' pinafore becomes the box-pleated skirt Indian schools use.
RENAMED = {
    ("DPS-SUR", "DPS Girls Pleated Pinafore (Class 1-5)"): "DPS Girls Box-Pleated Skirt",
}

SHIRT_SIZES = ["26", "28", "30", "32", "34", "36"]
WAIST_SIZES = ["22", "24", "26", "28", "30", "32"]
SKIRT_SIZES = ["22", "24", "26", "28", "30"]


def _sized(prefix, sizes, qty):
    return [(size, f"{prefix}-{size}", qty) for size in sizes]


# Each school's full set. classes = (from, to) for "Class N" grades.
UNIFORM_SETS = [
    # Delhi Public School Surat: white shirt, grey bottoms, bottle green tie
    {
        "school": "DPS-SUR", "category": "uniform", "gender": "girl", "classes": (1, 8),
        "name": "DPS Girls Box-Pleated Skirt", "photo": "uniform-dps-skirt.webp",
        "description": "Knee-length grey box-pleated skirt with a flat waistband, side button and zip.",
        "cost": "330.00", "price": "560.00", "variants": _sized("DPS-SKT", SKIRT_SIZES, 120),
    },
    {
        "school": "DPS-SUR", "category": "uniform", "gender": "girl", "classes": (1, 12),
        "name": "DPS Girls Half-Sleeve Shirt", "photo": "uniform-dps-girl-shirt.webp",
        "description": "White cotton-blend shirt with bottle green pocket piping and the DPS crest.",
        "cost": "270.00", "price": "440.00", "variants": _sized("DPS-GSHIRT", SHIRT_SIZES, 150),
    },
    {
        "school": "DPS-SUR", "category": "uniform", "gender": "girl", "classes": (9, 12),
        "name": "DPS Senior Girls Salwar Kameez Set", "photo": "uniform-dps-salwar.webp",
        "description": "White kurta, grey salwar and bottle green dupatta for Classes 9 to 12.",
        "cost": "620.00", "price": "990.00", "variants": [
            ("S", "DPS-SALWAR-S", 80), ("M", "DPS-SALWAR-M", 100), ("L", "DPS-SALWAR-L", 90), ("XL", "DPS-SALWAR-XL", 60),
        ],
    },
    {
        "school": "DPS-SUR", "category": "uniform", "gender": "boy", "classes": (1, 12),
        "name": "DPS Boys Grey Formal Trousers", "photo": "uniform-dps-trousers.webp",
        "description": "Mid-grey flat-front school trousers with belt loops.",
        "cost": "360.00", "price": "590.00", "variants": _sized("DPS-TRS", WAIST_SIZES, 150),
    },
    # Fountainhead School Surat: white polo, navy bottoms, maroon accents
    {
        "school": "FHS-SUR", "category": "uniform", "gender": "boy", "classes": (1, 12),
        "name": "Fountainhead Navy Chino Trousers", "photo": "uniform-fhs-chinos.webp",
        "description": "Navy cotton chino trousers with belt loops.",
        "cost": "370.00", "price": "620.00", "variants": _sized("FHS-CHINO", WAIST_SIZES, 140),
    },
    {
        "school": "FHS-SUR", "category": "uniform", "gender": "girl", "classes": (1, 12),
        "name": "Fountainhead Navy Box-Pleated Skirt", "photo": "uniform-fhs-skirt.webp",
        "description": "Knee-length navy box-pleated skirt with a flat waistband.",
        "cost": "330.00", "price": "560.00", "variants": _sized("FHS-SKT", SKIRT_SIZES, 120),
    },
    {
        "school": "FHS-SUR", "category": "uniform-accessories", "product_type": "BELT", "gender": "unisex", "classes": (1, 12),
        "name": "Fountainhead Maroon School Belt", "photo": "belt-fhs.webp",
        "description": "Maroon elastic woven belt with a silver crest buckle.",
        "cost": "90.00", "price": "190.00", "variants": [("28 Inch", "FHS-BELT-28", 250), ("32 Inch", "FHS-BELT-32", 250)],
    },
    {
        "school": "FHS-SUR", "category": "uniform-accessories", "product_type": "SOCKS", "gender": "unisex", "classes": (1, 12),
        "name": "Fountainhead Striped School Socks (Pack of 2)", "photo": "socks-fhs.webp",
        "description": "White cotton crew socks with maroon stripes.",
        "cost": "95.00", "price": "190.00", "variants": [("Junior", "FHS-SOCK-JR", 300), ("Senior", "FHS-SOCK-SR", 300)],
    },
    # Udgam School for Children: white shirt with navy epaulettes, navy bottoms, maroon tie
    {
        "school": "UDG-AMD", "category": "uniform", "gender": "unisex", "classes": (1, 12),
        "name": "Udgam Half-Sleeve Shirt with Epaulettes", "photo": "uniform-udgam-shirt.webp",
        "description": "White cotton-blend shirt with navy epaulettes and the Udgam crest.",
        "cost": "280.00", "price": "460.00", "variants": _sized("UDG-SHIRT", SHIRT_SIZES, 150),
    },
    {
        "school": "UDG-AMD", "category": "uniform", "gender": "boy", "classes": (1, 12),
        "name": "Udgam Boys Navy Formal Trousers", "photo": "uniform-udgam-trousers.webp",
        "description": "Navy flat-front school trousers with belt loops.",
        "cost": "360.00", "price": "590.00", "variants": _sized("UDG-TRS", WAIST_SIZES, 140),
    },
    {
        "school": "UDG-AMD", "category": "uniform", "gender": "girl", "classes": (1, 12),
        "name": "Udgam Girls Checked Box-Pleated Skirt", "photo": "uniform-udgam-skirt.webp",
        "description": "Knee-length maroon and navy check box-pleated skirt.",
        "cost": "340.00", "price": "580.00", "variants": _sized("UDG-SKT", SKIRT_SIZES, 120),
    },
    {
        "school": "UDG-AMD", "category": "uniform-accessories", "product_type": "BELT", "gender": "unisex", "classes": (1, 12),
        "name": "Udgam Navy School Belt", "photo": "belt-udgam.webp",
        "description": "Navy elastic woven belt with a gold crest buckle.",
        "cost": "90.00", "price": "190.00", "variants": [("28 Inch", "UDG-BELT-28", 250), ("32 Inch", "UDG-BELT-32", 250)],
    },
    {
        "school": "UDG-AMD", "category": "uniform-accessories", "product_type": "SOCKS", "gender": "unisex", "classes": (1, 12),
        "name": "Udgam Navy School Socks (Pack of 2)", "photo": "socks-udgam.webp",
        "description": "Navy cotton crew socks with a maroon band.",
        "cost": "95.00", "price": "190.00", "variants": [("Junior", "UDG-SOCK-JR", 300), ("Senior", "UDG-SOCK-SR", 300)],
    },
]


def apply_showcase_catalog(School, SchoolBranch, Grade, Category, Product, ProductVariant, StockBalance, StockMovement):
    """Attach photos and add each school's missing uniform items. Returns how many items were added."""
    schools = {s.code: s for s in School.objects.filter(code__in=["DPS-SUR", "FHS-SUR", "UDG-AMD"])}
    if not schools:
        return 0  # empty database (tests, first install): nothing to attach to

    def find(code, name):
        school = schools.get(code) if code else None
        if code and not school:
            return None
        return Product.objects.filter(name=name, school=school).first()

    for (code, old_name), new_name in RENAMED.items():
        product = find(code, old_name)
        if product and not find(code, new_name):
            product.name = new_name
            product.save(update_fields=["name", "updated_at"])

    for (code, name), photo in EXISTING_PHOTOS.items():
        product = find(code, name)
        if product:
            product.images = [PHOTO_BASE + photo]
            product.save(update_fields=["images", "updated_at"])

    grades = {g.sort_order: g for g in Grade.objects.all()}
    by_class = {}
    for g in grades.values():
        if g.name.startswith("Class "):
            by_class[int(g.name[6:])] = g
    categories = {c.slug: c for c in Category.objects.all()}

    added = 0
    for spec in UNIFORM_SETS:
        school = schools.get(spec["school"])
        category = categories.get(spec["category"])
        if not school or not category:
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
        product.images = [PHOTO_BASE + spec["photo"]]
        product.needs_review = False
        product.active = True
        product.save()
        low, high = spec["classes"]
        product.grades.set([by_class[n] for n in range(low, high + 1) if n in by_class])

        # School items are stocked wherever the school has a branch, as well as its own city.
        city_ids = {school.city_id} | set(
            SchoolBranch.objects.filter(school=school, active=True).values_list("city_id", flat=True)
        )
        for size, sku, qty in spec["variants"]:
            variant = ProductVariant.objects.filter(sku=sku).first() or ProductVariant(sku=sku)
            variant.product = product
            variant.school_id = school.id
            variant.city_id = school.city_id
            variant.size = size
            variant.active = True
            variant.save()
            for city_id in city_ids:
                _, created = StockBalance.objects.get_or_create(
                    city_id=city_id,
                    variant=variant,
                    defaults={"stock_quantity": qty, "low_stock_threshold": 20},
                )
                if created:
                    StockMovement.objects.create(
                        city_id=city_id,
                        school_id=school.id,
                        variant=variant,
                        quantity_change=qty,
                        reason="INITIAL_STOCK",
                    )
        # An older variant with a size this set now covers (the pinafore's sizes) is switched off.
        spec_skus = {sku for _, sku, _ in spec["variants"]}
        spec_sizes = {size for size, _, _ in spec["variants"]}
        ProductVariant.objects.filter(product=product, size__in=spec_sizes).exclude(sku__in=spec_skus).update(active=False)
    return added
