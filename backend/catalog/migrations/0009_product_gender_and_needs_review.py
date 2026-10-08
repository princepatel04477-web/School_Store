from django.db import migrations, models


def set_existing_products_gender_null(apps, schema_editor):
    Product = apps.get_model("catalog", "Product")
    Product.objects.all().update(gender=None, needs_review=True)


def reverse_set_gender(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0008_remove_product_product_class_range_valid_and_more"),
        ("schools", "0009_update_grade_names"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="needs_review",
            field=models.BooleanField(
                default=False,
                db_index=True,
                help_text="Flag indicating this product needs review (e.g. unassigned gender).",
            ),
        ),
        migrations.AlterField(
            model_name="product",
            name="gender",
            field=models.CharField(
                blank=False,
                choices=[("boy", "Boy"), ("girl", "Girl"), ("unisex", "Unisex")],
                help_text="Designated gender: boy, girl, or unisex.",
                max_length=10,
                null=True,
            ),
        ),
        migrations.RunPython(
            set_existing_products_gender_null,
            reverse_code=reverse_set_gender,
        ),
    ]
