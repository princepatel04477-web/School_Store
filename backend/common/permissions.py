"""
DRF permission classes per role (Prompt 3 Requirement 3 & 4).
All permission checks read directly from `request.user` (populated from JWT claims),
costing ZERO database queries per request.
"""

from rest_framework import permissions

ALL_ROLES = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")


class IsBoss(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.role == "BOSS" or getattr(user, "is_superuser", False))
        )


class IsAdmin(permissions.BasePermission):
    """Boss or City Admin."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.role in ("BOSS", "ADMIN") or getattr(user, "is_superuser", False))
        )


class IsSchoolAdmin(permissions.BasePermission):
    """Boss, City Admin, or School Admin."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (
                user.role in ("BOSS", "ADMIN", "SCHOOL_ADMIN")
                or getattr(user, "is_superuser", False)
            )
        )


class IsTeacher(permissions.BasePermission):
    """Boss, School Admin, or Teacher."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (
                user.role in ("BOSS", "SCHOOL_ADMIN", "TEACHER")
                or getattr(user, "is_superuser", False)
            )
        )


class IsParent(permissions.BasePermission):
    """Boss or Parent."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (
                user.role in ("BOSS", "PARENT")
                or getattr(user, "is_superuser", False)
            )
        )


class RoleScopedPermission(permissions.BasePermission):
    """
    Declarative role & object-scope permission class applied to ViewSets.
    ViewSets declare:
      - `read_roles`: tuple of roles allowed for SAFE_METHODS (default: ALL_ROLES)
      - `write_roles`: tuple of roles allowed for mutating methods (default: ("BOSS",))
    Checks cost 0 database queries because `role`, `city_id`, and `school_id`
    come directly from the JWT claims on `request.user`.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.role == "BOSS" or getattr(user, "is_superuser", False):
            return True

        if request.method in permissions.SAFE_METHODS:
            allowed = getattr(view, "read_roles", ALL_ROLES)
        else:
            allowed = getattr(view, "write_roles", ("BOSS",))

        return user.role in allowed

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.role == "BOSS" or getattr(user, "is_superuser", False):
            return True

        if not self.has_permission(request, view):
            return False

        city_field = getattr(view, "scope_city_field", "city_id")
        school_field = getattr(view, "scope_school_field", "school_id")
        parent_field = getattr(view, "scope_parent_field", "parent_id")
        include_null = getattr(view, "include_null_scope_for_catalog", False)

        if user.role == "ADMIN":
            if not city_field:
                return False
            obj_city = getattr(obj, city_field, None)
            if include_null and obj_city is None:
                return True
            return bool(user.city_id and obj_city == user.city_id)

        if user.role in ("SCHOOL_ADMIN", "TEACHER"):
            if not school_field:
                return False
            obj_school = getattr(obj, school_field, None)
            if include_null and obj_school is None:
                return True
            return bool(user.school_id and obj_school == user.school_id)

        if user.role == "PARENT":
            if include_null and school_field:
                obj_school = getattr(obj, school_field, None)
                return obj_school is None or obj_school == user.school_id
            if not parent_field:
                return False
            obj_parent = getattr(obj, parent_field, None)
            return bool(obj_parent == user.id)

        return False
