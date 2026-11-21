import logging
import os
from django.conf import settings
from .models import DeviceToken, Order

logger = logging.getLogger(__name__)

_firebase_app = None


def get_firebase_app():
    """Initialize and cache the Firebase Admin App instance."""
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app

    cred_path = getattr(settings, "FCM_CREDENTIALS_FILE", "")
    if not cred_path or not os.path.exists(cred_path):
        return None

    try:
        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            cred = credentials.Certificate(cred_path)
            _firebase_app = firebase_admin.initialize_app(cred)
        else:
            _firebase_app = firebase_admin.get_app()
        return _firebase_app
    except Exception as exc:
        logger.warning("Failed to initialize Firebase Admin app: %s", exc)
        return None


def format_notification(order: Order, status_or_event: str) -> tuple[str, str]:
    """
    Format friendly notification title and one-line message in parent terms.
    Strictly NO child height/weight/photos in any notification!
    """
    school_name = getattr(order.school, "name", "your school")
    st = str(status_or_event).upper()

    if st in (Order.Status.CONFIRMED, "CONFIRMED"):
        title = "Order Confirmed"
        body = f"Order {order.order_number} has been confirmed."
    elif st in (Order.Status.DISPATCHED, Order.Status.SHIPPED, "DISPATCHED", "SHIPPED"):
        if order.fulfillment_type == Order.FulfillmentType.SCHOOL_PICKUP:
            title = "Ready for Pickup"
            body = f"Order {order.order_number} is ready for pickup at {school_name}."
        else:
            title = "Order Dispatched"
            shipment = getattr(order, "shipment", None)
            if shipment is None:
                try:
                    shipment = order.shipment
                except Exception:
                    shipment = None
            if shipment and shipment.consignment_number:
                body = f"Order {order.order_number} was sent by India Post. Tracking number {shipment.consignment_number}."
            else:
                body = f"Order {order.order_number} has been dispatched for delivery."
    elif st in (Order.Status.PACKED, "PACKED"):
        title = "Order Packed"
        body = f"Order {order.order_number} is packed and being readied."
    elif st in (Order.Status.DELIVERED, "DELIVERED"):
        title = "Order Delivered"
        body = f"Order {order.order_number} has been delivered. Thank you!"
    elif st in (Order.Status.CANCELLED, "CANCELLED"):
        title = "Order Cancelled"
        body = f"Order {order.order_number} has been cancelled."
    elif st in (Order.PaymentStatus.FAILED, "FAILED", "PAYMENT_FAILED"):
        title = "Payment Failed"
        body = f"Payment for order {order.order_number} was not successful. Please try again."
    else:
        title = f"Order {order.order_number}"
        body = f"Order status is now {status_or_event.title()}."

    return title, body


