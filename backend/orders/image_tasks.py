"""
Celery tasks for customisation asset processing:
- Validate uploaded image type and size directly from object storage (without storing raw bytes in Django DB).
- Generate a print-ready 300 DPI version and a compact preview thumbnail.
- Store processed versions into object storage under predictable derivative keys.
- Update the OrderItem customisation_data with references to the validated / print / thumb keys.
"""

import io
from celery import shared_task
from django.db import transaction
from PIL import Image, ImageOps

from .models import OrderItem
from .storage import get_object_bytes, put_object_bytes


ALLOWED_IMAGE_FORMATS = {"JPEG", "JPG", "PNG", "WEBP"}
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024  # Max 5 MB on server boundary


@shared_task(name="orders.process_customisation_image")
def process_customisation_image(order_item_id: str, field_key: str):
    """
    Background worker that runs asynchronously after order placement.
    Reads the uploaded image bytes from object storage, validates them,
    generates a print-ready version and thumbnail, and writes derivatives to storage.
    """
    try:
        item = OrderItem.objects.select_related("order").get(pk=order_item_id)
    except OrderItem.DoesNotExist:
        return f"OrderItem {order_item_id} not found"

    customisation_data = dict(item.customisation_data or {})
    original_key = customisation_data.get(field_key)
    if not original_key or not isinstance(original_key, str):
        return f"No image key for field {field_key}"

    # Read object bytes directly from object storage
    try:
        raw_bytes = get_object_bytes(original_key)
    except Exception as exc:
        customisation_data[f"{field_key}_status"] = "ERROR_NOT_FOUND"
        customisation_data[f"{field_key}_error"] = str(exc)
        OrderItem.objects.filter(pk=order_item_id).update(customisation_data=customisation_data)
        return f"Could not read object {original_key}: {exc}"

    if len(raw_bytes) > MAX_IMAGE_SIZE_BYTES:
        customisation_data[f"{field_key}_status"] = "REJECTED_OVERSIZED"
        OrderItem.objects.filter(pk=order_item_id).update(customisation_data=customisation_data)
        return "File exceeds server max size limit"

    # Open image with Pillow and validate integrity
    try:
        image = Image.open(io.BytesIO(raw_bytes))
        image.verify()  # Verify image integrity
        # Re-open because verify() consumes file pointer state
        image = Image.open(io.BytesIO(raw_bytes))
        image = ImageOps.exif_transpose(image)  # Correct mobile orientation if needed
    except Exception as exc:
        customisation_data[f"{field_key}_status"] = "REJECTED_INVALID_IMAGE"
        customisation_data[f"{field_key}_error"] = str(exc)
        OrderItem.objects.filter(pk=order_item_id).update(customisation_data=customisation_data)
        return f"Invalid image format: {exc}"

    fmt = (image.format or "JPEG").upper()
    if fmt not in ALLOWED_IMAGE_FORMATS and fmt != "MPO":
        customisation_data[f"{field_key}_status"] = "REJECTED_UNSUPPORTED_FORMAT"
        OrderItem.objects.filter(pk=order_item_id).update(customisation_data=customisation_data)
        return f"Unsupported format: {fmt}"

    # Convert to RGB if needed (e.g. RGBA for JPEG or CMYK)
    rgb_image = image.convert("RGB")

    # 1. Print-ready version: high quality (300 DPI metadata, high JPEG quality 95)
    print_buffer = io.BytesIO()
    # If the image is excessively large, resize to max 3000px on the longest edge for print raster
    max_print_dim = 3000
    print_img = rgb_image.copy()
    if max(print_img.width, print_img.height) > max_print_dim:
        print_img.thumbnail((max_print_dim, max_print_dim), Image.Resampling.LANCZOS)

    print_img.save(print_buffer, format="JPEG", quality=95, dpi=(300, 300), optimize=True)
    print_bytes = print_buffer.getvalue()

    # 2. Thumbnail version: 320x320 max for admin panel preview
    thumb_buffer = io.BytesIO()
    thumb_img = rgb_image.copy()
    thumb_img.thumbnail((320, 320), Image.Resampling.LANCZOS)
    thumb_img.save(thumb_buffer, format="JPEG", quality=80, optimize=True)
    thumb_bytes = thumb_buffer.getvalue()

    # Define derivative keys
    base_key = original_key.rsplit(".", 1)[0]
    print_key = f"{base_key}_print.jpg"
    thumb_key = f"{base_key}_thumb.jpg"

    # Put derivatives to object storage
    put_object_bytes(print_key, print_bytes, content_type="image/jpeg")
    put_object_bytes(thumb_key, thumb_bytes, content_type="image/jpeg")

    # Update OrderItem customisation_data with lightweight references
    customisation_data[f"{field_key}_print"] = print_key
    customisation_data[f"{field_key}_thumb"] = thumb_key
    customisation_data[f"{field_key}_status"] = "PROCESSED"
    customisation_data[f"{field_key}_width"] = image.width
    customisation_data[f"{field_key}_height"] = image.height

    OrderItem.objects.filter(pk=order_item_id).update(customisation_data=customisation_data)
    return f"Processed {field_key} for item {order_item_id}"
