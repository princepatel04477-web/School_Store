"""
Demo data for the School Admin panel.

`seed_data` ships a handful of students, which is not enough to see the
roster, the class filters or the approval queue doing anything. This command
bulk-creates a realistic roster (batched, `ON CONFLICT DO NOTHING` on the
(school, gr_number) unique index), a few teacher logins, some pending
parent-added children, and then a year of orders with
`seed_perf_orders`.

    python manage.py seed_panel_demo --orders 30000
"""

import random
import uuid

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connection

from accounts.models import User
from common.constants import CLASS_NAMES, CLASS_SORT_ORDERS
from schools.models import School, Student

FIRST_NAMES = [
    "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan",
    "Krishna", "Ishaan", "Rohan", "Kabir", "Aryan", "Yash", "Dhruv", "Kunal",
    "Ananya", "Diya", "Ira", "Meera", "Sara", "Aadhya", "Anika", "Navya",
    "Riya", "Saanvi", "Tara", "Kavya", "Nisha", "Pooja", "Shreya", "Tanvi",
]
LAST_NAMES = [
    "Patel", "Shah", "Mehta", "Joshi", "Desai", "Verma", "Gupta", "Nair",
    "Reddy", "Iyer", "Kulkarni", "Bhatt", "Trivedi", "Pandya", "Chauhan", "Rao",
]


class Command(BaseCommand):
    help = "Seed a realistic roster + orders so the School Admin panel has data to show."

    def add_arguments(self, parser):
        parser.add_argument("--orders", type=int, default=30000)
        parser.add_argument("--per-class", type=int, default=6)
        parser.add_argument(
            "--skip-orders",
            action="store_true",
            help="Only build the roster, do not generate orders.",
        )

    def handle(self, *args, **options):
        if not School.objects.exists():
            self.stdout.write("Running baseline seed_data first...")
            call_command("seed_data")

        rng = random.Random(20261005)
        per_class = options["per_class"]
        parents = list(User.objects.filter(role=User.Role.PARENT))

        for school in School.objects.select_related("city").filter(active=True):
            school_parents = [p for p in parents if p.school_id == school.id] or parents
            students = []
            for class_name in CLASS_NAMES:
                sort_num = CLASS_SORT_ORDERS.get(class_name, 1)
                clean_cls = class_name.replace(" ", "")
                for section in ("A", "B", "C", "D"):
                    for index in range(per_class):
                        first = rng.choice(FIRST_NAMES)
                        last = rng.choice(LAST_NAMES)
                        gr_number = (
                            f"{school.code}-{clean_cls}{section}-"
                            f"{1000 + (sort_num * 100) + index}"
                        )
                        students.append(
                            Student(
                                id=uuid.uuid4(),
                                name=f"{first} {last}",
                                gr_number=gr_number,
                                class_name=class_name,
                                section=section,
                                gender=rng.choice(
                                    [
                                        Student.Gender.MALE,
                                        Student.Gender.FEMALE,
                                    ]
                                ),
                                school=school,
                                city_id=school.city_id,
                                parent=rng.choice(school_parents)
                                if school_parents and rng.random() < 0.85
                                else None,
                                approval_status=Student.ApprovalStatus.APPROVED,
                                source=Student.Source.IMPORT,
                                active=True,
                            )
                        )

            # A handful of parent-added children waiting for approval.
            for index in range(6):
                students.append(
                    Student(
                        id=uuid.uuid4(),
                        name=f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
                        gr_number=f"{school.code}-NEW-{2000 + index}",
                        class_name=str(rng.randint(1, 10)),
                        section=rng.choice(("A", "B", "C", "D")),
                        gender=rng.choice(
                            [Student.Gender.MALE, Student.Gender.FEMALE]
                        ),
                        school=school,
                        city_id=school.city_id,
                        parent=rng.choice(school_parents) if school_parents else None,
                        approval_status=Student.ApprovalStatus.PENDING,
                        source=Student.Source.PARENT_MANUAL,
                        active=True,
                    )
                )

            Student.objects.bulk_create(
                students, batch_size=500, ignore_conflicts=True
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"{school.code}: roster upserted ({len(students)} rows offered)."
                )
            )

            # Two extra teacher logins so the accounts tab is not empty.
            for index, (first, last) in enumerate(
                [("Sunita", "Raval"), ("Imran", "Qureshi")], start=1
            ):
                username = f"teacher_{school.code.lower().replace('-', '')}_{index}"
                if not User.objects.filter(username=username).exists():
                    teacher = User(
                        username=username,
                        first_name=first,
                        last_name=last,
                        email=f"{username}@{school.code.lower()}.edu.in",
                        phone=f"98100{school.code[:2].upper()}{index:03d}"[:20],
                        role=User.Role.TEACHER,
                        school=school,
                        city_id=school.city_id,
                        is_active=index == 1,  # one deactivated for the demo
                    )
                    teacher.set_password("Password@123")
                    teacher.save()

        if not options["skip_orders"]:
            call_command("seed_perf_orders", "--count", str(options["orders"]), "--reset")
            # Keep the denormalised class copy in sync for COPY-loaded rows.
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE orders_order AS o
                       SET student_class = s."class"
                      FROM schools_student AS s
                     WHERE s.id = o.student_id
                       AND o.student_class IS DISTINCT FROM s."class";
                    """
                )
                cursor.execute("ANALYZE schools_student;")

        self.stdout.write(self.style.SUCCESS("School Admin demo data ready."))
