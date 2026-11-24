from django.db import migrations


def forwards(apps, schema_editor):
    from catalog.kv_photos import apply_plain_photos
    from common.cache_utils import invalidate_catalog_cache

    apply_plain_photos(
        apps.get_model("schools", "School"),
        apps.get_model("catalog", "Product"),
    )
    # The public catalogue is cached; show the new photo order straight away.
    invalidate_catalog_cache()


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0018_paused_by_school"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
