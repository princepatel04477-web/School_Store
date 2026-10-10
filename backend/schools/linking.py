"""Linking parents to the children on their school's roster."""

from common.phone import normalize_in_mobile

from .models import Student


def link_children_by_phone(user) -> int:
    """
    Links every unclaimed, active roster child whose school record carries this
    parent's mobile number. Only OTP-verified numbers are trusted, so nobody can
    see a child by registering with someone else's number. Returns the count.

    Phone and verification are read from the database: request users are built
    from JWT claims (see ZeroQueryJWTAuthentication) and don't carry them.
    """
    from accounts.models import User

    if getattr(user, "role", None) != User.Role.PARENT or not getattr(user, "pk", None):
        return 0
    record = (
        User.objects.filter(pk=user.pk, is_active=True)
        .values("phone", "phone_verified")
        .first()
    )
    if not record or not record["phone_verified"]:
        return 0
    phone = normalize_in_mobile(record["phone"])
    if not phone:
        return 0
    return Student.objects.filter(
        roster_phone=phone, parent__isnull=True, active=True
    ).update(parent_id=user.pk)
