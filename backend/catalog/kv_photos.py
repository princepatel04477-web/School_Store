"""
Kendriya Vidyalaya product photos: which photo each KV item shows, for which
classes, gender and season, and the alt text read out for it.

Source: the KVS uniform pattern (92nd Board of Governors, 2012, with its
corrigendum). Each store item shows exactly one photo, so an item sold for one
class band can only ever show the photo made for that band.

Photos live in frontend/public/products/ and the React build ships them. A
photo marked ``replaced`` has two files, ``<file>.webp`` (1000 px, product
sheet) and ``<file>-400.webp`` (400 px, cards and lists). A photo not marked
``replaced`` is an older photo that stays until a new one is supplied; see
MISSING_IMAGES.md at the repo root.

Applied by migration 0016. Safe to run again: items are matched by school +
name and only their image list is written, so nothing is duplicated.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlparse

from .kv_catalog import KV_CODE, PHOTO_BASE

THUMB_SUFFIX = "-400"
EXTENSION = ".webp"

SUMMER = "summer"
WINTER = "winter"
ALL_YEAR = "all"


@dataclass(frozen=True)
class KvPhoto:
    file: str  # base file name, no extension
    alt: str
    classes: tuple[int, int]  # the class band this photo is for, inclusive
    gender: str  # "boy", "girl" or "unisex"
    season: str  # SUMMER, WINTER or ALL_YEAR
    products: tuple[str, ...]  # store item names that show this photo
    primary: bool = False  # the season's main garment for its band
    replaced: bool = True  # False: an older photo stays until a new one arrives

    @property
    def url(self) -> str:
        return f"{PHOTO_BASE}{self.file}{EXTENSION}"


def _bands(name: str) -> tuple[str, str]:
    """An item sold in two class bands: Classes 1-5 and Classes 6-12."""
    return (f"{name} (Class 1-5)", f"{name} (Class 6-12)")


ALL = (1, 12)

KV_PHOTOS: tuple[KvPhoto, ...] = (
    # Class-banded tops, one per band, gender and season.
    KvPhoto(
        "kv-boys-1-5-shirt-summer",
        "Kendriya Vidyalaya boys Class I-V summer check shirt with mandarin collar",
        (1, 5), "boy", SUMMER, ("KV Boys Summer Shirt (Class 1-5)",),
        primary=True, replaced=False,
    ),
    KvPhoto(
        "kv-boys-6-12-shirt-summer",
        "Kendriya Vidyalaya boys Class VI-XII summer check shirt with red pointed collar and grey pleated trousers",
        (6, 12), "boy", SUMMER, ("KV Boys Summer Shirt (Class 6-12)",),
        primary=True,
    ),
    KvPhoto(
        "kv-boys-shirt-winter",
        "Kendriya Vidyalaya boys Class I-XII winter full-sleeve check shirt with red cuffs and grey trousers",
        ALL, "boy", WINTER, ("KV Boys Winter Full-Sleeve Shirt (Class 1-12)",),
        primary=True,
    ),
    KvPhoto(
        "kv-girls-1-2-tunic",
        "Kendriya Vidyalaya girls Class I-II princess-line check tunic with red Peter Pan collar",
        (1, 2), "girl", SUMMER, ("KV Girls Check Tunic (Class 1-2)",),
        primary=True,
    ),
    KvPhoto(
        "kv-girls-3-8-shirt-summer",
        "Kendriya Vidyalaya girls Class III-VIII summer check shirt with grey box-pleated skirt and red band",
        (3, 8), "girl", SUMMER, ("KV Girls Summer Shirt (Class 3-8)",),
        primary=True,
    ),
    # The KVS pattern puts this shirt at Classes III-VIII; the store sells it from Class 1.
    KvPhoto(
        "kv-girls-shirt-winter",
        "Kendriya Vidyalaya girls Class III-VIII winter full-sleeve check shirt with grey skirt",
        (3, 8), "girl", WINTER, ("KV Girls Winter Full-Sleeve Shirt (Class 1-8)",),
        primary=True,
    ),
    KvPhoto(
        "kv-girls-9-12-kurta",
        "Kendriya Vidyalaya girls Class IX-XII kurta with grey waistcoat",
        (9, 12), "girl", SUMMER, ("KV Girls Kurta with Waistcoat (Class 9-12)",),
        primary=True,
    ),
    KvPhoto(
        "kv-cardigan-girls-9-12",
        "Kendriya Vidyalaya girls Class IX-XII grey cardigan with three red stripes",
        (9, 12), "girl", WINTER, ("KV Girls Grey Cardigan (Class 9-12)",),
        primary=True,
    ),
    # One photo for every class.
    KvPhoto(
        "kv-sweater-v-neck",
        "Kendriya Vidyalaya grey V-neck sweater with three red stripes, all classes",
        ALL, "unisex", WINTER, ("KV Grey V-Neck Sweater (Class 1-12)",),
    ),
    KvPhoto(
        "kv-hooded-jacket-full",
        "Kendriya Vidyalaya grey full-sleeve hooded jacket, all classes",
        ALL, "unisex", WINTER, _bands("KV Grey Hooded Jacket, Full Sleeve"),
    ),
    KvPhoto(
        "kv-hooded-jacket-half",
        "Kendriya Vidyalaya grey half-sleeve hooded jacket, all classes",
        ALL, "unisex", WINTER, _bands("KV Grey Hooded Jacket, Half Sleeve"),
    ),
    KvPhoto(
        "kv-coatie-grey",
        "Kendriya Vidyalaya grey sleeveless coatie, all classes",
        ALL, "unisex", WINTER, _bands("KV Grey Sleeveless Coatie"),
    ),
    KvPhoto(
        "kv-belt-knitted",
        "Kendriya Vidyalaya blue and grey knitted belt with monogram buckle",
        ALL, "unisex", ALL_YEAR, ("KV Knitted Belt with Monogram Buckle",),
    ),
    KvPhoto(
        "kv-track-pant-navy",
        "Kendriya Vidyalaya navy PT track pants with white side piping, all classes",
        ALL, "unisex", ALL_YEAR, _bands("KV Navy PT Track Pants"),
    ),
    KvPhoto(
        "kv-girls-leggings-grey",
        "Kendriya Vidyalaya girls grey leggings",
        ALL, "girl", ALL_YEAR, ("KV Girls Grey Leggings (Class 1-8)",),
    ),
    KvPhoto(
        "kv-socks-navy",
        "Kendriya Vidyalaya navy socks with two red stripes, all classes",
        ALL, "unisex", SUMMER, ("KV Navy Socks with Red Stripes (Pack of 2)",),
    ),
    KvPhoto(
        "kv-socks-grey",
        "Kendriya Vidyalaya grey socks with two red stripes, all classes",
        ALL, "unisex", WINTER, ("KV Grey Socks with Red Stripes (Pack of 2)",),
    ),
    # House PT T-shirts: still on the older photos (see MISSING_IMAGES.md).
    KvPhoto(
        "kv-house-tshirt-red",
        "Kendriya Vidyalaya red house PT T-shirt with white collar, all classes",
        ALL, "unisex", ALL_YEAR, _bands("KV Red House PT T-Shirt"), replaced=False,
    ),
    KvPhoto(
        "kv-house-tshirt-blue",
        "Kendriya Vidyalaya blue house PT T-shirt with white collar, all classes",
        ALL, "unisex", ALL_YEAR, _bands("KV Blue House PT T-Shirt"), replaced=False,
    ),
    KvPhoto(
        "kv-house-tshirt-green",
        "Kendriya Vidyalaya green house PT T-shirt with white collar, all classes",
        ALL, "unisex", ALL_YEAR, _bands("KV Green House PT T-Shirt"), replaced=False,
    ),
    KvPhoto(
        "kv-house-tshirt-yellow",
        "Kendriya Vidyalaya sun yellow house PT T-shirt with white collar, all classes",
        ALL, "unisex", ALL_YEAR, _bands("KV Yellow House PT T-Shirt"), replaced=False,
    ),
    # Bottoms the photo set has no row for: their current photos stay.
    KvPhoto(
        "kv-boys-1-5-shorts",
        "Kendriya Vidyalaya boys Class I-V grey shorts",
        (1, 5), "boy", SUMMER, ("KV Boys Grey Shorts (Class 1-5)",), replaced=False,
    ),
    KvPhoto(
        "kv-boys-6-12-trousers",
        "Kendriya Vidyalaya boys Class VI-XII grey pleated trousers",
        (6, 12), "boy", ALL_YEAR, ("KV Boys Grey Trousers (Class 6-12)",), replaced=False,
    ),
    KvPhoto(
        "kv-girls-3-8-skirt",
        "Kendriya Vidyalaya girls Class III-VIII grey box-pleated skirt with red band",
        (3, 8), "girl", ALL_YEAR, ("KV Girls Grey Divided Skirt (Class 3-8)",), replaced=False,
    ),
    KvPhoto(
        "kv-girls-9-12-trousers",
        "Kendriya Vidyalaya girls Class IX-XII grey trousers",
        (9, 12), "girl", ALL_YEAR, ("KV Girls Grey Trousers (Class 9-12)",), replaced=False,
    ),
)

_BY_FILE = {photo.file: photo for photo in KV_PHOTOS}

# Plain product shots (the garment alone, no child) live in products/plain/ under the
# same file name as the item's model photo. An item with one shows it first, on the
# card and as the first photo on its page; the model photo is the second photo.
# Each has a 1000 px file and a -400 card file.
PLAIN_FOLDER = "plain"
PLAIN_FILES = frozenset({
    "kv-belt-knitted",
    "kv-boys-1-5-shirt-summer",
    "kv-boys-6-12-shirt-summer",
    "kv-boys-shirt-winter",
    "kv-boys-1-5-shorts",
    "kv-boys-6-12-trousers",
    "kv-girls-3-8-skirt",
    "kv-girls-9-12-trousers",
    "kv-house-tshirt-red",
    "kv-house-tshirt-blue",
    "kv-house-tshirt-green",
    "kv-house-tshirt-yellow",
    "kv-girls-1-2-tunic",
    "kv-girls-3-8-shirt-summer",
    "kv-girls-shirt-winter",
    "kv-girls-9-12-kurta",
    "kv-cardigan-girls-9-12",
    "kv-girls-leggings-grey",
    "kv-track-pant-navy",
    "kv-hooded-jacket-half",
    "kv-hooded-jacket-full",
    "kv-coatie-grey",
    "kv-sweater-v-neck",
    "kv-socks-grey",
})
# The PT T-shirts the panel added by hand ("KV PT Uniform Blue", "KV Uniform Yellow"):
# matched by house colour, since their own photos are uploads.
_PT_SHIRT_NAME = re.compile(r"^KV (?:PT )?Uniform (Red|Blue|Green|Yellow)$", re.IGNORECASE)


def plain_url(file: str) -> str:
    return f"{PHOTO_BASE}{PLAIN_FOLDER}/{file}{EXTENSION}"


def _is_plain(url) -> bool:
    return isinstance(url, str) and f"/{PLAIN_FOLDER}/kv-" in urlparse(url).path


def normalise_name(name: str) -> str:
    """Item names are stored with an en dash in some class ranges; match them with a hyphen."""
    return name.replace("–", "-").replace("—", "-").strip()


def _photo_for_url(url) -> KvPhoto | None:
    if not isinstance(url, str) or not url:
        return None
    path = urlparse(url).path
    stem, dot, extension = path.rsplit("/", 1)[-1].rpartition(".")
    if not dot or f".{extension}" != EXTENSION:
        return None
    if stem.endswith(THUMB_SUFFIX):
        stem = stem[: -len(THUMB_SUFFIX)]
    return _BY_FILE.get(stem)


def alt_for_url(url) -> str | None:
    """Alt text for one stored KV photo URL, or None when it is not a KV photo."""
    photo = _photo_for_url(url)
    return photo.alt if photo else None


def thumbnail_for_url(url) -> str | None:
    """The 400 px file for a KV photo that has one, else None."""
    photo = _photo_for_url(url)
    if photo is None or not (photo.replaced or _is_plain(url)):
        return None
    # Same host and folder as the stored image, so a copy served elsewhere still works.
    parsed = urlparse(url)
    folder = parsed.path.rsplit("/", 1)[0]
    return parsed._replace(path=f"{folder}/{photo.file}{THUMB_SUFFIX}{EXTENSION}", query="").geturl()


def apply_kv_photos(School, Product) -> int:
    """Point each KV item at its photo. Returns how many items changed.

    A new photo always replaces the item's image list. An older photo only
    fills an empty list, so an image already on the item is never lost.
    """
    school = School.objects.filter(code=KV_CODE).first()
    if school is None:
        return 0  # directory not imported yet (tests, fresh installs)

    by_name = {}
    for photo in KV_PHOTOS:
        for name in photo.products:
            by_name[normalise_name(name)] = photo

    changed = 0
    for product in Product.objects.filter(school=school):
        photo = by_name.get(normalise_name(product.name))
        if photo is None:
            continue
        if not photo.replaced and product.images:
            continue
        if photo.url in product.images:
            continue  # already shows it (after its plain photo, see apply_plain_photos)
        product.images = [photo.url]
        product.save(update_fields=["images", "updated_at"])
        changed += 1
    return changed


def plain_first_images(name: str, images: list) -> list | None:
    """The item's photo list with its plain shot first and its model photo second.

    None when the store has no plain shot for the item. Other photos the item
    already has follow, except for the hand-added PT T-shirts, whose uploads are
    the same plain shot (one showed the wrong colour).
    """
    images = [url for url in (images or []) if isinstance(url, str) and url]
    shirt = _PT_SHIRT_NAME.match(normalise_name(name))
    if shirt:
        file = f"kv-house-tshirt-{shirt.group(1).lower()}"
        return [plain_url(file), f"{PHOTO_BASE}{file}{EXTENSION}"]
    model = next((url for url in images if not _is_plain(url)), None)
    photo = _photo_for_url(model)
    if photo is None or photo.file not in PLAIN_FILES:
        return None
    rest = [url for url in images if url != model and not _is_plain(url)]
    return [plain_url(photo.file), model, *rest]


def apply_plain_photos(School, Product) -> int:
    """Put the plain shot first on every KV item that has one. Returns how many changed."""
    school = School.objects.filter(code=KV_CODE).first()
    if school is None:
        return 0
    changed = 0
    for product in Product.objects.filter(school=school):
        images = plain_first_images(product.name, product.images)
        if images is None or images == product.images:
            continue
        product.images = images
        product.save(update_fields=["images", "updated_at"])
        changed += 1
    return changed
