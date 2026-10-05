from decimal import Decimal
from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import User
from common.cache_utils import invalidate_school_cache
from schools.models import City, School, SchoolBranch


class Command(BaseCommand):
    help = "Seed additional dummy schools, branches, and school admins for testing and demonstration."

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            type=str,
            default="Password@123",
            help="Default password for seeded school admins (default: Password@123)",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        default_password = options["password"]

        # Ensure Cities exist
        cities_spec = [
            {"code": "SUR", "name": "Surat", "state": "Gujarat"},
            {"code": "AMD", "name": "Ahmedabad", "state": "Gujarat"},
            {"code": "BDQ", "name": "Vadodara", "state": "Gujarat"},
            {"code": "GN", "name": "Gandhinagar", "state": "Gujarat"},
        ]
        cities = {}
        for c in cities_spec:
            obj, _ = City.objects.update_or_create(
                code=c["code"],
                defaults={"name": c["name"], "state": c["state"], "active": True},
            )
            cities[c["code"]] = obj

        # Dummy Schools specification
        dummy_schools_spec = [
            {
                "code": "RIV-AMD",
                "name": "The Riverside School Ahmedabad",
                "city": cities["AMD"],
                "commission_rate": Decimal("11.00"),
                "address": "307, Airport Rd, Hansol, Ahmedabad, Gujarat 380012",
                "contact_email": "info@riversideschool.edu.in",
                "contact_phone": "+91-79-22861323",
                "admin": {
                    "username": "school_admin_riverside",
                    "email": "principal@riversideschool.edu.in",
                    "first_name": "Kiran",
                    "last_name": "Sethi",
                    "phone": "9800000010",
                },
            },
            {
                "code": "STX-SUR",
                "name": "St. Xavier's High School Surat",
                "city": cities["SUR"],
                "commission_rate": Decimal("9.00"),
                "address": "Ghod Dod Road, Athwa, Surat, Gujarat 395007",
                "contact_email": "contact@stxavierssurat.ac.in",
                "contact_phone": "+91-261-2651122",
                "admin": {
                    "username": "school_admin_stxaviers",
                    "email": "principal@stxavierssurat.ac.in",
                    "first_name": "Father",
                    "last_name": "Francis",
                    "phone": "9800000011",
                },
            },
            {
                "code": "PIS-SUR",
                "name": "Podar International School Surat",
                "city": cities["SUR"],
                "commission_rate": Decimal("10.00"),
                "address": "Opp. Prime Market, Althan Road, Surat, Gujarat 395017",
                "contact_email": "admissions.surat@podar.org",
                "contact_phone": "+91-261-2394500",
                "admin": {
                    "username": "school_admin_podar",
                    "email": "principal.surat@podar.org",
                    "first_name": "Sunita",
                    "last_name": "Kapadia",
                    "phone": "9800000012",
                },
            },
            {
                "code": "SAS-AMD",
                "name": "Shanti Asiatic School Ahmedabad",
                "city": cities["AMD"],
                "commission_rate": Decimal("8.50"),
                "address": "Shela, Off S.P. Ring Road, Bopal, Ahmedabad, Gujarat 380058",
                "contact_email": "inquiry@shantiasiatic.com",
                "contact_phone": "+91-79-66170000",
                "admin": {
                    "username": "school_admin_shanti",
                    "email": "principal@shantiasiatic.com",
                    "first_name": "Manju",
                    "last_name": "Malhotra",
                    "phone": "9800000013",
                },
            },
            {
                "code": "NAV-BDQ",
                "name": "Navrachana School Vadodara",
                "city": cities["BDQ"],
                "commission_rate": Decimal("12.00"),
                "address": "Sama Road, Vadodara, Gujarat 390008",
                "contact_email": "navrachanasama@navrachana.edu.in",
                "contact_phone": "+91-265-2793400",
                "admin": {
                    "username": "school_admin_navrachana",
                    "email": "principal@navrachana.edu.in",
                    "first_name": "Bijoylaxmi",
                    "last_name": "Nandy",
                    "phone": "9800000014",
                },
            },
            {
                "code": "DPS-GN",
                "name": "Delhi Public School Gandhinagar",
                "city": cities["GN"],
                "commission_rate": Decimal("9.50"),
                "address": "Koba-Ambapur Link Road, Gandhinagar, Gujarat 382426",
                "contact_email": "info@dpsgandhinagar.com",
                "contact_phone": "+91-79-30510500",
                "admin": {
                    "username": "school_admin_dpsgn",
                    "email": "principal@dpsgandhinagar.com",
                    "first_name": "Atul",
                    "last_name": "Bhatt",
                    "phone": "9800000015",
                },
            },
        ]

        created_schools = []
        for s_spec in dummy_schools_spec:
            school, _ = School.objects.update_or_create(
                code=s_spec["code"],
                defaults={
                    "name": s_spec["name"],
                    "city": s_spec["city"],
                    "commission_rate": s_spec["commission_rate"],
                    "address": s_spec["address"],
                    "contact_email": s_spec["contact_email"],
                    "contact_phone": s_spec["contact_phone"],
                    "home_delivery_enabled": True,
                    "school_pickup_enabled": True,
                    "active": True,
                },
            )

            branch, _ = SchoolBranch.objects.update_or_create(
                school=school,
                city=s_spec["city"],
                defaults={"active": True},
            )

            # Optional: School Admin account for logging in / view-as
            admin_info = s_spec.get("admin")
            if admin_info:
                admin_user, _ = User.objects.update_or_create(
                    username=admin_info["username"],
                    defaults={
                        "email": admin_info["email"],
                        "first_name": admin_info["first_name"],
                        "last_name": admin_info["last_name"],
                        "role": User.Role.SCHOOL_ADMIN,
                        "phone": admin_info["phone"],
                        "city": s_spec["city"],
                        "school": school,
                        "branch": branch,
                        "is_staff": False,
                        "is_superuser": False,
                        "is_active": True,
                    },
                )
                admin_user.set_password(default_password)
                admin_user.save(update_fields=["password"])

            created_schools.append(school)
            self.stdout.write(
                self.style.SUCCESS(f"  + Added school: {school.name} [{school.code}] in {s_spec['city'].name}")
            )

        invalidate_school_cache()
        self.stdout.write(
            self.style.SUCCESS(f"Successfully seeded {len(created_schools)} dummy schools and branches.")
        )
