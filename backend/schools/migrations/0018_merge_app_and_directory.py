from django.db import migrations


class Migration(migrations.Migration):
    """Joins the app branch (measurement source) and the school directory branch (UDISE+ codes)."""

    dependencies = [
        ("schools", "0016_alter_studentmeasurement_source"),
        ("schools", "0017_schoolbranch_udise_code"),
    ]

    operations = []
