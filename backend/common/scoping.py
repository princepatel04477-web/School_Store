"""
Single reusable scoping layer (Prompt 3 Requirements 1, 2, 5).

Every scope filter is a single WHERE clause on an indexed column
(city_id, school_id, parent_id, or id) stored directly on the row itself.
No scope filter ever uses a multi-table join or a subquery.
"""

from django.db import models
from django.db.models import Q


def apply_user_scope(
    qs: models.QuerySet,
    user,
    *,
    city_field: str | None = "city_id",
    school_field: str | None = "school_id",
    parent_field: str | None = "parent_id",
    include_null_scope_for_catalog: bool = False,
) -> models.QuerySet:
    """
    Filters any QuerySet by the logged-in user's scope using only indexed
    columns stored directly on the row itself (zero joins, zero subqueries).
    """
    if not user or not getattr(user, "is_authenticated", False):
        return qs.none()

    role = getattr(user, "role", None)
    if role == "BOSS" or getattr(user, "is_superuser", False):
        return qs

    if role == "ADMIN":
        city_id = getattr(user, "city_id", None)
        if not city_id or not city_field:
            return qs.none()
        if include_null_scope_for_catalog:
            return qs.filter(
                Q(**{city_field: city_id}) | Q(**{f"{city_field}__isnull": True})
            )
        return qs.filter(**{city_field: city_id})

    if role in ("SCHOOL_ADMIN", "TEACHER"):
        school_id = getattr(user, "school_id", None)
        if not school_id or not school_field:
            return qs.none()
        if include_null_scope_for_catalog:
            return qs.filter(
                Q(**{school_field: school_id}) | Q(**{f"{school_field}__isnull": True})
            )
        return qs.filter(**{school_field: school_id})

    if role == "PARENT":
        if include_null_scope_for_catalog and school_field:
            school_id = getattr(user, "school_id", None)
            if school_id:
                return qs.filter(
                    Q(**{school_field: school_id})
                    | Q(**{f"{school_field}__isnull": True})
                )
            return qs.filter(**{f"{school_field}__isnull": True})
        if not parent_field:
            return qs.none()
        return qs.filter(**{parent_field: user.id})

    return qs.none()


class ScopedQuerySet(models.QuerySet):
    """
    Reusable QuerySet with `.for_user(user)` method that applies the model's
    configured scope fields in a single indexed WHERE clause.
    """

    def for_user(self, user):
        meta_scope = getattr(self.model, "SCOPE_FIELDS", {})
        return apply_user_scope(
            self,
            user,
            city_field=meta_scope.get("city_field", "city_id"),
            school_field=meta_scope.get("school_field", "school_id"),
            parent_field=meta_scope.get("parent_field", "parent_id"),
            include_null_scope_for_catalog=meta_scope.get(
                "include_null_scope_for_catalog", False
            ),
        )


class ScopedManager(models.Manager.from_queryset(ScopedQuerySet)):
    pass


class ScopedQuerysetMixin:
    """
    Reusable ViewSet mixin that enforces role-based scoping on `get_queryset()`.
    ViewSets can override `scope_city_field`, `scope_school_field`,
    `scope_parent_field`, and `include_null_scope_for_catalog`.
    """

    scope_city_field: str | None = "city_id"
    scope_school_field: str | None = "school_id"
    scope_parent_field: str | None = "parent_id"
    include_null_scope_for_catalog: bool = False

    def scope_queryset(self, qs):
        return apply_user_scope(
            qs,
            self.request.user,
            city_field=self.scope_city_field,
            school_field=self.scope_school_field,
            parent_field=self.scope_parent_field,
            include_null_scope_for_catalog=self.include_null_scope_for_catalog,
        )

    def get_queryset(self):
        base_qs = super().get_queryset()
        return self.scope_queryset(base_qs)
