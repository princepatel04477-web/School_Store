from django.db import migrations


def forwards(apps, schema_editor):
    from catalog.kv_photos import apply_kv_photos
    from common.cache_utils import invalidate_catalog_cache

    apply_kv_photos(
        apps.get_model("schools", "School"),
        apps.get_model("catalog", "Product"),
    )
    # The public catalogue is cached; show the new photos straight away.
    invalidate_catalog_cache()


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0015_kv_catalog"),
        ("schools", "0017_schoolbranch_udise_code"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
