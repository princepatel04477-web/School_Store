import json
from datetime import timedelta
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import Order, PaymentAttempt, PaymentEvent
from .payment import RazorpayGateway
from .status import apply_provider_payment


@csrf_exempt
def razorpay_webhook(request):
    if request.method != "POST":
        return JsonResponse({"detail": "POST required"}, status=405)

    raw_body = request.body
    gateway = RazorpayGateway()
    signature = request.headers.get("X-Razorpay-Signature", "")

    # 1. Verify signature with RAZORPAY_WEBHOOK_SECRET
    if not gateway.verify_webhook(raw_body, signature):
        return JsonResponse({"detail": "Invalid signature"}, status=400)

    try:
        data = json.loads(raw_body)
    except (ValueError, TypeError):
        return JsonResponse({"detail": "Invalid JSON payload"}, status=400)

    event_id = request.headers.get("X-Razorpay-Event-Id") or data.get("event_id") or data.get("id") or ""
    if not event_id:
        return JsonResponse({"detail": "Missing event id"}, status=400)

    event_type = data.get("event", "")
    payload_dict = data.get("payload", {})
    payment_wrapper = payload_dict.get("payment", {})
    payment_entity = payment_wrapper.get("entity", {}) if isinstance(payment_wrapper, dict) else {}
    order_wrapper = payload_dict.get("order", {})
    order_entity = order_wrapper.get("entity", {}) if isinstance(order_wrapper, dict) else {}

    p_id = payment_entity.get("id", "")
    o_id = payment_entity.get("order_id", "") or order_entity.get("id", "")
    amount = payment_entity.get("amount") or order_entity.get("amount")
    currency = payment_entity.get("currency") or order_entity.get("currency", "INR")

    # 2. Record durably first in its own transaction
    try:
        with transaction.atomic():
            event = PaymentEvent.objects.select_for_update().filter(event_id=event_id).first()
            if not event:
                event = PaymentEvent.objects.create(
                    event_id=event_id,
                    event_type=event_type,
                    razorpay_order_id=o_id,
                    razorpay_payment_id=p_id,
                    amount=amount,
                    currency=currency,
                    payload=data,
                    state=PaymentEvent.State.RECEIVED,
                )
            else:
                # 3. Duplicates
                if event.state in (
                    PaymentEvent.State.PROCESSED,
                    PaymentEvent.State.IGNORED,
                    PaymentEvent.State.RETRY,
                    PaymentEvent.State.UNMATCHED,
                ):
                    return JsonResponse({"ok": True}, status=200)
    except Exception:
        # If this row cannot be saved, return 503 so that Razorpay retries.
        return JsonResponse({"detail": "Unable to persist event"}, status=503)

    # 4. Process in a separate transaction
    try:
        with transaction.atomic():
            event = PaymentEvent.objects.select_for_update().get(pk=event.pk)

            # Match store order by razorpay_order_id or notes.store_order_id
            store_order = None
            if o_id:
                store_order = Order.objects.filter(razorpay_order_id=o_id).first()
            if not store_order:
                notes = payment_entity.get("notes", {}) or order_entity.get("notes", {})
                if isinstance(notes, dict) and notes.get("store_order_id"):
                    store_order = Order.objects.filter(id=notes["store_order_id"]).first()

            if not store_order:
                event.state = PaymentEvent.State.UNMATCHED
                event.next_try_at = timezone.now() + timedelta(minutes=1)
                event.save(update_fields=["state", "next_try_at"])
                return JsonResponse({"ok": True}, status=200)

            if event_type in ("payment.captured", "order.paid", "payment.authorized", "payment.failed"):
                # If order.paid arrived without full payment entity, ensure order_id and captured status
                p_entity = dict(payment_entity)
                if not p_entity:
                    p_entity = {
                        "id": p_id or f"pay_for_{o_id}",
                        "order_id": o_id,
                        "amount": amount,
                        "currency": currency,
                        "status": "captured",
                    }
                elif event_type in ("payment.captured", "order.paid"):
                    p_entity.setdefault("status", "captured")
                elif event_type == "payment.authorized":
                    p_entity.setdefault("status", "authorized")
                elif event_type == "payment.failed":
                    p_entity.setdefault("status", "failed")

                apply_provider_payment(store_order, p_entity, PaymentAttempt.Source.WEBHOOK)
                event.state = PaymentEvent.State.PROCESSED
                event.save(update_fields=["state"])
            else:
                event.state = PaymentEvent.State.IGNORED
                event.save(update_fields=["state"])

    except Exception as exc:
        try:
            with transaction.atomic():
                event = PaymentEvent.objects.select_for_update().get(pk=event.pk)
                event.state = PaymentEvent.State.RETRY
                event.tries += 1
                event.last_error = str(exc)
                event.next_try_at = timezone.now() + timedelta(minutes=1)
                event.save(update_fields=["state", "tries", "last_error", "next_try_at"])
        except Exception:
            return JsonResponse({"detail": "Processing failed and error state could not be recorded"}, status=503)

    # 5. Return 200
    return JsonResponse({"ok": True}, status=200)
