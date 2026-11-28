import uuid

import jwt
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from . import supabase_auth
from .models import User
from .revocation import is_revoked


def supabase_claims(raw: str) -> dict:
    """A verified Supabase access token, in the shape Django's own tokens have."""
    try:
        payload = supabase_auth.decode(raw)
    except (jwt.PyJWTError, supabase_auth.SupabaseAuthError) as exc:
        raise InvalidToken("Token is invalid or expired") from exc
    meta = payload.get("app_metadata") or {}
    if not meta.get("store_role"):
        raise InvalidToken("Token is not a School Store sign-in")
    return {
        "token_type": "access",
        "issuer": "supabase",
        "user_id": payload["sub"],
        "iat": payload.get("iat"),
        "exp": payload.get("exp"),
        "username": meta.get("username", ""),
        "role": meta["store_role"],
        "city_id": meta.get("city_id"),
        "school_id": meta.get("school_id"),
        "branch_id": meta.get("branch_id"),
        "all_schools_access": bool(meta.get("all_schools_access")),
        "must_change_password": bool(meta.get("must_change_password")),
    }


class ZeroQueryJWTAuthentication(JWTAuthentication):
    """
    Prompt 3 Requirement 3:
    Reads user_id, username, role, city_id, and school_id directly from the
    verified JWT claims and constructs an in-memory User instance without
    hitting the database (0 SQL queries per request for auth & permission checks).

    Accepts Django's own access tokens and Supabase Auth access tokens (accounts/supabase_auth.py),
    whose app_metadata carries the same claims.
    """

    def get_validated_token(self, raw_token):
        raw = raw_token.decode() if isinstance(raw_token, bytes) else str(raw_token)
        if supabase_auth.enabled() and supabase_auth.looks_like_supabase_token(raw):
            return supabase_claims(raw)
        return super().get_validated_token(raw_token)

    def get_user(self, validated_token):
        try:
            user_id_raw = validated_token["user_id"]
            user_id = (
                uuid.UUID(str(user_id_raw))
                if not isinstance(user_id_raw, uuid.UUID)
                else user_id_raw
            )
        except (KeyError, ValueError) as exc:
            raise InvalidToken("Token contained no recognizable user identification") from exc

        if is_revoked(user_id, validated_token.get("iat")):
            raise InvalidToken("This sign-in has ended. Please sign in again.")

        role = validated_token.get("role")
        if not role:
            # Fallback if a token was minted without role claim
            return super().get_user(validated_token)

        city_id_raw = validated_token.get("city_id")
        school_id_raw = validated_token.get("school_id")
        branch_id_raw = validated_token.get("branch_id")

        city_id = uuid.UUID(str(city_id_raw)) if city_id_raw else None
        school_id = uuid.UUID(str(school_id_raw)) if school_id_raw else None
        branch_id = uuid.UUID(str(branch_id_raw)) if branch_id_raw else None

        user = User(
            id=user_id,
            username=validated_token.get("username", ""),
            role=role,
            city_id=city_id,
            school_id=school_id,
            branch_id=branch_id,
            all_schools_access=bool(validated_token.get("all_schools_access", False)),
            must_change_password=bool(validated_token.get("must_change_password", False)),
            is_active=True,
            is_staff=role in (User.Role.BOSS, User.Role.ADMIN),
            is_superuser=(role == User.Role.BOSS),
        )
        user._state.adding = False
        user._state.db = "default"
        return user
