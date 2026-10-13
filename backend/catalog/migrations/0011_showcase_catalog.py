from django.db import migrations


def forwards(apps, schema_editor):
    from catalog.showcase_catalog import apply_showcase_catalog
    from common.cache_utils import invalidate_catalog_cache

    apply_showcase_catalog(
        apps.get_model("schools", "School"),
        apps.get_model("schools", "SchoolBranch"),
        apps.get_model("schools", "Grade"),
        apps.get_model("catalog", "Category"),
        apps.get_model("catalog", "Product"),
        apps.get_model("catalog", "ProductVariant"),
        apps.get_model("inventory", "StockBalance"),
        apps.get_model("inventory", "StockMovement"),
    )
    # The public catalogue is cached; show the new photos and items straight away.
    invalidate_catalog_cache()


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0010_product_idx_prod_sch_class_gen_and_more"),
        ("inventory", "0003_stockbalance_is_low_stock_alter_stockmovement_reason_and_more"),
        ("schools", "0011_student_roster_phone"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
