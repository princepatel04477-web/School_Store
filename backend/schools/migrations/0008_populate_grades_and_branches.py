from django.db import migrations


GRADE_NAMES = [
    "Nursery",
    "Junior KG",
    "Senior KG",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
]


def populate_grades_and_branches(apps, schema_editor):
    Grade = apps.get_model("schools", "Grade")
    School = apps.get_model("schools", "School")
    SchoolBranch = apps.get_model("schools", "SchoolBranch")
    Student = apps.get_model("schools", "Student")
    Order = apps.get_model("orders", "Order")

    # 1. Populate the 15 Grade records with explicit sort_order (1-based)
    grade_map = {}
    for index, name in enumerate(GRADE_NAMES, start=1):
        grade_obj, _ = Grade.objects.get_or_create(
            name=name,
            defaults={"sort_order": index},
        )
        grade_map[name] = grade_obj
        grade_map[name.lower()] = grade_obj

    # 2. Map existing Student records' class_name to grade
    for student in Student.objects.all():
        raw_class = (student.class_name or "").strip()
        matched_grade = None

        if raw_class in grade_map:
            matched_grade = grade_map[raw_class]
        else:
            # Try lowercased or stripped class prefix, e.g. "Class 5" -> "5", "Grade 10" -> "10"
            normalized = raw_class.lower().replace("class", "").replace("grade", "").replace("std", "").strip()
            if normalized in grade_map:
                matched_grade = grade_map[normalized]

        if matched_grade:
            student.grade = matched_grade
            student.save(update_fields=["grade"])

    # 3. Create SchoolBranch for existing schools with a city, and link existing students/orders
    for school in School.objects.filter(city__isnull=False):
        branch, _ = SchoolBranch.objects.get_or_create(
            school=school,
            city=school.city,
            defaults={"active": school.active},
        )
        Student.objects.filter(school=school, branch__isnull=True).update(branch=branch)
        Order.objects.filter(school=school, branch__isnull=True).update(branch=branch)


def reverse_populate(apps, schema_editor):
    # Data migration reverse can be a no-op or clear references if needed
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("schools", "0007_grade_schoolbranch_alter_student_options_and_more"),
        ("orders", "0006_order_branch_order_idx_order_branch_created"),
    ]

    operations = [
        migrations.RunPython(populate_grades_and_branches, reverse_code=reverse_populate),
    ]
