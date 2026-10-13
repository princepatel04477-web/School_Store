import django.db.models.deletion
import django.utils.timezone
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0010_product_idx_prod_sch_class_gen_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SizeChartRow",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("size_label", models.CharField(max_length=40)),
                ("height_cm_min", models.DecimalField(decimal_places=1, max_digits=5)),
                ("height_cm_max", models.DecimalField(decimal_places=1, max_digits=5)),
                ("weight_kg_min", models.DecimalField(decimal_places=1, max_digits=5)),
                ("weight_kg_max", models.DecimalField(decimal_places=1, max_digits=5)),
                ("shoulder_cm_min", models.DecimalField(decimal_places=1, max_digits=5)),
                ("shoulder_cm_max", models.DecimalField(decimal_places=1, max_digits=5)),
                (
                    "product",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="size_chart",
                        to="catalog.product",
                    ),
                ),
            ],
            options={
                "ordering": ["height_cm_min", "size_label"],
            },
        ),
        migrations.AddConstraint(
            model_name="sizechartrow",
            constraint=models.UniqueConstraint(
                fields=("product", "size_label"),
                name="uniq_sizechart_product_size",
            ),
        ),
        migrations.CreateModel(
            name="FitReading",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("shoulder_cm", models.DecimalField(decimal_places=1, max_digits=5)),
                ("confidence", models.DecimalField(decimal_places=3, max_digits=4)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fit_readings",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]
