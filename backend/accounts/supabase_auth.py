"""Supabase Auth (GoTrue) as the issuer of sign-in tokens (phase 2 of the Supabase move).

How it fits together:

* Django still checks passwords (it holds every account's password hash, in a format
  Supabase cannot read). After a successful check, Django copies the password into
  Supabase Auth for that account and asks Supabase for a session. Passwords therefore
  move over silently, one sign-in at a time, and an old password can never work
  through Supabase because Django checks first.
* The client gets Supabase's access token (accepted by Django and, later, by Supabase's
  own API with row level security) and keeps Django's refresh token. Supabase refresh
  tokens are single-use, and the website and app only ever store the first refresh token
  they get, so Django keeps the Supabase refresh token for that sign-in on the server
  (cache, keyed by the Django refresh token's jti) and uses it on every refresh.
* Each Django user has a Supabase Auth user with the same UUID. Its app_metadata carries
  the claims Django needs (role, school, city, branch, ...), so Django builds request.user
  from the token without a database query, exactly like its own tokens.
* Phone-code (OTP) sign-in stays on Django tokens until an SMS service is connected.

Everything here is optional: with SUPABASE_AUTH_URL unset, or Supabase unreachable,
sign-in falls back to Django's own tokens and nothing else changes.
"""

import json
import logging
import secrets
import time
import urllib.error
import urllib.request

import jwt
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 5
JWKS_CACHE_KEY = "supabase-auth:jwks"
SESSION_CACHE_PREFIX = "supabase-auth:session:"


class SupabaseAuthError(Exception):
    """Supabase Auth refused or could not be reached."""

    def __init__(self, message, status=None, body=None):
        super().__init__(message)
        self.status = status
        self.body = body or {}


