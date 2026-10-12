"""Indian mobile numbers, normalised to the 10-digit form used for matching."""

import re

_NON_DIGITS = re.compile(r"\D")


def normalize_in_mobile(value) -> str:
    """
    Returns the 10-digit mobile number, or "" when the value is not a valid
    Indian mobile. Accepts "+91 98200 11223", "098200 11223", 9820011223.0, etc.
    """
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    digits = _NON_DIGITS.sub("", str(value))
    if len(digits) > 10:
        digits = digits[-10:]
    if len(digits) != 10 or digits[0] not in "6789":
        return ""
    return digits
