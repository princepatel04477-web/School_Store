from decimal import Decimal
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import User
from analytics.tasks import refresh_daily_sales_summary
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance, StockMovement
from orders.models import Order, OrderItem, OrderStatusEvent
from schools.models import City, School, Student


class Command(BaseCommand):
    help = (
        "Seed baseline data: 2 cities, 3 schools, 4 categories, sample products "
        "with variants, one user per role, sample students, and initial orders."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            type=str,
            default="Password@123",
            help="Default password for seeded users (default: Password@123)",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        default_password = options["password"]

        # 1. Two Cities
        surat, _ = City.objects.update_or_create(
            code="SUR",
            defaults={"name": "Surat", "state": "Gujarat", "active": True},
        )
        ahmedabad, _ = City.objects.update_or_create(
            code="AMD",
            defaults={"name": "Ahmedabad", "state": "Gujarat", "active": True},
        )
        self.stdout.write(self.style.SUCCESS(f"Seeded 2 cities: {surat}, {ahmedabad}"))

        # 2. Three Schools
        dps_surat, _ = School.objects.update_or_create(
            code="DPS-SUR",
            defaults={
                "city": surat,
                "name": "Delhi Public School Surat",
                "active": True,
                "commission_rate": Decimal("10.00"),
                "address": "Silent Zone, Dumas Road, Surat, Gujarat 394550",
                "contact_email": "info@dpssurat.edu.in",
                "contact_phone": "+91-261-2700100",
            },
        )
        fhs_surat, _ = School.objects.update_or_create(
            code="FHS-SUR",
            defaults={
                "city": surat,
                "name": "Fountainhead School Surat",
                "active": True,
                "commission_rate": Decimal("8.50"),
                "address": "Kunkni Gam, Rander-Dandi Road, Surat, Gujarat 395005",
                "contact_email": "admin@fountainheadschools.org",
                "contact_phone": "+91-261-2800200",
            },
        )
        udgam_amd, _ = School.objects.update_or_create(
            code="UDG-AMD",
            defaults={
                "city": ahmedabad,
                "name": "Udgam School for Children",
                "active": True,
                "commission_rate": Decimal("12.00"),
                "address": "Thaltej, Ahmedabad, Gujarat 380054",
                "contact_email": "office@udgamschool.com",
                "contact_phone": "+91-79-26850000",
            },
        )
        schools = [dps_surat, fhs_surat, udgam_amd]
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded 3 schools: {', '.join(s.code for s in schools)}"
            )
        )

        # 3. One User per Role (plus extra parents for multi-school testing)
        users_spec = [
            {
                "username": "boss",
                "email": "boss@schoolstore.in",
                "first_name": "Vikram",
                "last_name": "Mehta",
                "role": User.Role.BOSS,
                "phone": "9800000001",
                "city": None,
                "school": None,
                "is_staff": True,
                "is_superuser": True,
            },
            {
                "username": "admin_surat",
                "email": "admin.surat@schoolstore.in",
                "first_name": "Neha",
                "last_name": "Desai",
                "role": User.Role.ADMIN,
                "phone": "9800000002",
                "city": surat,
                "school": None,
                "is_staff": True,
                "is_superuser": False,
            },
            {
                "username": "school_admin_dps",
                "email": "principal@dpssurat.edu.in",
                "first_name": "Rajesh",
                "last_name": "Sharma",
                "role": User.Role.SCHOOL_ADMIN,
                "phone": "9800000003",
                "city": surat,
                "school": dps_surat,
                "is_staff": False,
                "is_superuser": False,
            },
            {
                "username": "teacher_dps",
                "email": "anita.joshi@dpssurat.edu.in",
                "first_name": "Anita",
                "last_name": "Joshi",
                "role": User.Role.TEACHER,
                "phone": "9800000004",
                "city": surat,
                "school": dps_surat,
                "is_staff": False,
                "is_superuser": False,
            },
            {
                "username": "parent_rahul",
                "email": "rahul.patel@example.com",
                "first_name": "Rahul",
                "last_name": "Patel",
                "role": User.Role.PARENT,
                "phone": "9800000005",
                "city": surat,
                "school": dps_surat,
                "is_staff": False,
                "is_superuser": False,
            },
            {
                "username": "parent_priya",
                "email": "priya.shah@example.com",
                "first_name": "Priya",
                "last_name": "Shah",
                "role": User.Role.PARENT,
                "phone": "9800000006",
                "city": ahmedabad,
                "school": udgam_amd,
                "is_staff": False,
                "is_superuser": False,
            },
        ]

        created_users = {}
        for spec in users_spec:
            uname = spec["username"]
            user, _ = User.objects.update_or_create(
                username=uname,
                defaults={
                    "email": spec["email"],
                    "first_name": spec["first_name"],
                    "last_name": spec["last_name"],
                    "role": spec["role"],
                    "phone": spec["phone"],
                    "city": spec["city"],
                    "school": spec["school"],
                    "is_staff": spec["is_staff"],
                    "is_superuser": spec["is_superuser"],
                    "is_active": True,
                },
            )
            user.set_password(default_password)
            user.save(update_fields=["password"])
            created_users[uname] = user

        self.stdout.write(
            self.style.SUCCESS(
                "Seeded users per role (BOSS, ADMIN, SCHOOL_ADMIN, TEACHER, PARENT)"
            )
        )

        # 4. Students across the 3 schools
        students_spec = [
            ("Aarav Patel", "DPS-2026-001", "5", "A", Student.Gender.MALE, dps_surat, created_users["parent_rahul"]),
            ("Diya Patel", "DPS-2026-002", "8", "B", Student.Gender.FEMALE, dps_surat, created_users["parent_rahul"]),
            ("Kabir Verma", "DPS-2026-003", "5", "A", Student.Gender.MALE, dps_surat, None),
            ("Ananya Nair", "FHS-2026-001", "6", "A", Student.Gender.FEMALE, fhs_surat, created_users["parent_rahul"]),
            ("Vivaan Modi", "FHS-2026-002", "4", "C", Student.Gender.MALE, fhs_surat, None),
            ("Ishaan Shah", "UDG-2026-001", "7", "B", Student.Gender.MALE, udgam_amd, created_users["parent_priya"]),
            ("Meera Shah", "UDG-2026-002", "3", "A", Student.Gender.FEMALE, udgam_amd, created_users["parent_priya"]),
        ]
        seeded_students = []
        for name, gr, cls, sec, gender, school, parent in students_spec:
            st, _ = Student.objects.update_or_create(
                school=school,
                gr_number=gr,
                defaults={
                    "name": name,
                    "class_name": cls,
                    "section": sec,
                    "gender": gender,
                    "parent": parent,
                    "active": True,
                },
            )
            seeded_students.append(st)

        # 5. Four Core Categories
        categories_spec = [
            ("Uniforms", "uniforms", "Official school uniforms, shirts, trousers, skirts, and blazers.", 1),
            ("Shoes", "shoes", "Formal black school shoes and white PT canvas/sports shoes.", 2),
            ("Stationery", "stationery", "Notebooks, custom photo notebook covers, geometry boxes, and pens.", 3),
            ("ID Cards", "id-cards", "Personalised student PVC ID cards, lanyards, and badge holders.", 4),
        ]
        categories = {}
        for name, slug, desc, order in categories_spec:
            cat, _ = Category.objects.update_or_create(
                slug=slug,
                defaults={
                    "name": name,
                    "description": desc,
                    "display_order": order,
                    "active": True,
                },
            )
            categories[slug] = cat

        # 6. Products & ProductVariants (including customisation_schema for personalised products)
        products_spec = [
            {
                "name": "DPS Everyday Formal Half-Sleeve Shirt",
                "category": categories["uniforms"],
                "school": dps_surat,
                "description": "Breathable cotton-blend formal shirt with embroidered DPS crest.",
                "cost_price": Decimal("280.00"),
                "selling_price": Decimal("450.00"),
                "customisation_schema": {
                    "fields": [
                        {
                            "key": "house_badge",
                            "label": "House Colour",
                            "type": "select",
                            "required": False,
                            "options": ["Red", "Blue", "Green", "Yellow"],
                        }
                    ]
                },
                "variants": [
                    ("28 (Class 1-3)", "DPS-SHIRT-28", 350),
                    ("30 (Class 4-6)", "DPS-SHIRT-30", 420),
                    ("32 (Class 7-9)", "DPS-SHIRT-32", 300),
                    ("34 (Class 10-12)", "DPS-SHIRT-34", 200),
                ],
            },
            {
                "name": "Fountainhead Signature Polo Tee",
                "category": categories["uniforms"],
                "school": fhs_surat,
                "description": "Pique cotton polo t-shirt with Fountainhead logo.",
                "cost_price": Decimal("260.00"),
                "selling_price": Decimal("420.00"),
                "customisation_schema": {},
                "variants": [
                    ("S", "FHS-POLO-S", 250),
                    ("M", "FHS-POLO-M", 300),
                    ("L", "FHS-POLO-L", 220),
                ],
            },
            {
                "name": "Udgam Ceremonial Winter Blazer",
                "category": categories["uniforms"],
                "school": udgam_amd,
                "description": "Tailored navy blazer with Udgam School crest.",
                "cost_price": Decimal("850.00"),
                "selling_price": Decimal("1350.00"),
                "customisation_schema": {},
                "variants": [
                    ("30", "UDG-BLZ-30", 150),
                    ("32", "UDG-BLZ-32", 180),
                    ("34", "UDG-BLZ-34", 140),
                ],
            },
            {
                "name": "All-Weather Black Velcro School Shoes",
                "category": categories["shoes"],
                "school": None,
                "description": "Durable anti-skid black school shoes suitable for daily wear.",
                "cost_price": Decimal("420.00"),
                "selling_price": Decimal("699.00"),
                "customisation_schema": {},
                "variants": [
                    ("UK-2", "SHOE-BLK-UK2", 400),
                    ("UK-3", "SHOE-BLK-UK3", 500),
                    ("UK-4", "SHOE-BLK-UK4", 480),
                    ("UK-5", "SHOE-BLK-UK5", 390),
                ],
            },
            {
                "name": "Personalised Photo Notebook Pack (Set of 6)",
                "category": categories["stationery"],
                "school": None,
                "description": "172-page A4 single-line notebooks with custom student photo & name cover print.",
                "cost_price": Decimal("210.00"),
                "selling_price": Decimal("360.00"),
                "customisation_schema": {
                    "fields": [
                        {
                            "key": "cover_photo_url",
                            "label": "Cover Photo URL",
                            "type": "image_url",
                            "required": True,
                        },
                        {
                            "key": "printed_student_name",
                            "label": "Name to Print on Cover",
                            "type": "text",
                            "required": True,
                        },
                    ]
                },
                "variants": [
                    ("A4 Single Line (Pack of 6)", "STAT-NB-PHOTO-A4", 800),
                    ("A4 Unruled (Pack of 6)", "STAT-NB-PHOTO-UNR", 450),
                ],
            },
            {
                "name": "Smart RFID PVC Student ID Card with Lanyard",
                "category": categories["id-cards"],
                "school": None,
                "description": "CR80 glossy PVC ID card printed with student photo, GR number, and emergency contact.",
                "cost_price": Decimal("45.00"),
                "selling_price": Decimal("120.00"),
                "customisation_schema": {
                    "fields": [
                        {
                            "key": "id_photo_url",
                            "label": "Passport Photo URL",
                            "type": "image_url",
                            "required": True,
                        },
                        {
                            "key": "blood_group",
                            "label": "Blood Group",
                            "type": "select",
                            "required": True,
                            "options": ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
                        },
                        {
                            "key": "emergency_phone",
                            "label": "Emergency Contact Phone",
                            "type": "text",
                            "required": True,
                        },
                    ]
                },
                "variants": [
                    ("Standard CR80 + Lanyard", "IDCARD-STD-CR80", 2000),
                ],
            },
        ]

        all_variants = []
        for p_spec in products_spec:
            prod, _ = Product.objects.update_or_create(
                name=p_spec["name"],
                school=p_spec["school"],
                defaults={
                    "category": p_spec["category"],
                    "description": p_spec["description"],
                    "cost_price": p_spec["cost_price"],
                    "selling_price": p_spec["selling_price"],
                    "customisation_schema": p_spec["customisation_schema"],
                    "images": [f"https://placehold.co/600x600?text={p_spec['name'][:18].replace(' ', '+')}"],
                    "active": True,
                },
            )
            for size, sku, stock_qty in p_spec["variants"]:
                variant, _ = ProductVariant.objects.update_or_create(
                    sku=sku,
                    defaults={
                        "product": prod,
                        "size": size,
                        "active": True,
                    },
                )
                all_variants.append(variant)

                # School items are stocked in their school's city; generic items
                # receive independent city balances rather than one shared total.
                stock_cities = [prod.school.city] if prod.school_id else [surat, ahmedabad]
                for stock_city in stock_cities:
                    balance, created = StockBalance.objects.get_or_create(
                        city=stock_city,
                        variant=variant,
                        defaults={
                            "stock_quantity": stock_qty,
                            "low_stock_threshold": 20,
                        },
                    )
                    if created:
                        StockMovement.objects.create(
                            city=stock_city,
                            school_id=prod.school_id,
                            variant=variant,
                            quantity_change=stock_qty,
                            reason=StockMovement.Reason.INITIAL_STOCK,
                            created_by=created_users["boss"],
                        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(products_spec)} products and {len(all_variants)} variants across 4 categories."
            )
        )

        # 7. Seed a couple of sample orders if none exist yet
        if not Order.objects.filter(order_number__startswith="ORD-SEED-").exists():
            sample_student = seeded_students[0]
            v_shirt = ProductVariant.objects.get(sku="DPS-SHIRT-30")
            v_idcard = ProductVariant.objects.get(sku="IDCARD-STD-CR80")
            subtotal = v_shirt.product.selling_price * 2 + v_idcard.product.selling_price
            order = Order.objects.create(
                order_number="ORD-SEED-000001",
                placed_by=created_users["parent_rahul"],
                placed_by_role=User.Role.PARENT,
                student=sample_student,
                school=sample_student.school,
                city=sample_student.school.city,
                status=Order.Status.CONFIRMED,
                subtotal=subtotal,
                total=subtotal,
                payment_status=Order.PaymentStatus.PAID,
                razorpay_order_id="order_seed_rzp_001",
                razorpay_payment_id="pay_seed_rzp_001",
                delivery_details={
                    "recipient_name": "Rahul Patel",
                    "phone": "9800000005",
                    "address": "402, Green Residency, Vesu, Surat",
                    "pincode": "395007",
                },
            )
            OrderItem.objects.create(
                order=order,
                variant=v_shirt,
                category=v_shirt.product.category,
                quantity=2,
                unit_price_snapshot=v_shirt.product.selling_price,
                unit_cost_snapshot=v_shirt.product.cost_price,
                customisation_data={"house_badge": "Blue"},
            )
            OrderItem.objects.create(
                order=order,
                variant=v_idcard,
                category=v_idcard.product.category,
                quantity=1,
                unit_price_snapshot=v_idcard.product.selling_price,
                unit_cost_snapshot=v_idcard.product.cost_price,
                customisation_data={
                    "id_photo_url": "https://placehold.co/300x400?text=Aarav+Photo",
                    "blood_group": "O+",
                    "emergency_phone": "9800000005",
                },
            )
            OrderStatusEvent.objects.create(
                order=order,
                status=Order.Status.CONFIRMED,
                changed_by=created_users["parent_rahul"],
                note="Seeded initial paid order.",
            )
            refresh_daily_sales_summary()

        self.stdout.write(self.style.SUCCESS("Baseline seed completed successfully."))
