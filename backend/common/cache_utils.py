from django.core.cache import cache

CATALOG_CACHE_VERSION_KEY = "catalog:version"
SCHOOL_LIST_CACHE_VERSION_KEY = "schools:version"


def get_cache_version(version_key: str) -> int:
    val = cache.get(version_key)
    if val is None:
        cache.set(version_key, 1, timeout=None)
        return 1
    return int(val)


def bump_cache_version(version_key: str) -> int:
    try:
        return cache.incr(version_key)
    except ValueError:
        cache.set(version_key, 2, timeout=None)
        return 2


def invalidate_catalog_cache() -> None:
    """Explicitly invalidate cached catalogue responses when Category/Product/Variant changes."""
    bump_cache_version(CATALOG_CACHE_VERSION_KEY)


def invalidate_school_cache() -> None:
    """Explicitly invalidate cached school/city lists when City/School changes."""
    bump_cache_version(SCHOOL_LIST_CACHE_VERSION_KEY)
