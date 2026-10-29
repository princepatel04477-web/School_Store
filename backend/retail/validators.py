import re

from django.core.exceptions import ValidationError
from PIL import Image, UnidentifiedImageError

MAX_LOGO_BYTES = 2 * 1024 * 1024
MAX_LOGO_SIDE = 4000
# SVG is refused: it is a document that can carry scripts, not a plain picture.
LOGO_FORMATS = {"JPEG", "PNG", "WEBP"}

UDISE_RE = re.compile(r"^\d{11}$")
PINCODE_RE = re.compile(r"^[1-9]\d{5}$")
GST_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def validate_udise_code(value: str) -> None:
    if not UDISE_RE.match(value or ""):
        raise ValidationError("The UDISE code is 11 digits, numbers only.")


def validate_pincode(value: str) -> None:
    if not PINCODE_RE.match(value or ""):
        raise ValidationError("Enter a 6-digit pincode.")


def validate_gst_number(value: str) -> None:
    if value and not GST_RE.match(value):
        raise ValidationError("Enter a valid 15-character GST number, or leave it empty.")


def validate_logo(file) -> None:
    """A real JPEG, PNG or WebP picture, at most 2 MB and 4000 px a side."""
    if file.size > MAX_LOGO_BYTES:
        raise ValidationError("The logo must be 2 MB or smaller.")
    try:
        file.seek(0)
        with Image.open(file) as image:
            image_format = image.format
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise ValidationError("Upload the logo as a PNG, JPG or WebP picture.")
    finally:
        file.seek(0)
    if image_format not in LOGO_FORMATS:
        raise ValidationError("Upload the logo as a PNG, JPG or WebP picture.")
    if width > MAX_LOGO_SIDE or height > MAX_LOGO_SIDE:
        raise ValidationError(f"The logo can be at most {MAX_LOGO_SIDE} pixels wide and high.")
