import logging
from typing import Any, Optional
from django.utils import timezone
from common.models import AuditLog

logger = logging.getLogger("audit")


def get_client_ip(request) -> Optional[str]:
    if not request:
        return None
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        ip = x_forwarded_for.split(",")[0].strip()
    else:
        ip = request.META.get("REMOTE_ADDR")
    return ip


def log_audit_event(
    action: str,
    target_type: str,
    target_id: Any,
    actor=None,
    details: Optional[dict] = None,
    request=None,
) -> Optional[AuditLog]:
    """
    Safely record an append-only audit log entry.
    """
    try:
        actor_user = None
        actor_name = "system"

        if actor and getattr(actor, "is_authenticated", False):
            actor_user = actor
            actor_name = getattr(actor, "username", str(actor))
        elif request and hasattr(request, "user") and request.user.is_authenticated:
            actor_user = request.user
            actor_name = getattr(request.user, "username", str(request.user))

        ip = get_client_ip(request) if request else None

        entry = AuditLog.objects.create(
            action=action,
            actor=actor_user,
            actor_username=actor_name,
            target_type=target_type,
            target_id=str(target_id),
            details=details or {},
            ip_address=ip,
            created_at=timezone.now(),
        )
        return entry
    except Exception as e:
        logger.error(f"Failed to record audit log: {e}", exc_info=True)
        return None
