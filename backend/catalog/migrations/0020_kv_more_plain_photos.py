from django.db import migrations


def forwards(apps, schema_editor):
    from catalog.kv_photos import apply_plain_photos
    from common.cache_utils import invalidate_catalog_cache

    # Twelve more plain shots (girls shirts, tunic, kurta, cardigan, leggings,
    # track pants, jackets, coatie, sweater, grey socks) go in front of the
    # model photo. Items already done are left as they are.
    apply_plain_photos(
        apps.get_model("schools", "School"),
        apps.get_model("catalog", "Product"),
    )
    invalidate_catalog_cache()


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0019_kv_plain_photos"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
