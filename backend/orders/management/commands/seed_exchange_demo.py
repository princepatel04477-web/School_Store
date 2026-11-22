"""
Seed exchange demo command (Day 4 brief, Section 8).
Seeds test orders and users for size exchange acceptance demonstration.
Refuses to run unless settings.DEBUG is True.
"""

from decimal import Decimal
import datetime as dt
from pathlib import Path
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance
from orders.models import Order, OrderItem, OrderStatusEvent
from schools.models import City, School, Student

User = get_user_model()


class Command(BaseCommand):
    help = "Seeds test orders for Day 4 size exchange acceptance testing."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_exchange_demo can only run when DEBUG=True.")

        self.stdout.write("Seeding size exchange demo scenarios...")
        now = timezone.now()

        # 1. Base locations
        city, _ = City.objects.get_or_create(code="SUR", defaults={"name": "Surat"})
        other_city, _ = City.objects.get_or_create(code="DEL", defaults={"name": "Delhi"})

        school, _ = School.objects.get_or_create(
            code="DPS-SUR", city=city, defaults={"name": "DPS Surat"}
        )
        other_school, _ = School.objects.get_or_create(
            code="DPS-DEL", city=other_city, defaults={"name": "DPS Delhi"}
        )

        # 2. Users & Logins
        boss, _ = User.objects.get_or_create(
            username="boss_exchange_demo",
            defaults={"phone": "9800000001", "role": "BOSS", "first_name": "Demo", "last_name": "Boss"},
        )
        city_admin, _ = User.objects.get_or_create(
            username="cityadmin_surat_demo",
            defaults={"phone": "9800000002", "role": "ADMIN", "city": city, "first_name": "Surat", "last_name": "Admin"},
        )
        school_admin, _ = User.objects.get_or_create(
            username="schooladmin_dps_demo",
            defaults={"phone": "9800000003", "role": "SCHOOL_ADMIN", "school": school, "city": city, "first_name": "DPS", "last_name": "Admin"},
        )
        other_school_admin, _ = User.objects.get_or_create(
            username="schooladmin_delhi_demo",
            defaults={"phone": "9800000004", "role": "SCHOOL_ADMIN", "school": other_school, "city": other_city, "first_name": "Delhi", "last_name": "Admin"},
        )
        teacher, _ = User.objects.get_or_create(
            username="teacher_demo",
            defaults={"phone": "9800000005", "role": "TEACHER", "school": school, "city": city, "first_name": "Demo", "last_name": "Teacher"},
        )
        parent_a, _ = User.objects.get_or_create(
            username="parent_a_demo",
            defaults={"phone": "9876543210", "role": "PARENT", "city": city, "first_name": "Aarav", "last_name": "Parent"},
        )
        parent_b, _ = User.objects.get_or_create(
            username="parent_b_demo",
            defaults={"phone": "9876543211", "role": "PARENT", "city": city, "first_name": "Rohan", "last_name": "Parent"},
        )

        # Set passwords for demo users
        for u in (boss, city_admin, school_admin, other_school_admin, teacher, parent_a, parent_b):
            u.set_password("demo_pass_123")
            u.save()

        # Record logins in project demo-logins file
        logins_path = Path(settings.BASE_DIR).parent / "docs" / "demo-logins.md"
        try:
            logins_content = (
                "# Demo Accounts for Size Exchange\n\n"
                "- Boss: `boss_exchange_demo` / `demo_pass_123`\n"
                "- City Admin (Surat): `cityadmin_surat_demo` / `demo_pass_123`\n"
                "- School Admin (DPS Surat): `schooladmin_dps_demo` / `demo_pass_123`\n"
                "- Other School Admin (DPS Delhi): `schooladmin_delhi_demo` / `demo_pass_123`\n"
                "- Teacher: `teacher_demo` / `demo_pass_123`\n"
                "- Parent A: `parent_a_demo` / `demo_pass_123` (Phone: 9876543210)\n"
                "- Parent B: `parent_b_demo` / `demo_pass_123` (Phone: 9876543211)\n"
            )
            logins_path.write_text(logins_content, encoding="utf-8")
        except Exception:
            pass

        # 3. Students
        student_a, _ = Student.objects.get_or_create(
            gr_number="GR-DEMO-01",
            school=school,
            defaults={"name": "Aarav Shah", "city": city, "parent": parent_a, "student_class": "Class 5"},
        )
        student_b, _ = Student.objects.get_or_create(
            gr_number="GR-DEMO-02",
            school=school,
            defaults={"name": "Rohan Shah", "city": city, "parent": parent_b, "student_class": "Class 5"},
        )

        # 4. Catalog & Variants
        category, _ = Category.objects.get_or_create(slug="uniform", defaults={"name": "Uniform"})
        product_shirt, _ = Product.objects.get_or_create(
            name="DPS Regular Shirt",
            school=school,
            category=category,
            defaults={
                "selling_price": Decimal("500.00"),
                "cost_price": Decimal("300.00"),
                "gender": Product.Gender.UNISEX,
                "active": True,
            },
        )
        if not product_shirt.active:
            product_shirt.active = True
            product_shirt.save()

        # Variants: 28, 30, 32, 34 active, 36 inactive
        v28, _ = ProductVariant.objects.get_or_create(product=product_shirt, size="28", defaults={"sku": "DPS-SHIRT-28", "active": True})
        v30, _ = ProductVariant.objects.get_or_create(product=product_shirt, size="30", defaults={"sku": "DPS-SHIRT-30", "active": True})
        v32, _ = ProductVariant.objects.get_or_create(product=product_shirt, size="32", defaults={"sku": "DPS-SHIRT-32", "active": True})
        v34, _ = ProductVariant.objects.get_or_create(product=product_shirt, size="34", defaults={"sku": "DPS-SHIRT-34", "active": True})
        v36, _ = ProductVariant.objects.get_or_create(product=product_shirt, size="36", defaults={"sku": "DPS-SHIRT-36", "active": False})
        v36.active = False
        v36.save()

        # City stock: size 32 = 2, 34 = 0
        StockBalance.objects.update_or_create(city=city, variant=v28, defaults={"stock_quantity": 5})
        StockBalance.objects.update_or_create(city=city, variant=v30, defaults={"stock_quantity": 10})
        StockBalance.objects.update_or_create(city=city, variant=v32, defaults={"stock_quantity": 2})
        StockBalance.objects.update_or_create(city=city, variant=v34, defaults={"stock_quantity": 0})
        StockBalance.objects.update_or_create(city=city, variant=v36, defaults={"stock_quantity": 0})

        # Product Trouser (for Order Line F with 1 unit left for race testing)
        product_pant, _ = Product.objects.get_or_create(
            name="DPS Uniform Trouser",
            school=school,
            category=category,
            defaults={
                "selling_price": Decimal("600.00"),
                "cost_price": Decimal("400.00"),
                "gender": Product.Gender.UNISEX,
                "active": True,
            },
        )
        vp28, _ = ProductVariant.objects.get_or_create(product=product_pant, size="28", defaults={"sku": "DPS-PANT-28", "active": True})
        vp30, _ = ProductVariant.objects.get_or_create(product=product_pant, size="30", defaults={"sku": "DPS-PANT-30", "active": True})
        # 1 unit left for race test
        StockBalance.objects.update_or_create(city=city, variant=vp30, defaults={"stock_quantity": 1})

        # -------------------------------------------------------------
        # Order A (The Section 4 Acceptance Order):
        # Pickup, DELIVERED 2 days ago, 1 line of shirt size 30 with quantity = 2.
        # Plus Line F: second line on order A whose size (pant 30) has 1 unit left for race testing.
        # -------------------------------------------------------------
        ord_a, _ = Order.objects.update_or_create(
            order_number="ORD-DEMO-A-ACCEPTANCE",
            defaults={
                "placed_by": parent_a,
                "payer": parent_a,
                "parent": parent_a,
                "student": student_a,
                "school": school,
                "city": city,
                "status": Order.Status.DELIVERED,
                "payment_status": Order.PaymentStatus.PAID,
                "payment_method": Order.PaymentMethod.CASH_ON_DELIVERY,
                "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
                "subtotal": Decimal("1600.00"),
                "total": Decimal("1600.00"),
            },
        )
        ord_a.items.all().delete()
        OrderItem.objects.create(
            order=ord_a,
            variant=v30,
            category=category,
            quantity=2,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            chosen_size="30",
        )
        # Line F on Order A
        OrderItem.objects.create(
            order=ord_a,
            variant=vp28,
            category=category,
            quantity=1,
            unit_price_snapshot=Decimal("600.00"),
            unit_cost_snapshot=Decimal("400.00"),
            chosen_size="28",
        )
        ord_a.status_events.all().delete()
        OrderStatusEvent.objects.create(
            order=ord_a,
            status=Order.Status.DELIVERED,
            changed_by=parent_a,
            timestamp=now - dt.timedelta(days=2),
            note="Delivered at school counter 2 days ago.",
        )

        # -------------------------------------------------------------
        # Order B:
        # Pickup order delivered 9 days ago (outside 7-day window).
        # -------------------------------------------------------------
        ord_b, _ = Order.objects.update_or_create(
            order_number="ORD-DEMO-B-EXPIRED",
            defaults={
                "placed_by": parent_a,
                "payer": parent_a,
                "parent": parent_a,
                "student": student_a,
                "school": school,
                "city": city,
                "status": Order.Status.DELIVERED,
                "payment_status": Order.PaymentStatus.PAID,
                "payment_method": Order.PaymentMethod.CASH_ON_DELIVERY,
                "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
                "subtotal": Decimal("500.00"),
                "total": Decimal("500.00"),
            },
        )
        ord_b.items.all().delete()
        OrderItem.objects.create(
            order=ord_b,
            variant=v30,
            category=category,
            quantity=1,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            chosen_size="30",
        )
        ord_b.status_events.all().delete()
        OrderStatusEvent.objects.create(
            order=ord_b,
            status=Order.Status.DELIVERED,
            changed_by=parent_a,
            timestamp=now - dt.timedelta(days=9),
            note="Delivered 9 days ago.",
        )

        # -------------------------------------------------------------
        # Order C:
        # DELIVERED order with no OrderStatusEvent (NO_DELIVERY_RECORD).
        # -------------------------------------------------------------
        ord_c, _ = Order.objects.update_or_create(
            order_number="ORD-DEMO-C-NO-EVENT",
            defaults={
                "placed_by": parent_a,
                "payer": parent_a,
                "parent": parent_a,
                "student": student_a,
                "school": school,
                "city": city,
                "status": Order.Status.DELIVERED,
                "payment_status": Order.PaymentStatus.PAID,
                "payment_method": Order.PaymentMethod.CASH_ON_DELIVERY,
                "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
                "subtotal": Decimal("500.00"),
                "total": Decimal("500.00"),
            },
        )
        ord_c.items.all().delete()
        OrderItem.objects.create(
            order=ord_c,
            variant=v30,
            category=category,
            quantity=1,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            chosen_size="30",
        )
        ord_c.status_events.all().delete()

        # -------------------------------------------------------------
        # Order D:
        # Personalised line (customisation_data populated, ineligible).
        # -------------------------------------------------------------
        ord_d, _ = Order.objects.update_or_create(
            order_number="ORD-DEMO-D-PERSONALISED",
            defaults={
                "placed_by": parent_a,
                "payer": parent_a,
                "parent": parent_a,
                "student": student_a,
                "school": school,
                "city": city,
                "status": Order.Status.DELIVERED,
                "payment_status": Order.PaymentStatus.PAID,
                "payment_method": Order.PaymentMethod.ONLINE,
                "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
                "subtotal": Decimal("500.00"),
                "total": Decimal("500.00"),
            },
        )
        ord_d.items.all().delete()
        OrderItem.objects.create(
            order=ord_d,
            variant=v30,
            category=category,
            quantity=1,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            chosen_size="30",
            customisation_data={"cover_photo": "customisations/2026/demo.jpg"},
        )
        ord_d.status_events.all().delete()
        OrderStatusEvent.objects.create(
            order=ord_d,
            status=Order.Status.DELIVERED,
            changed_by=parent_a,
            timestamp=now - dt.timedelta(days=2),
            note="Delivered 2 days ago.",
        )

        # -------------------------------------------------------------
        # Order E:
        # Home-delivery order delivered 2 days ago, 2 × shirt 30 (HOME_SWAP).
        # -------------------------------------------------------------
        ord_e, _ = Order.objects.update_or_create(
            order_number="ORD-DEMO-E-HOME-SWAP",
            defaults={
                "placed_by": parent_a,
                "payer": parent_a,
                "parent": parent_a,
                "student": student_a,
                "school": school,
                "city": city,
                "status": Order.Status.DELIVERED,
                "payment_status": Order.PaymentStatus.PAID,
                "payment_method": Order.PaymentMethod.ONLINE,
                "fulfillment_type": Order.FulfillmentType.HOME_DELIVERY,
                "subtotal": Decimal("1000.00"),
                "total": Decimal("1000.00"),
            },
        )
        ord_e.items.all().delete()
        OrderItem.objects.create(
            order=ord_e,
            variant=v30,
            category=category,
            quantity=2,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            chosen_size="30",
        )
        ord_e.status_events.all().delete()
        OrderStatusEvent.objects.create(
            order=ord_e,
            status=Order.Status.DELIVERED,
            changed_by=parent_a,
            timestamp=now - dt.timedelta(days=2),
            note="Delivered to home 2 days ago.",
        )

        self.stdout.write(self.style.SUCCESS("Successfully seeded Day 4 demo scenarios A, B, C, D, E, and F."))
