from django.db import migrations


def forwards(apps, schema_editor):
    from catalog.kv_catalog import apply_kv_catalog
    from common.cache_utils import invalidate_catalog_cache

    apply_kv_catalog(
        apps.get_model("schools", "School"),
        apps.get_model("schools", "Grade"),
        apps.get_model("catalog", "Category"),
        apps.get_model("catalog", "Product"),
        apps.get_model("catalog", "ProductVariant"),
    )
    # The public catalogue is cached; show the new items straight away.
    invalidate_catalog_cache()


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0014_merge_20261013_1626"),
        ("schools", "0017_schoolbranch_udise_code"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
