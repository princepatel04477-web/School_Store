"""Copy the catalogue rules that live in Python into the Supabase catalogue API.

The Supabase functions in supabase/store_api.sql answer the public catalogue like
catalog/public.py does, but two rules are Python code, not data:

* photo thumbnails and alt text (catalog/kv_photos.py, catalog/images.py)
* class name aliases such as "5" -> "Class 5" (common/constants.py)

This command writes Python's answer for every stored product photo URL and every class
alias into store_api.photo_meta and store_api.class_alias. Run it after a deploy and after
photos change. It does nothing when the database has no store_api schema (local SQLite,
tests, or a database that is not on Supabase).
"""

from django.core.management.base import BaseCommand
from django.db import connection, transaction

from catalog.images import cdn_thumbnail_url
from catalog.kv_photos import alt_for_url, thumbnail_for_url
from catalog.models import Product
from common.constants import CLASS_ALIASES


class Command(BaseCommand):
    help = "Refresh store_api.photo_meta and store_api.class_alias on Supabase."

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            self.stdout.write("Not PostgreSQL; nothing to do.")
            return
        with connection.cursor() as cursor:
            cursor.execute("select to_regclass('store_api.photo_meta') is not null")
            if not cursor.fetchone()[0]:
                self.stdout.write("No store_api schema here; nothing to do.")
                return

        urls = set()
        for images in Product.objects.values_list("images", flat=True):
            for url in images or []:
                if isinstance(url, str) and url:
                    urls.add(url)
        photo_rows = [
            (url, thumbnail_for_url(url) or cdn_thumbnail_url(url), alt_for_url(url))
            for url in sorted(urls)
        ]
        alias_rows = sorted(CLASS_ALIASES.items())

        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("delete from store_api.photo_meta")
            cursor.executemany(
                "insert into store_api.photo_meta (url, thumbnail, alt) values (%s, %s, %s)", photo_rows
            )
            cursor.execute("delete from store_api.class_alias")
            cursor.executemany(
                "insert into store_api.class_alias (alias, name) values (%s, %s)", alias_rows
            )
        self.stdout.write(f"store_api: {len(photo_rows)} photo URLs, {len(alias_rows)} class aliases.")
