"""
Django settings for School Store.

Performance Architecture (P1–P8):
- Target load (P1): ~500 concurrent users, 200 RPS peak on a single modest server.
- Network budget (P2): 200 RPS * 30 KB * 8 bits = 48 Mbps. All list APIs are paginated
  with PAGE_SIZE=25 and MAX_PAGE_SIZE=50.
- Indexed lookups (P3): Every request-path query uses composite B-tree indexes.
- UUID v4 PKs (P4): Generated in application memory via uuid.uuid4.
- Background jobs (P5): Slow tasks (imports, exports, reports, emails) run in Celery over Redis.
- Synchronous transactions (P6): Orders, payments, and stock updates run in atomic DB transactions.
- Bounded DB Connection Pool (P7):
    PostgreSQL max_connections = 100
    Web workers (4 Gunicorn workers) x Pool max_size (10) = 40 connections
    Celery workers (4 processes)     x Pool max_size (2)  =  8 connections
    Admin / maintenance headroom                          = 10 connections
    ----------------------------------------------------------------------
    Total maximum connections                             = 58 << 100 (max_connections)
  Set DB_POOL_MAX_SIZE per process group (10 for web, 2 for Celery). Django's
  persistent connection wrappers have a 60-second age; psycopg's bounded pool
  limits the number of PostgreSQL connections. PgBouncer is an optional alternative
  (see infra/pgbouncer.ini), not an additional pool to stack on top of this pool.
- Redis caching (P8): Read-heavy catalogue & school lists cached in Redis with explicit invalidation.
"""

import os
import sys
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "django-insecure-school-store-high-throughput-secret-key-2026",
)

DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"


def _env_list(name):
    return [v.strip() for v in os.environ.get(name, "").split(",") if v.strip()]


ALLOWED_HOSTS = _env_list("DJANGO_ALLOWED_HOSTS") or ["*"]
# Render injects the service's public hostname.
if os.environ.get("RENDER_EXTERNAL_HOSTNAME") and ALLOWED_HOSTS != ["*"]:
    ALLOWED_HOSTS.append(os.environ["RENDER_EXTERNAL_HOSTNAME"])

# Production: set CORS_ALLOWED_ORIGINS to the frontend origin(s), comma separated.
# Unset (local dev) keeps the old allow-all behaviour.
CORS_ALLOWED_ORIGINS = _env_list("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_ALL_ORIGINS = not CORS_ALLOWED_ORIGINS
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = [
    "https://*.e2b.app",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
    *CORS_ALLOWED_ORIGINS,
]

if not DEBUG:
    # Render terminates TLS and forwards the original scheme.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Postgres features (trigram indexes powering indexed `?search=`)
    "django.contrib.postgres",
    # Third-party
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    # School Store domain apps
    "common",
    "schools",
    "accounts",
    "catalog",
    "inventory",
    "orders",
    "analytics",
    "panel",
    "boss",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Custom User Model (UUID v4 PK)
AUTH_USER_MODEL = "accounts.User"

# Database & Bounded Connection Pool (Rule P7)
# Web workers (4) x Pool max_size (10) + Job workers (4) x Pool max_size (2) = 48 connections < 100 max_connections
DB_POOL_MIN_SIZE = int(os.environ.get("DB_POOL_MIN_SIZE", "2"))
DB_POOL_MAX_SIZE = int(os.environ.get("DB_POOL_MAX_SIZE", "10"))
DB_CONN_MAX_AGE = int(os.environ.get("DB_CONN_MAX_AGE", "60"))
USE_DB_POOL = (
    os.environ.get("USE_DB_POOL", "1") == "1"
    and "test" not in sys.argv
)

def _database_from_url(url):
    """Parse DATABASE_URL (e.g. Neon's postgresql://user:pass@host/db?sslmode=require)."""
    u = urlparse(url)
    query = {k: v[0] for k, v in parse_qs(u.query).items()}
    options = {"sslmode": query.get("sslmode", "require")}
    return {
        "NAME": unquote(u.path.lstrip("/")),
        "USER": unquote(u.username or ""),
        "PASSWORD": unquote(u.password or ""),
        "HOST": u.hostname or "",
        "PORT": str(u.port or 5432),
        "OPTIONS": options,
    }


_pool_options = (
    {
        "min_size": DB_POOL_MIN_SIZE,
        "max_size": DB_POOL_MAX_SIZE,
        "timeout": 30,
        # Neon suspends idle computes; drop idle connections before that happens.
        "max_idle": int(os.environ.get("DB_POOL_MAX_IDLE", "120")),
    }
    if USE_DB_POOL
    else None
)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "school_store"),
        "USER": os.environ.get("POSTGRES_USER", "postgres"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
        "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        # psycopg's connection pool manages connection lifetime itself;
        # Django 5.2 rejects CONN_MAX_AGE > 0 when a pool is configured.
        "CONN_MAX_AGE": 0 if ("test" in sys.argv or USE_DB_POOL) else DB_CONN_MAX_AGE,
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {},
    }
}
if os.environ.get("DATABASE_URL"):
    DATABASES["default"].update(_database_from_url(os.environ["DATABASE_URL"]))
if _pool_options:
    DATABASES["default"]["OPTIONS"]["pool"] = _pool_options

# Redis Cache (Rule P8 - catalogue and school lists with explicit invalidation)
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")

