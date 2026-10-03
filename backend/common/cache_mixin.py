import json

from django.core.cache import cache
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from .cache_utils import versioned_cache_key


class VersionedListCacheMixin:
    """Cache safe, scoped GET-list response data behind an explicit version key."""

    cache_version_key = None
    cache_namespace = "lists"
    cache_timeout = 300

    def list(self, request, *args, **kwargs):
        if self.action != "list" or not self.cache_version_key:
            return super().list(request, *args, **kwargs)

        user = request.user
        scope = ":".join(
            str(value or "")
            for value in (
                getattr(user, "role", ""),
                getattr(user, "id", ""),
                getattr(user, "city_id", ""),
                getattr(user, "school_id", ""),
            )
        )
        request_key = f"{request.build_absolute_uri()}\x1f{scope}"
        try:
            key = versioned_cache_key(
                self.cache_namespace,
                request_key,
                self.cache_version_key,
            )
            cached_data = cache.get(key)
        except Exception:
            # Redis is an optimization, not a dependency for serving read APIs.
            key = None
            cached_data = None

        if cached_data is not None:
            return Response(cached_data)

        response = super().list(request, *args, **kwargs)
        if key and response.status_code == 200:
            try:
                cache.set(
                    key,
                    json.loads(JSONRenderer().render(response.data)),
                    timeout=self.cache_timeout,
                )
            except Exception:
                pass
        return response
