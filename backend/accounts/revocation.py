"""Sign a user out everywhere without a database lookup on every request.

Access tokens are checked from their claims alone (ZeroQueryJWTAuthentication),
so pausing an account or giving it a new password would otherwise leave phones
that are already signed in working until the token expires. Instead we keep one
small cache entry per affected user: tokens issued before that moment are refused.
"""

import time

from django.conf import settings
from django.core.cache import cache


def _key(user_id) -> str:
    return f"auth:revoked-before:{user_id}"


def _ttl() -> int:
    lifetime = settings.SIMPLE_JWT.get("REFRESH_TOKEN_LIFETIME")
    seconds = int(lifetime.total_seconds()) if lifetime else 7 * 24 * 3600
    return seconds + 3600


def revoke_sessions(user_id) -> None:
    """Every token issued for this user until now stops working."""
    try:
        cache.set(_key(user_id), int(time.time()), timeout=_ttl())
    except Exception:  # a cache outage must not block the admin action itself
        pass


def is_revoked(user_id, issued_at) -> bool:
    try:
        cutoff = cache.get(_key(user_id))
    except Exception:
        return False
    if not cutoff:
        return False
    try:
        return int(issued_at) < int(cutoff)
    except (TypeError, ValueError):
        return True
