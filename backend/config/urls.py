from django.contrib import admin
from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path


def health_check(request):
    db_ok = False
    redis_ok = False
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1;")
        db_ok = cursor.fetchone()[0] == 1
    cache.set("health:ping", "pong", timeout=10)
    redis_ok = cache.get("health:ping") == "pong"
    return JsonResponse(
        {
            "status": "ok" if (db_ok and redis_ok) else "degraded",
            "database": "connected" if db_ok else "error",
            "redis": "connected" if redis_ok else "error",
        }
    )


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check, name="health_check"),
    path("api/auth/", include("accounts.urls")),
    path("api/accounts/", include("accounts.urls")),
    path("api/", include("schools.urls")),
    path("api/", include("catalog.urls")),
    path("api/", include("inventory.urls")),
    path("api/", include("orders.urls")),
    path("api/panel/", include("panel.urls")),
    path("api/boss/", include("boss.urls")),
]
