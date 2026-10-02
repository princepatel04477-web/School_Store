import json
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import Order, OrderStatusEvent
from .payment import RazorpayGateway


@csrf_exempt
def razorpay_webhook(request):
    if request.method != "POST":
        return JsonResponse({"detail": "POST required"}, status=405)
    raw = request.body
    gateway = RazorpayGateway()
    signature = request.headers.get("X-Razorpay-Signature", "")
    if getattr(settings, "RAZORPAY_KEY_SECRET", "") and not gateway.verify_webhook(raw, signature):
        return JsonResponse({"detail": "Invalid signature"}, status=400)
    try:
        data = json.loads(raw)
        payment = data["payload"]["payment"]["entity"]
        razor_order_id = payment["order_id"]
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"detail": "Invalid payload"}, status=400)
    with transaction.atomic():
        order = Order.objects.select_for_update().filter(razorpay_order_id=razor_order_id).first()
        if not order:
            return JsonResponse({"detail": "Unknown order"}, status=404)
        if order.payment_status != Order.PaymentStatus.PAID:
            order.payment_status = Order.PaymentStatus.PAID
            order.status = Order.Status.CONFIRMED
            order.razorpay_payment_id = payment.get("id", "")
            order.save(update_fields=["payment_status", "status", "razorpay_payment_id", "updated_at"])
            OrderStatusEvent.objects.create(order=order, status=order.status, note="Razorpay webhook confirmed payment.")
    return JsonResponse({"ok": True})