def enabled() -> bool:
    return bool(getattr(settings, "SUPABASE_AUTH_URL", "") and getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", ""))


def synthetic_email(user) -> str:
    """Supabase Auth signs in by email; accounts here have usernames, so each gets a fixed,
    never-mailed address from its id. Signups are off, so nobody can claim one."""
    return f"{user.id}@{settings.SUPABASE_AUTH_EMAIL_DOMAIN}"


def app_metadata(user) -> dict:
    return {
        "provider": "email",
        "providers": ["email"],
        "username": user.username,
        "store_role": user.role,
        "city_id": str(user.city_id) if user.city_id else None,
        "school_id": str(user.school_id) if user.school_id else None,
        "branch_id": str(user.branch_id) if user.branch_id else None,
        "all_schools_access": bool(user.all_schools_access),
        "must_change_password": bool(user.must_change_password),
    }


def _request(method, path, *, body=None, key=None, bearer=None):
    url = settings.SUPABASE_AUTH_URL.rstrip("/") + path
    headers = {"Content-Type": "application/json", "apikey": key or settings.SUPABASE_ANON_KEY}
    headers["Authorization"] = f"Bearer {bearer or key or settings.SUPABASE_ANON_KEY}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        try:
            payload = json.loads(err.read() or b"{}")
        except ValueError:
            payload = {}
        raise SupabaseAuthError(f"Supabase Auth {method} {path}: {err.code}", err.code, payload) from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise SupabaseAuthError(f"Supabase Auth unreachable: {err}") from err


def _admin(method, path, body=None):
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return _request(method, path, body=body, key=key, bearer=key)


def _banned(user) -> str:
    return "none" if user.is_active else "876000h"


def sync_user(user, password=None) -> None:
    """Create or update the Supabase Auth user for this account (same id).

    With `password`, Supabase stores it too. Without, a new Supabase user gets a random
    password it will never be told, so it can only sign in once Django has checked a real one.
    """
    body = {
        "email": synthetic_email(user),
        "email_confirm": True,
        "app_metadata": app_metadata(user),
        "ban_duration": _banned(user),
    }
    if password is not None:
        body["password"] = password
    try:
        _admin("PUT", f"/admin/users/{user.id}", body)
    except SupabaseAuthError as err:
        if err.status != 404:
            raise
        body.setdefault("password", secrets.token_urlsafe(32))
        body.pop("ban_duration")
        _admin("POST", "/admin/users", {"id": str(user.id), **body})
        if not user.is_active:
            _admin("PUT", f"/admin/users/{user.id}", {"ban_duration": _banned(user)})


def update_existing_user(user) -> bool:
    """Copy role, school, pause etc. to an account that already exists in Supabase Auth.

    Returns False when the account has never signed in through Supabase (nothing to update).
    """
    body = {"app_metadata": app_metadata(user), "ban_duration": _banned(user)}
    try:
        _admin("PUT", f"/admin/users/{user.id}", body)
    except SupabaseAuthError as err:
        if err.status == 404:
            return False
        raise
    return True


def password_session(user, password) -> dict:
    """A Supabase session for an account whose password Django has just accepted."""
    body = {"email": synthetic_email(user), "password": password}
    try:
        return _request("POST", "/token?grant_type=password", body=body)
    except SupabaseAuthError as err:
        if err.status not in (400, 401, 422):
            raise
    # First Supabase sign-in for this account, or its password changed in Django since:
    # carry the password over, then sign in.
    sync_user(user, password=password)
    return _request("POST", "/token?grant_type=password", body=body)


def refresh_session(refresh_token) -> dict:
    return _request("POST", "/token?grant_type=refresh_token", body={"refresh_token": refresh_token})


# ---- server-side Supabase refresh tokens, one per Django sign-in ----

def _session_key(jti) -> str:
    return SESSION_CACHE_PREFIX + str(jti)


def _session_ttl() -> int:
    lifetime = settings.SIMPLE_JWT.get("REFRESH_TOKEN_LIFETIME")
    return (int(lifetime.total_seconds()) if lifetime else 7 * 24 * 3600) + 3600


def remember_session(jti, supabase_refresh_token) -> None:
    try:
        cache.set(_session_key(jti), supabase_refresh_token, timeout=_session_ttl())
    except Exception:  # without the cache the next refresh just falls back to a Django token
        logger.warning("could not store the Supabase session for a sign-in")


def access_for_refresh(jti, new_jti=None):
    """Exchange the stored Supabase refresh token for a fresh Supabase access token.

    Returns None when there is no stored session (an older Django-only sign-in, or the
    cache was cleared) or Supabase cannot be reached; the caller then uses Django's token.
    """
    key = _session_key(jti)
    lock = key + ":lock"
    try:
        stored = cache.get(key)
    except Exception:
        return None
    if not stored:
        return None
    # One refresh at a time per sign-in: Supabase refresh tokens work once.
    for _ in range(20):
        if cache.add(lock, 1, timeout=10):
            break
        time.sleep(0.25)
    try:
        stored = cache.get(key) or stored
        session = refresh_session(stored)
    except SupabaseAuthError as err:
        logger.info("Supabase refresh failed (%s); using a Django token", err)
        return None
    finally:
        cache.delete(lock)
    remember_session(jti, session["refresh_token"])
    if new_jti and str(new_jti) != str(jti):
        remember_session(new_jti, session["refresh_token"])
    return session["access_token"]


# ---- checking Supabase access tokens ----

def _jwks() -> dict:
    keys = cache.get(JWKS_CACHE_KEY)
    if keys:
        return keys
    keys = _request("GET", "/.well-known/jwks.json")
    cache.set(JWKS_CACHE_KEY, keys, timeout=3600)
    return keys


def looks_like_supabase_token(raw: str) -> bool:
    try:
        header = jwt.get_unverified_header(raw)
    except jwt.PyJWTError:
        return False
    return header.get("alg") == "ES256" and bool(header.get("kid"))


def decode(raw: str) -> dict:
    """Verify a Supabase access token (ES256, our issuer, audience 'authenticated')."""
    header = jwt.get_unverified_header(raw)
    keys = {k["kid"]: k for k in _jwks().get("keys", [])}
    jwk = keys.get(header.get("kid"))
    if jwk is None:
        cache.delete(JWKS_CACHE_KEY)  # the key may have been rotated
        keys = {k["kid"]: k for k in _jwks().get("keys", [])}
        jwk = keys.get(header.get("kid"))
    if jwk is None:
        raise jwt.InvalidTokenError("unknown signing key")
    key = jwt.PyJWK(jwk).key
    return jwt.decode(
        raw,
        key=key,
        algorithms=["ES256"],
        audience="authenticated",
        issuer=settings.SUPABASE_AUTH_ISSUER,
        options={"require": ["exp", "iat", "sub"]},
    )
