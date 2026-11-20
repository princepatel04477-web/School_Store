import os
import tempfile
from django.core.management import call_command
from django.test import TestCase

from accounts.models import User
from orders.models import Order
from schools.models import Student


class SeedPerfParentsCommandTests(TestCase):
    def test_seed_perf_parents_is_idempotent_and_creates_no_duplicates(self):
        tmp_tokens = os.path.join(tempfile.gettempdir(), "test_perf_tokens.json")

        # 1. First run
        call_command("seed_perf_parents", count=10, tokens_file=tmp_tokens, reset=True)
        parents_run1 = User.objects.filter(username__startswith="perf_parent_").count()
        children_run1 = Student.objects.filter(gr_number__startswith="PERF-GR-").count()
        orders_run1 = Order.objects.filter(parent__username__startswith="perf_parent_").count()

        self.assertEqual(parents_run1, 10)
        self.assertGreaterEqual(children_run1, 10)
        self.assertGreaterEqual(orders_run1, 10)
        self.assertTrue(os.path.exists(tmp_tokens))

        # 2. Second run without reset: must not create duplicates
        call_command("seed_perf_parents", count=10, tokens_file=tmp_tokens)
        parents_run2 = User.objects.filter(username__startswith="perf_parent_").count()
        children_run2 = Student.objects.filter(gr_number__startswith="PERF-GR-").count()
        orders_run2 = Order.objects.filter(parent__username__startswith="perf_parent_").count()

        self.assertEqual(parents_run2, parents_run1)
        self.assertEqual(children_run2, children_run1)
        self.assertEqual(orders_run2, orders_run1)

        # 3. Clean up
        if os.path.exists(tmp_tokens):
            os.remove(tmp_tokens)
