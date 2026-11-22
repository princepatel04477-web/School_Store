"""Local Django server with RazorpayGateway network calls replaced by a scripted fake.

Provider answers come from state.json next to this file, so a test can say what
"Razorpay" reports for each Razorpay order id. Nothing leaves this PC.
"""
import json
import os
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = Path(os.environ["SIM_BACKEND"])
STATE = HERE / "state.json"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from orders import payment as gateway_module  # noqa: E402


def load():
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def save(data):
    STATE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def create_order(self, order):
    data = load()
    rid = f"order_sim{uuid.uuid4().hex[:10]}"
    data.setdefault("created", []).append({"id": rid, "store_order": order.order_number})
    save(data)
    return {"id": rid, "amount": int(order.total * 100), "currency": "INR"}


def fetch_order_payments(self, razorpay_order_id):
    data = load()
    data.setdefault("calls", []).append(razorpay_order_id)
    save(data)
    if data.get("outage"):
        raise RuntimeError("simulated outage")
    return data.get("payments", {}).get(razorpay_order_id, [])


def fetch_payment(self, payment_id):
    data = load()
    if data.get("outage"):
        raise RuntimeError("simulated outage")
    for payments in data.get("payments", {}).values():
        for payment in payments:
            if payment["id"] == payment_id:
                return payment
    raise RuntimeError("unknown payment")


cls = gateway_module.RazorpayGateway
cls.create_order = create_order
cls.fetch_order_payments = fetch_order_payments
cls.fetch_payment = fetch_payment

from django.core.management import call_command  # noqa: E402

call_command("runserver", "127.0.0.1:8000", "--noreload")
