import uuid
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from .models import User


class ZeroQueryJWTAuthentication(JWTAuthentication):
    """
    Prompt 3 Requirement 3:
    Reads user_id, username, role, city_id, and school_id directly from the
    verified JWT claims and constructs an in-memory User instance without
    hitting the database (0 SQL queries per request for auth & permission checks).
    """

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

        role = validated_token.get("role")
        if not role:
            # Fallback if a token was minted without role claim
            return super().get_user(validated_token)

        city_id_raw = validated_token.get("city_id")
        school_id_raw = validated_token.get("school_id")

        city_id = uuid.UUID(str(city_id_raw)) if city_id_raw else None
        school_id = uuid.UUID(str(school_id_raw)) if school_id_raw else None

        user = User(
            id=user_id,
            username=validated_token.get("username", ""),
            role=role,
            city_id=city_id,
            school_id=school_id,
            is_active=True,
            is_staff=role in (User.Role.BOSS, User.Role.ADMIN),
            is_superuser=(role == User.Role.BOSS),
        )
        user._state.adding = False
        user._state.db = "default"
        return user
