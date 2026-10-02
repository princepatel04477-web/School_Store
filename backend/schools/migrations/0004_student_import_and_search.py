from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Prompt 4 additions to Student:
      - date_of_birth + approval_status + source
      - (school, approval_status) index for the pending-approval queue
      - functional `UPPER(...) varchar_pattern_ops` indexes so the student
        `?search=` prefix lookup is an index range scan (Rule P3: no
        sequential scans on a request path).
    """

    dependencies = [
        ("schools", "0003_alter_student_options"),
    ]

    operations = [
        migrations.AddField(
            model_name="student",
            name="date_of_birth",
            field=models.DateField(
                blank=True,
                help_text="Optional. Used as the second check when a parent claims a child.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="student",
            name="approval_status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending School Admin approval"),
                    ("APPROVED", "Approved"),
                ],
                default="APPROVED",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="student",
            name="source",
            field=models.CharField(
                choices=[
                    ("STAFF", "Added by school staff"),
                    ("IMPORT", "Bulk import"),
                    ("PARENT_MANUAL", "Added manually by parent"),
                ],
                default="STAFF",
                max_length=24,
            ),
        ),
        migrations.AddIndex(
            model_name="student",
            index=models.Index(
                fields=["school", "approval_status"],
                name="idx_student_school_approval",
            ),
        ),
        # `?search=` compiles to UPPER(name) LIKE UPPER('term%'); these
        # expression indexes let Postgres serve it with a bitmap/range scan.
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS idx_student_name_upper "
                "ON schools_student (UPPER(name) varchar_pattern_ops);"
                "\n"
                "CREATE INDEX IF NOT EXISTS idx_student_gr_upper "
                "ON schools_student (UPPER(gr_number) varchar_pattern_ops);"
            ),
            reverse_sql=(
                "DROP INDEX IF EXISTS idx_student_name_upper;"
                "\n"
                "DROP INDEX IF EXISTS idx_student_gr_upper;"
            ),
        ),
    ]
