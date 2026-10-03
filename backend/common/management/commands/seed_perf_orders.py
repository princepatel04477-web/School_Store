import time
import uuid
from datetime import timedelta
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connection
from django.utils import timezone

from accounts.models import User
from analytics.tasks import refresh_daily_sales_summary
from catalog.models import ProductVariant
from orders.models import Order
from schools.models import Student


class Command(BaseCommand):
    help = "Generate 200,000 fake orders (with UUIDv4 PKs generated in Python) for high-throughput performance testing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--count",
            type=int,
            default=200000,
            help="Number of fake orders to generate (default: 200000)",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing ORD-PERF-* orders before generating.",
        )

    def handle(self, *args, **options):
        target_count = options["count"]
        reset = options["reset"]

        # Ensure baseline seed data exists
        if not Student.objects.exists() or not ProductVariant.objects.exists():
            self.stdout.write("Running baseline seed_data first...")
            call_command("seed_data")

        if reset:
            self.stdout.write("Removing existing ORD-PERF-* orders...")
            with connection.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM orders_orderitem WHERE order_id IN (SELECT id FROM orders_order WHERE order_number LIKE 'ORD-PERF-%');"
                )
                cursor.execute(
                    "DELETE FROM orders_order WHERE order_number LIKE 'ORD-PERF-%';"
                )

        existing_perf = Order.objects.filter(order_number__startswith="ORD-PERF-").count()
        to_create = max(0, target_count - existing_perf)
        if to_create == 0:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Already have {existing_perf} performance test orders (target={target_count})."
                )
            )
            return

        students = list(
            Student.objects.select_related("school", "school__city", "parent").all()
        )
        variants = list(
            ProductVariant.objects.select_related("product", "product__category").all()
        )
        fallback_user = (
            User.objects.filter(role=User.Role.PARENT).first()
            or User.objects.first()
        )
        teacher_user = (
            User.objects.filter(role=User.Role.TEACHER).first() or fallback_user
        )

        statuses = [
            (Order.Status.DELIVERED, Order.PaymentStatus.PAID),
            (Order.Status.CONFIRMED, Order.PaymentStatus.PAID),
            (Order.Status.SHIPPED, Order.PaymentStatus.PAID),
            (Order.Status.PACKED, Order.PaymentStatus.PAID),
            (Order.Status.PENDING, Order.PaymentStatus.PENDING),
            (Order.Status.CANCELLED, Order.PaymentStatus.REFUNDED),
        ]

        now = timezone.now()
        start_seq = existing_perf + 1
        end_seq = existing_perf + to_create

        self.stdout.write(
            f"Generating {to_create:,} fake orders (#{start_seq}..#{end_seq}) with application-generated UUIDv4 keys..."
        )
        t0 = time.perf_counter()

        student_tuples = [
            (
                str(s.id),
                str(s.school_id),
                str(s.school.city_id),
                str(s.parent_id or fallback_user.id),
            )
            for s in students
        ]
        variant_tuples = [
            (
                str(v.id),
                str(v.product.category_id),
                str(v.product.selling_price),
                str(v.product.cost_price),
                float(v.product.selling_price),
            )
            for v in variants
        ]
        teacher_id_str = str(teacher_user.id)

        num_students = len(student_tuples)
        num_variants = len(variant_tuples)
        num_statuses = len(statuses)
        empty_json = "{}"

        order_copy_sql = """
            COPY orders_order (
                id, order_number, idempotency_key, placed_by_id, placed_by_role, payer_id,
                student_id, parent_id, school_id, city_id, status,
                subtotal, total, payment_status, fulfillment_type,
                razorpay_order_id, razorpay_payment_id, razorpay_signature,
                delivery_details, created_at, updated_at
            ) FROM STDIN
        """
        item_copy_sql = """
            COPY orders_orderitem (
                id, order_id, variant_id, category_id,
                quantity, unit_price_snapshot, unit_cost_snapshot, customisation_data
            ) FROM STDIN
        """

        batch_size = 25000
        uuid4 = uuid.uuid4

        with connection.cursor() as cursor:
            raw_cur = cursor.cursor
            for batch_start in range(start_seq, end_seq + 1, batch_size):
                batch_end = min(batch_start + batch_size - 1, end_seq)
                order_rows = []
                item_rows = []

                for seq in range(batch_start, batch_end + 1):
                    order_id = str(uuid4())
                    item_id = str(uuid4())

                    st_id, sch_id, cit_id, par_id = student_tuples[seq % num_students]
                    var_id, cat_id, price_str, cost_str, price_float = variant_tuples[
                        seq % num_variants
                    ]
                    ord_status, pay_status = statuses[seq % num_statuses]

                    if seq % 5 == 0:
                        placed_by_id = teacher_id_str
                        placed_by_role = "TEACHER"
                    else:
                        placed_by_id = par_id
                        placed_by_role = "PARENT"

                    qty = (seq % 3) + 1
                    total_str = f"{price_float * qty:.2f}"
                    # Spread orders across the last 90 days for realistic time-series queries
                    ts = (now - timedelta(days=seq % 90, seconds=seq % 86400)).isoformat()
                    ord_num = f"ORD-PERF-{seq:07d}"
                    idempotency_key = f"perf-{uuid4().hex}"
                    fulfillment_type = (
                        Order.FulfillmentType.SCHOOL_PICKUP
                        if seq % 2
                        else Order.FulfillmentType.HOME_DELIVERY
                    )
                    delivery_details = (
                        '{"pickup":"school"}'
                        if fulfillment_type == Order.FulfillmentType.SCHOOL_PICKUP
                        else '{"address":"Performance test address"}'
                    )

                    order_rows.append(
                        (
                            order_id,
                            ord_num,
                            idempotency_key,
                            placed_by_id,
                            placed_by_role,
                            placed_by_id,
                            st_id,
                            par_id,
                            sch_id,
                            cit_id,
                            ord_status,
                            total_str,
                            total_str,
                            pay_status,
                            fulfillment_type,
                            f"order_rzp_{seq:07d}",
                            f"pay_rzp_{seq:07d}" if pay_status == "PAID" else "",
                            "",
                            delivery_details,
                            ts,
                            ts,
                        )
                    )
                    item_rows.append(
                        (
                            item_id,
                            order_id,
                            var_id,
                            cat_id,
                            qty,
                            price_str,
                            cost_str,
                            empty_json,
                        )
                    )

                with raw_cur.copy(order_copy_sql) as copy:
                    for row in order_rows:
                        copy.write_row(row)

                with raw_cur.copy(item_copy_sql) as copy:
                    for row in item_rows:
                        copy.write_row(row)

                self.stdout.write(f"  Inserted up to #{batch_end:,}...")

            self.stdout.write("Refreshing DailySalesSummary rollups & running ANALYZE...")
            refresh_daily_sales_summary()
            cursor.execute("ANALYZE orders_order;")
            cursor.execute("ANALYZE orders_orderitem;")
            cursor.execute("ANALYZE analytics_dailysalessummary;")

        elapsed = time.perf_counter() - t0
        total_orders = Order.objects.count()
        self.stdout.write(
            self.style.SUCCESS(
                f"Done in {elapsed:.2f}s! Total orders in database: {total_orders:,}"
            )
        )