# --------------------------------------------------------------------------- #
# Catalogue read path (hottest endpoint)
#   - Catalogue lists are cached in Redis keyed by (school, category) with a
#     short TTL *and* explicit invalidation (version bump) whenever a product,
#     variant, category, or price changes.
#   - Stock is NEVER stored in that key: availability is returned as an
#     in-stock / low / out flag fetched fresh on every request.
# --------------------------------------------------------------------------- #
CATALOG_CACHE_TTL = int(os.environ.get("CATALOG_CACHE_TTL", "60"))

# Product images live in object storage behind a CDN. The API stores and
# returns URLs only — Django never serves image bytes. Thumbnails are produced
# by the CDN's on-the-fly resize parameters; the template receives the original
# object URL ({url}) and the correct query separator ({sep}).
# Works out of the box with Cloudflare Images / imgix / Supabase-style CDNs.
CATALOG_THUMBNAIL_TEMPLATE = os.environ.get(
    "CATALOG_THUMBNAIL_TEMPLATE", "{url}{sep}width=320&quality=70"
)
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": f"{REDIS_URL}/1",
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            "CONNECTION_POOL_KWARGS": {"max_connections": 20},
        },
        "KEY_PREFIX": "school_store",
        "TIMEOUT": 300,
    }
}

# Celery Background Job Runner (Rule P5)
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", f"{REDIS_URL}/0")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", f"{REDIS_URL}/2")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "Asia/Kolkata"
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 600
# Tests run background jobs inline so HTTP + job behaviour can be asserted together.
CELERY_TASK_ALWAYS_EAGER = os.environ.get("CELERY_TASK_ALWAYS_EAGER", "0") == "1" or (
    "test" in sys.argv
)
CELERY_TASK_EAGER_PROPAGATES = CELERY_TASK_ALWAYS_EAGER

# Nightly drift correction for the dashboard rollups: the last 7 days are
# recomputed from the raw order tables so any missed incremental refresh is
# repaired within a day.
from celery.schedules import crontab  # noqa: E402

CELERY_BEAT_SCHEDULE = {
    "analytics-nightly-rollup-repair": {
        "task": "analytics.recompute_recent_days",
        "schedule": crontab(
            hour=int(os.environ.get("ROLLUP_REPAIR_HOUR", "2")),
            minute=int(os.environ.get("ROLLUP_REPAIR_MINUTE", "0")),
        ),
    },
}

# --------------------------------------------------------------------------- #
# Boss dashboard (prompt 9)
#   - every KPI/chart response is cached in Redis for BOSS_DASHBOARD_CACHE_TTL
#     seconds, keyed by the exact filter combination
#   - the stock-value aggregate is cached longer because stock only moves on
#     checkout / restock and the number is advisory
# --------------------------------------------------------------------------- #
BOSS_DASHBOARD_CACHE_TTL = int(os.environ.get("BOSS_DASHBOARD_CACHE_TTL", "60"))
BOSS_STOCK_VALUE_CACHE_TTL = int(os.environ.get("BOSS_STOCK_VALUE_CACHE_TTL", "180"))

# Django REST Framework & JWT Authentication
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "accounts.authentication.ZeroQueryJWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "common.pagination.BoundedPageNumberPagination",
    "PAGE_SIZE": 25,
    # Keep `?format=` free for our own endpoints (?format=csv on the import
    # template); DRF would otherwise treat it as a renderer override.
    "URL_FORMAT_OVERRIDE": None,
    # Rate limits for brute-force-sensitive endpoints (Prompt 4, requirement 6)
    "DEFAULT_THROTTLE_RATES": {
        "student_claim_user": os.environ.get("STUDENT_CLAIM_USER_RATE", "10/hour"),
        "student_claim_ip": os.environ.get("STUDENT_CLAIM_IP_RATE", "30/hour"),
        "public_catalog": os.environ.get("PUBLIC_CATALOG_RATE", "120/min"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=2),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": False,
    "UPDATE_LAST_LOGIN": False,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# --------------------------------------------------------------------------- #
# Bulk import limits (Prompt 4, requirement 3)
#   - uploads capped at 5 MB and 5,000 rows
#   - inserts run in batches of 500 with ON CONFLICT (school, gr_number) DO NOTHING
# --------------------------------------------------------------------------- #
STUDENT_IMPORT_MAX_BYTES = int(os.environ.get("STUDENT_IMPORT_MAX_BYTES", 5 * 1024 * 1024))
STUDENT_IMPORT_MAX_ROWS = int(os.environ.get("STUDENT_IMPORT_MAX_ROWS", 5000))
STUDENT_IMPORT_BATCH_SIZE = int(os.environ.get("STUDENT_IMPORT_BATCH_SIZE", 500))
STUDENT_IMPORT_PREVIEW_LIMIT = int(os.environ.get("STUDENT_IMPORT_PREVIEW_LIMIT", 50))

# --------------------------------------------------------------------------- #
# School Admin panel background exports (Prompt 5, requirement 4)
#   - the workbook is built by a Celery worker in streaming (write-only) mode
#   - the finished file is kept for EXPORT_FILE_TTL_DAYS days, then the link
#     stops working (purge_expired_exports deletes the bytes)
# --------------------------------------------------------------------------- #
EXPORT_MAX_ROWS = int(os.environ.get("EXPORT_MAX_ROWS", 200_000))
EXPORT_FILE_TTL_DAYS = int(os.environ.get("EXPORT_FILE_TTL_DAYS", 7))

# Uploaded files must never be held in memory for a 5 MB spreadsheet cap.
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
