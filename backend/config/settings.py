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
  Can also sit behind PgBouncer in transaction pooling mode (see infra/pgbouncer.ini).
- Redis caching (P8): Read-heavy catalogue & school lists cached in Redis with explicit invalidation.
"""

import os
import sys
from datetime import timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "django-insecure-school-store-high-throughput-secret-key-2026",
)

DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

ALLOWED_HOSTS = ["*"]

CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = [
    "https://*.e2b.app",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    # School Store domain apps
    "common",
    "schools",
    "accounts",
    "catalog",
    "orders",
    "analytics",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
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
USE_DB_POOL = (
    os.environ.get("USE_DB_POOL", "1") == "1"
    and "test" not in sys.argv
)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "school_store"),
        "USER": os.environ.get("POSTGRES_USER", "postgres"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
        "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": (
            {
                "pool": {
                    "min_size": DB_POOL_MIN_SIZE,
                    "max_size": DB_POOL_MAX_SIZE,
                    "timeout": 30,
                }
            }
            if USE_DB_POOL
            else {}
        ),
    }
}

# Redis Cache (Rule P8 - catalogue and school lists with explicit invalidation)
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")

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
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
