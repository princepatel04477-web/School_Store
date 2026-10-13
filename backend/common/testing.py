"""Helpers for the test suite."""

import unittest

from django.db import connection

# The project targets PostgreSQL. A handful of tests exercise Postgres-only behaviour
# (query plans, COPY, ON CONFLICT batching, GROUPING SETS rollups, real row locks) and
# cannot run on the SQLite used by a plain `manage.py test`. Run them with:
#     USE_POSTGRES_FOR_TESTS=1 POSTGRES_USER=postgres POSTGRES_PASSWORD=... python manage.py test
requires_postgres = unittest.skipUnless(
    connection.vendor == "postgresql",
    "requires PostgreSQL (set USE_POSTGRES_FOR_TESTS=1 to run it)",
)
