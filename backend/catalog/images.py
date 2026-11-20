"""
Product image handling policy.

Images are uploaded to object storage (S3 / R2 / Supabase storage) by the
admin tooling and the API stores *URLs only* in ``Product.images``. Django
never proxies or serves image bytes: list responses return a single CDN
thumbnail URL and the detail response returns the full-size CDN URLs.

Thumbnails are produced by the CDN's on-the-fly resize parameters, configured
via ``settings.CATALOG_THUMBNAIL_TEMPLATE`` (e.g. ``{url}{sep}width=320``).
"""

from urllib.parse import urlparse

from django.conf import settings

from .kv_photos import alt_for_url, thumbnail_for_url


def is_remote_image_url(url) -> bool:
    """True when `url` is an absolute http(s) URL (object storage / CDN)."""
    if not isinstance(url, str) or not url:
        return False
    parsed = urlparse(url)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def cdn_thumbnail_url(url: str | None) -> str | None:
    """Build the resized-thumbnail URL for one stored object URL."""
    if not url or not is_remote_image_url(url):
        return None
    template = getattr(
        settings, "CATALOG_THUMBNAIL_TEMPLATE", "{url}{sep}width=320&quality=70"
    )
    sep = "&" if "?" in url else "?"
    return template.format(url=url, sep=sep)


def product_thumbnail(images) -> str | None:
    """One thumbnail for the product card: the first stored image, resized.

    Store photos that ship with the React build come in two sizes, so the card
    gets the 400 px file; any other image is resized by the CDN.
    """
    if not images:
        return None
    return thumbnail_for_url(images[0]) or cdn_thumbnail_url(images[0])


def product_image(images) -> str | None:
    """The full-size first image, for the product sheet."""
    if not images or not is_remote_image_url(images[0]):
        return None
    return images[0]


def product_image_alt(images) -> str | None:
    """Alt text for the first image when the store has written one for it."""
    if not images:
        return None
    return alt_for_url(images[0])
