import django.db.models.deletion
import django.utils.timezone
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0007_order_payment_method"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("schools", "0011_student_roster_phone"),
    ]

    operations = [
        migrations.CreateModel(
            name="PhotoConsent",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("purpose", models.CharField(choices=[("NOTEBOOK", "Photo notebook"), ("ID_CARD", "Student ID card")], max_length=16)),
                ("policy_version", models.CharField(max_length=40)),
                ("keep_for_next_year", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("ip", models.CharField(blank=True, default="", max_length=45)),
                ("user_agent", models.CharField(blank=True, default="", max_length=300)),
                ("withdrawn_at", models.DateTimeField(blank=True, null=True)),
                ("parent", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="photo_consents", to=settings.AUTH_USER_MODEL)),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="photo_consents", to="schools.student")),
            ],
        ),
        migrations.AddIndex(
            model_name="photoconsent",
            index=models.Index(fields=["student", "purpose"], name="idx_photoconsent_student"),
        ),
        migrations.AddConstraint(
            model_name="photoconsent",
            constraint=models.UniqueConstraint(
                condition=models.Q(("withdrawn_at__isnull", True)),
                fields=("parent", "student", "purpose"),
                name="uniq_live_photo_consent",
            ),
        ),
    ]
