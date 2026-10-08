from django.db import migrations


def update_grade_names(apps, schema_editor):
    from common.constants import CLASSES

    Grade = apps.get_model("schools", "Grade")
    Student = apps.get_model("schools", "Student")
    Order = apps.get_model("orders", "Order")

    # Update or create each canonical Grade in the single source of truth order
    for c in CLASSES:
        # Match by sort_order first
        gr = Grade.objects.filter(sort_order=c["sort_order"]).first()
        if gr:
            gr.name = c["name"]
            gr.save(update_fields=["name"])
        else:
            gr = Grade.objects.filter(name=c["name"]).first()
            if gr:
                gr.sort_order = c["sort_order"]
                gr.save(update_fields=["sort_order"])
            else:
                Grade.objects.create(name=c["name"], sort_order=c["sort_order"])

    # Update Student and Order class_name / student_class to match new grade names
    for student in Student.objects.filter(grade__isnull=False):
        if student.class_name != student.grade.name:
            student.class_name = student.grade.name
            student.save(update_fields=["class_name"])
            Order.objects.filter(student_id=student.pk).update(student_class=student.grade.name)


def reverse_update(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("schools", "0008_populate_grades_and_branches"),
        ("orders", "0006_order_branch_order_idx_order_branch_created"),
    ]

    operations = [
        migrations.RunPython(update_grade_names, reverse_code=reverse_update),
    ]
