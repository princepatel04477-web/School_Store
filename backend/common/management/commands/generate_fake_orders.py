from .seed_perf_orders import Command as SeedPerfOrdersCommand


class Command(SeedPerfOrdersCommand):
    help = "Alias for seed_perf_orders (generates 200,000 fake orders for performance testing)."
