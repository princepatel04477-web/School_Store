import hashlib

from django.core.cache import cache

CATALOG_CACHE_VERSION_KEY = "catalog:version"
SCHOOL_LIST_CACHE_VERSION_KEY = "schools:version"


def get_cache_version(version_key: str) -> int:
    val = cache.get(version_key)
    if val is None:
        # add() is atomic, so a concurrent invalidation cannot be overwritten.
        cache.add(version_key, 1, timeout=None)
        val = cache.get(version_key)
    return int(val or 1)


def bump_cache_version(version_key: str) -> int:
    try:
        return cache.incr(version_key)
    except ValueError:
        try:
            if cache.add(version_key, 1, timeout=None):
                return 1
            return cache.incr(version_key)
        except Exception:
            return 0
    except Exception:
        # Cache failure must not block a committed database write.
        return 0


def versioned_cache_key(namespace: str, request_key: str, *version_keys: str) -> str:
    """Build a bounded cache key whose version changes on explicit invalidation."""
    versions = ":".join(
        f"{key}={get_cache_version(key)}" for key in version_keys
    )
    digest = hashlib.sha256(f"{versions}\x1f{request_key}".encode()).hexdigest()
    return f"{namespace}:{digest}"


def invalidate_catalog_cache() -> None:
    """Explicitly invalidate cached catalogue responses when Category/Product/Variant changes."""
    bump_cache_version(CATALOG_CACHE_VERSION_KEY)


def invalidate_school_cache() -> None:
    """Explicitly invalidate cached school/city lists when City/School changes."""
    bump_cache_version(SCHOOL_LIST_CACHE_VERSION_KEY)
