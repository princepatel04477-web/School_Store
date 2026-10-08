import json
from pathlib import Path
from django.conf import settings

# Load the single source of truth for classes
_shared_path = Path(settings.BASE_DIR).parent / "shared" / "classes.json"
if not _shared_path.exists():
    _shared_path = Path(settings.BASE_DIR) / "shared" / "classes.json"

with open(_shared_path, "r", encoding="utf-8") as _f:
    CLASSES = json.load(_f)

CLASS_NAMES = [c["name"] for c in CLASSES]
CLASS_NAME_SET = set(CLASS_NAMES)
CLASS_SORT_ORDERS = {c["name"]: c["sort_order"] for c in CLASSES}

# Alias map for tolerant matching (e.g., student imports or legacy numbers "1" -> "Class 1")
CLASS_ALIASES = {}
for c in CLASSES:
    name = c["name"]
    CLASS_ALIASES[name.lower()] = name
    # If "Class 5", also support "5", "std 5", "grade 5"
    if name.lower().startswith("class "):
        num = name[6:].strip()
        CLASS_ALIASES[num] = name
        CLASS_ALIASES[f"grade {num}"] = name
        CLASS_ALIASES[f"std {num}"] = name
        CLASS_ALIASES[f"standard {num}"] = name

# Pre-primary aliases
CLASS_ALIASES["jr kg"] = "Junior KG"
CLASS_ALIASES["jr. kg"] = "Junior KG"
CLASS_ALIASES["sr kg"] = "Senior KG"
CLASS_ALIASES["sr. kg"] = "Senior KG"
CLASS_ALIASES["lkg"] = "Junior KG"
CLASS_ALIASES["ukg"] = "Senior KG"
CLASS_ALIASES["kindergarten"] = "Junior KG"
CLASS_ALIASES["kg"] = "Junior KG"
CLASS_ALIASES["nursery"] = "Nursery"


def normalize_class_name(value: str | None) -> str | None:
    """Normalize raw class strings to canonical Class Name, e.g. '5' -> 'Class 5'."""
    if not value:
        return None
    clean = str(value).strip().lower()
    return CLASS_ALIASES.get(clean)


def is_valid_class_name(value: str | None) -> bool:
    """Check if value is a canonical class name or normalizable to one."""
    if not value:
        return False
    return normalize_class_name(value) is not None
