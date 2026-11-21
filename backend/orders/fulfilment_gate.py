"""
Gate adapter for the Day 2 packing decision (day3-00-trace-and-contract.md section 4).

Day 3 calls this adapter only. If Day 2's callable is not merged, packing is
closed by default: the adapter returns PackingDecision(False, "PACKING_RULE_NOT_WIRED", ...).
"""

from dataclasses import dataclass

from django.conf import settings
from django.core.checks import Error, register


@dataclass(frozen=True)
class PackingDecision:
    allowed: bool
    reason: str | None  # machine code when blocked, None when allowed
    message: str  # one plain sentence for staff, no em dashes


def get_packing_decision(order) -> PackingDecision:
    """Return the packing decision for a locked order row.

    Caller holds select_for_update() on `order` inside transaction.atomic().
    """
    # Fixture path: development only.
    fixture = getattr(settings, "FULFILMENT_PACKING_FIXTURE", "")
    if settings.DEBUG and fixture:
        if fixture == "allow":
            return PackingDecision(True, None, "Fixture: packing allowed.")
        return PackingDecision(False, fixture, f"Fixture: blocked ({fixture}).")

    # Try to import Day 2's packing decision callable.
    try:
        from orders.payment_rules import packing_decision
    except ImportError:
        return PackingDecision(
            False,
            "PACKING_RULE_NOT_WIRED",
            "Packing is not available yet. Payment checks are not connected.",
        )

    return packing_decision(order)


@register()
def check_fulfilment_fixture_setting(app_configs, **kwargs):
    errors = []
    fixture = getattr(settings, "FULFILMENT_PACKING_FIXTURE", "")
    if fixture and not settings.DEBUG:
        errors.append(
            Error(
                "FULFILMENT_PACKING_FIXTURE is set while DEBUG is False.",
                hint="Remove FULFILMENT_PACKING_FIXTURE from settings in production.",
                id="orders.E001",
            )
        )
    return errors
