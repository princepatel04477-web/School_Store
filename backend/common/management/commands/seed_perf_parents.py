import json
import os
import random
import tempfile
from decimal import Decimal
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance
from inventory.services import apply_stock_movement
from orders.models import Order, OrderItem, OrderStatusEvent
from schools.models import City, School, Student


class Command(BaseCommand):
    help = "Seed synthetic parents with realistic child links and attached orders for performance testing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--count",
            type=int,
            default=50,
            help="Number of synthetic parents to create (default: 50)",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Reset existing synthetic perf parents, children, and attached test orders.",
        )
        parser.add_argument(
            "--tokens-file",
            type=str,
            default="",
            help="Path to write the parent tokens JSON file (default: outside repo in temp directory)",
        )

    def handle(self, *args, **options):
        count = options["count"]
        reset = options["reset"]
        tokens_file = (
            options.get("tokens_file")
            or options.get("tokens-file")
            or os.path.join(tempfile.gettempdir(), "perf_parent_tokens.json")
        )

        # Ensure baseline data exists
        if not School.objects.exists() or not ProductVariant.objects.exists():
            self.stdout.write("Running baseline seed_data...")
            call_command("seed_data")

        if reset:
            self.stdout.write("Resetting synthetic perf parents and children...")
            with transaction.atomic():
                perf_parents = User.objects.filter(username__startswith="perf_parent_")
                # Detach or remove orders associated with synthetic parents
                Order.objects.filter(parent__in=perf_parents, order_number__startswith="ORD-PERF-PARENT-").delete()
                Student.objects.filter(gr_number__startswith="PERF-GR-").delete()
                perf_parents.delete()

        schools = list(School.objects.filter(city__isnull=False).select_related("city"))
        if not schools:
            # Fallback: if all schools lack city, assign default_city to first school
            s = School.objects.first()
            if s and default_city:
                s.city = default_city
                s.save(update_fields=["city"])
                schools = [s]
            else:
                self.stderr.write("No valid schools with city found in database.")
                return

        variants = list(ProductVariant.objects.select_related("product", "product__category").all())
        if not variants:
            self.stderr.write("No product variants found in database.")
            return

        default_city = City.objects.first()
        if not default_city:
            self.stderr.write("No city found in database.")
            return

        self.stdout.write(f"Generating or ensuring {count} synthetic parents...")
        tokens_data = []

        with transaction.atomic():
            for i in range(1, count + 1):
                phone = f"50000{i:05d}"
                username = f"perf_parent_{phone}"

                parent, created = User.objects.get_or_create(
                    username=username,
                    defaults={
                        "phone": phone,
                        "role": User.Role.PARENT,
                        "phone_verified": True,
                    },
                )
                if not parent.phone:
                    parent.phone = phone
                    parent.save(update_fields=["phone"])

                school = schools[i % len(schools)]

                # Ensure 1 or 2 children
                child1, _ = Student.objects.get_or_create(
                    gr_number=f"PERF-GR-{i:05d}-1",
                    defaults={
                        "name": f"Perf Student {i}-A",
                        "class_name": "Class 5",
                        "section": "A",
                        "school": school,
                        "parent": parent,
                        "gender": "MALE",
                        "active": True,
                    },
                )
                children = [child1]

                if i % 2 == 0:
                    child2, _ = Student.objects.get_or_create(
                        gr_number=f"PERF-GR-{i:05d}-2",
                        defaults={
                            "name": f"Perf Student {i}-B",
                            "class_name": "Class 2",
                            "section": "B",
                            "school": school,
                            "parent": parent,
                            "gender": "FEMALE",
                            "active": True,
                        },
                    )
                    children.append(child2)

                # Ensure 1 to 6 attached orders per parent
                num_orders_desired = 1 + (i % 6)
                existing_orders = list(Order.objects.filter(parent=parent))

                if len(existing_orders) < num_orders_desired:
                    # Check if there are available ORD-PERF-* unassigned orders from seed_perf_orders
                    needed = num_orders_desired - len(existing_orders)
                    unassigned_orders = list(
                        Order.objects.filter(order_number__startswith="ORD-PERF-", parent__isnull=True)[:needed]
                    )

                    for o in unassigned_orders:
                        target_child = children[0]
                        o.parent = parent
                        o.placed_by = parent
                        o.payer = parent
                        o.student = target_child
                        if not o.city_id:
                            o.city = target_child.school.city or default_city
                        o.save(update_fields=["parent", "placed_by", "payer", "student", "city"])
                        existing_orders.append(o)
                        needed -= 1

                    # If still need more, generate them with realistic order lines
                    for ord_idx in range(len(existing_orders) + 1, num_orders_desired + 1):
                        target_child = children[(ord_idx - 1) % len(children)]
                        var = variants[(i + ord_idx) % len(variants)]
                        order_num = f"ORD-PERF-PARENT-{i:05d}-{ord_idx}"
                        order_city = target_child.school.city or default_city

                        order = Order.objects.create(
                            order_number=order_num,
                            student=target_child,
                            school=target_child.school,
                            city=order_city,
                            parent=parent,
                            placed_by=parent,
                            payer=parent,
                            placed_by_role="PARENT",
                            subtotal=Decimal("450.00"),
                            total=Decimal("450.00"),
                            status=Order.Status.CONFIRMED if ord_idx % 2 == 0 else Order.Status.DELIVERED,
                            payment_status=Order.PaymentStatus.PAID,
                            payment_method=Order.PaymentMethod.ONLINE,
                            fulfillment_type=Order.FulfillmentType.HOME_DELIVERY,
                        )
                        OrderItem.objects.create(
                            order=order,
                            variant=var,
                            category=var.product.category,
                            quantity=1,
                            unit_price_snapshot=Decimal("450.00"),
                            unit_cost_snapshot=Decimal("200.00"),
                        )
                        OrderStatusEvent.objects.create(
                            order=order,
                            status=order.status,
                            changed_by=parent,
                            note="Perf baseline seed",
                        )
                        existing_orders.append(order)

                # Mint tokens
                tokens = build_tokens_for_user(parent)
                tokens_data.append(
                    {
                        "user_id": str(parent.id),
                        "username": parent.username,
                        "phone": parent.phone,
                        "token": tokens["access"],
                        "child_ids": [str(c.id) for c in children],
                        "order_ids": [str(o.id) for o in existing_orders],
                    }
                )

        # Write tokens file outside repository
        os.makedirs(os.path.dirname(os.path.abspath(tokens_file)), exist_ok=True)
        with open(tokens_file, "w", encoding="utf-8") as f:
            json.dump(tokens_data, f, indent=2)

        self.stdout.write(
            self.style.SUCCESS(
                f"Successfully seeded {len(tokens_data)} synthetic parents. Tokens written to {tokens_file}"
            )
        )