def send_order_push(order_id: str, status_or_event: str) -> dict:
    """
    Send push notification to all active devices of the order's parent/payer.
    Runs asynchronously inside Celery.
    """
    try:
        order = (
            Order.objects.select_related("parent", "payer", "placed_by", "school")
            .get(pk=order_id)
        )
    except Order.DoesNotExist:
        logger.warning("Cannot send push: Order %s not found.", order_id)
        return {"status": "order_not_found"}

    recipient = order.parent or order.placed_by or order.payer
    if not recipient:
        return {"status": "no_recipient"}

    # Respect user opt-out switch
    if not getattr(recipient, "notify_order_updates", True):
        logger.info("Push notification skipped: User %s opted out of order updates.", recipient.id)
        return {"status": "opted_out", "user_id": str(recipient.id)}

    tokens = list(
        DeviceToken.objects.filter(user=recipient).values_list("token", flat=True)
    )
    if not tokens:
        return {"status": "no_tokens", "user_id": str(recipient.id)}

    title, body = format_notification(order, status_or_event)
    data = {
        "order_id": str(order.id),
        "order_number": str(order.order_number),
        "url": f"/orders/{order.id}",
        "click_action": "FLUTTER_NOTIFICATION_CLICK",
    }

    app = get_firebase_app()
    if app is None:
        logger.info(
            "FCM credentials not configured. Simulating send for order %s to %d devices: %s - %s",
            order.order_number,
            len(tokens),
            title,
            body,
        )
        return {
            "status": "simulated",
            "title": title,
            "body": body,
            "device_count": len(tokens),
            "tokens": tokens,
        }

    try:
        from firebase_admin import messaging

        message = messaging.MulticastMessage(
            notification=messaging.Notification(title=title, body=body),
            data=data,
            tokens=tokens,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    icon="ic_stat_notify",
                    color="#2F5D50",
                    click_action="OPEN_ORDER_DETAIL",
                ),
            ),
        )
        response = messaging.send_each_for_multicast(message, app=app)

        invalid_tokens = []
        for idx, resp in enumerate(response.responses):
            if not resp.success and resp.exception:
                err = str(resp.exception)
                # Check for invalid / unregistered token errors
                is_invalid = (
                    isinstance(
                        resp.exception,
                        (
                            getattr(messaging, "UnregisteredError", Exception),
                            getattr(messaging, "SenderIdMismatchError", Exception),
                        ),
                    )
                    or any(
                        term in err.lower()
                        for term in ("not-registered", "not registered", "unregistered", "invalid", "not found")
                    )
                )
                if is_invalid:
                    invalid_tokens.append(tokens[idx])

        if invalid_tokens:
            DeviceToken.objects.filter(token__in=invalid_tokens).delete()
            logger.info("Cleaned up %d invalid FCM tokens.", len(invalid_tokens))

        return {
            "status": "sent",
            "success_count": response.success_count,
            "failure_count": response.failure_count,
            "dropped_tokens": len(invalid_tokens),
        }
    except Exception as exc:
        logger.error("Error sending FCM notification for order %s: %s", order.id, exc)
        return {"status": "error", "error": str(exc)}


def send_fit_feedback_push(order: Order, size: str) -> dict:
    """
    Send a push notification 5 days after delivery asking:
    'How did size {size} fit?' (Prompt 9).
    Respects user opt-out and contains NO child body measurements.
    """
    recipient = order.parent or order.placed_by or order.payer
    if not recipient:
        return {"status": "no_recipient"}

    if not getattr(recipient, "notify_order_updates", True):
        logger.info("Push notification skipped: User %s opted out of order updates.", recipient.id)
        return {"status": "opted_out", "user_id": str(recipient.id)}

    tokens = list(
        DeviceToken.objects.filter(user=recipient).values_list("token", flat=True)
    )
    if not tokens:
        return {"status": "no_tokens", "user_id": str(recipient.id)}

    title = "How did the size fit?"
    body = f"How did size {size} fit for order {order.order_number}? Let us know with one tap."
    data = {
        "order_id": str(order.id),
        "order_number": str(order.order_number),
        "type": "fit_feedback",
        "url": f"/orders/{order.id}",
        "click_action": "FLUTTER_NOTIFICATION_CLICK",
    }

    app = get_firebase_app()
    if app is None:
        logger.info(
            "FCM credentials not configured. Simulating fit feedback push for order %s to %d devices: %s",
            order.order_number,
            len(tokens),
            body,
        )
        return {
            "status": "simulated",
            "title": title,
            "body": body,
            "device_count": len(tokens),
            "tokens": tokens,
        }

    try:
        from firebase_admin import messaging

        message = messaging.MulticastMessage(
            notification=messaging.Notification(title=title, body=body),
            data=data,
            tokens=tokens,
            android=messaging.AndroidConfig(
                priority="normal",
                notification=messaging.AndroidNotification(
                    icon="ic_stat_notify",
                    color="#2F5D50",
                    click_action="OPEN_ORDER_DETAIL",
                ),
            ),
        )
        response = messaging.send_each_for_multicast(message, app=app)
        return {
            "status": "sent",
            "success_count": response.success_count,
            "failure_count": response.failure_count,
        }
    except Exception as exc:
        logger.exception("Failed to send fit feedback push for order %s: %s", order.id, exc)
        return {"status": "error", "error": str(exc)}

