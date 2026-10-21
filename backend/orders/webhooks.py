import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import Order
from .payment import RazorpayGateway
from .status import record_payment


@csrf_exempt
def razorpay_webhook(request):
    if request.method != "POST":
        return JsonResponse({"detail": "POST required"}, status=405)
    raw = request.body
    gateway = RazorpayGateway()
    signature = request.headers.get("X-Razorpay-Signature", "")
    if not gateway.verify_webhook(raw, signature):
        return JsonResponse({"detail": "Invalid signature"}, status=400)
    try:
        data = json.loads(raw)
        payment = data["payload"]["payment"]["entity"]
        razor_order_id = payment["order_id"]
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"detail": "Invalid payload"}, status=400)
    if not razor_order_id:
        return JsonResponse({"detail": "Invalid payload"}, status=400)
    # Indexed lookup (idx_order_razorpay_id). Gateways resend: record_payment is idempotent.
    orders = Order.objects.filter(razorpay_order_id=razor_order_id)
    if not orders.exists():
        return JsonResponse({"detail": "Unknown order"}, status=404)
    record_payment(
        orders,
        payment_id=payment.get("id", ""),
        note="Razorpay webhook confirmed payment.",
    )
    return JsonResponse({"ok": True})
