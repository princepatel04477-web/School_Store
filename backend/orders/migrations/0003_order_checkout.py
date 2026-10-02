from django.db import migrations, models
import uuid


def fill_keys(apps, schema_editor):
    Order = apps.get_model("orders", "Order")
    for order in Order.objects.filter(idempotency_key=""):
        order.idempotency_key = "legacy-" + uuid.uuid4().hex
        order.save(update_fields=["idempotency_key"])


def reverse_keys(apps, schema_editor):
    apps.get_model("orders", "Order").objects.update(idempotency_key="")


class Migration(migrations.Migration):
    dependencies = [("orders", "0002_order_parent_order_idx_order_parent_created")]

    operations = [
        migrations.AddField(
            model_name="order", name="idempotency_key",
            field=models.CharField(default="", max_length=128),
        ),
        migrations.RunPython(fill_keys, reverse_keys),
        migrations.AlterField(
            model_name="order", name="idempotency_key",
            field=models.CharField(db_index=True, default=uuid.uuid4, max_length=128, unique=True),
        ),
        migrations.AlterField(
            model_name="order", name="status",
            field=models.CharField(choices=[
                ("PLACED", "Placed"), ("PENDING", "Pending"), ("CONFIRMED", "Confirmed"),
                ("PROCESSING", "Processing"), ("PACKED", "Packed"), ("DISPATCHED", "Dispatched"),
                ("SHIPPED", "Shipped"), ("DELIVERED", "Delivered"), ("CANCELLED", "Cancelled"),
                ("RETURNED", "Returned"), ("REFUNDED", "Refunded")], default="PLACED", max_length=24),
        ),
        migrations.AlterField(
            model_name="orderstatusevent", name="status",
            field=models.CharField(choices=[
                ("PLACED", "Placed"), ("PENDING", "Pending"), ("CONFIRMED", "Confirmed"),
                ("PROCESSING", "Processing"), ("PACKED", "Packed"), ("DISPATCHED", "Dispatched"),
                ("SHIPPED", "Shipped"), ("DELIVERED", "Delivered"), ("CANCELLED", "Cancelled"),
                ("RETURNED", "Returned"), ("REFUNDED", "Refunded")], max_length=24),
        ),
    ]
