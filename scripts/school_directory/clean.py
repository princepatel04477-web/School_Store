"""
Turn the raw scrape (work/raw/*.json) into one clean list of school branches.

    python scripts/school_directory/clean.py

Writes:
  backend/schools/data/north_india_schools.json  (read by `manage.py import_school_directory`)
  work/north_india_schools.xlsx                  (for checking by hand)
  work/rejected.csv                              (what was dropped and why)

Each place is matched to one chain by its name, non-schools are dropped
(gates, staff quarters, KVS offices, coaching centres, bus stops, colleges,
uniform shops), places outside North India are dropped, duplicates within
200 m of each other in the same chain are merged, and each branch is given the
state from its address and the nearest district headquarters in that state as
its city.
"""

import csv
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from districts import STATES  # noqa: E402

WORK = HERE / "work"
OUT = HERE.parents[1] / "backend" / "schools" / "data" / "north_india_schools.json"

# code, school name in the shop, board, fit (from the targets sheet), name pattern
CHAINS = [
    ("KV", "Kendriya Vidyalaya", "CBSE", "Best",
     r"\bk[ae]nd[a-z]*\s*vid[hy]*[a-z]*laya|\bk\.?\s?v\.?\s(?!.*college)|^kv\b|^pm shri kv\b"),
    # AWES runs Army Public Schools and Army pre-primary schools.
    ("APS", "Army Public School", "CBSE", "Good", r"\barmy (public|pre[- ]?primary|pre[- ]?school)"),
    ("SVM", "Saraswati Vidya Mandir", "OTHER", "Good",
     r"\bsaraswat[iy]?\s+((bal|balika|shishu|sishu|shisu|vidya|vidhya|vidyaa|vidha|shiksha|gyan)\s+){1,3}"
     r"(mandir|mandeer|niketan)|\bvidya saraswati mandir"),
    ("AFS", "Air Force School", "CBSE", "Good", r"\bair\s*force\b(?!.*\b(museum|station|heritage|camp)\b).*\bschool\b"),
    ("KIDZEE", "Kidzee", "OTHER", "Good", r"\bkidzee\b"),
    ("DAV", "DAV Public School", "CBSE", "Medium", r"\bd\.?\s?a\.?\s?v\.?\b"),
    ("DPS", "Delhi Public School", "CBSE", "Medium", r"^(the |pm shri )?delhi public school\b|^dps\b"),
    ("MLZS", "Mount Litera Zee School", "CBSE", "Medium", r"\bmount\s*litera\b|\bmlzs\b"),
    ("JAIPURIA", "Seth Anandram Jaipuria School", "CBSE", "Medium", r"\bjaipuria\b"),
    ("GDG", "GD Goenka Public School", "CBSE", "Low", r"\bg\.?\s?d\.?\s?goenka\b"),
    ("RYAN", "Ryan International School", "CBSE", "Poor", r"\bryan international\b"),
    ("SAINIK", "Sainik School", "CBSE", "Poor", r"^(pm shri\s+)?(up\s+|rajasthan\s+|jairam\s+|bhartiya\s+)?sainik school\b"),
    ("JNV", "Jawahar Navodaya Vidyalaya", "CBSE", "Poor", r"\bnavod[a-z]*\s*vid[a-z]*laya\b|^jnv\b"),
]
# Chains named by a full phrase are matched first; KV and DAV patterns also
# accept the bare abbreviation, which shows up inside other names ("Kidzee, KV Road").
MATCH_LAST = ("SVM", "DPS", "KV", "DAV")
CHAIN_RE = sorted(
    ((c, re.compile(p, re.I)) for c, *_, p in CHAINS),
    key=lambda x: MATCH_LAST.index(x[0]) + 1 if x[0] in MATCH_LAST else 0,
)
CHAIN_INFO = {c: {"name": n, "board": b, "fit": f} for c, n, b, f, _ in CHAINS}

BAD_NAME = re.compile(
    r"\b(staff|quarters?|qtrs?|office|sangathan|samiti|coaching|classes|"
    r"tuition|tutorial|hostel|canteen|store|shop|depot|trust|stationer[sy]?|uniforms?|books?|"
    r"(?<!inter )(?<!intermediate )(?<!inter\. )(?<!girls inter )college|"
    r"degree|universit[yi]|institute of|hospital|bus stop|parking|"
    r"alumni|admission|apartments?|housing society|smriti bhawan|education cent(er|re)|dayanand saraswati|guest house|play ?ground|stadium|bal sainik|international public school|"
    r"vidyapeeth|mahavidyalaya|polytechnic|b\.?ed)\b|"
    r"\b(main|back|entry|exit|school)\s+gate\b|\bgate\s+(no\.?|number|\d)\b|^gate\b|\bkv\s+gate\b|"
    r"\bschool\s+(road|marg|lane|path)\b|"
    r"\b(coaching|sports|cricket|defence|healthcare|preparatory|training)\s+academy\b|"
    r"\b(near|opp\.?|opposite|behind)\s+.*?\b(k\.?v\.?|kendriya|dav|dps|jnv|army|air force|saraswati|kidzee|jaipuria|goenka|ryan|sainik)\b",
    re.I,
)
BAD_CATEGORY = re.compile(
    r"bus stop|temple|church|mosque|gurudwara|coaching|tutoring|condominium|apartment|housing|"
    r"playground|college|university|store|shop|restaurant|park|hostel|hospital|atm|bank|parking|"
    r"stadium|sports|club|residential|real estate|hotel|guest house|transit|post office|"
    r"government office|corporate office|building|landmark",
    re.I,
)
SCHOOL_CATEGORY = re.compile(r"school|vidyalaya|educat|preschool|kindergarten|playgroup|nursery|day care", re.I)

STATE_ALIASES = {
    "delhi": "Delhi", "new delhi": "Delhi", "chandigarh": "Chandigarh", "haryana": "Haryana",
    "punjab": "Punjab", "himachal pradesh": "Himachal Pradesh", "uttarakhand": "Uttarakhand",
    "uttar pradesh": "Uttar Pradesh", "rajasthan": "Rajasthan", "jammu and kashmir": "Jammu and Kashmir",
    "jammu & kashmir": "Jammu and Kashmir", "ladakh": "Ladakh",
}


def km(a_lat, a_lng, b_lat, b_lng) -> float:
    p = math.pi / 180
    h = (math.sin((b_lat - a_lat) * p / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lng - a_lng) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


def tidy(name: str) -> str:
    name = re.sub(r"\s+", " ", name).strip(" ,.-|")
    if name.isupper() or name.islower():
        name = " ".join(w if w in {"KV", "DAV", "DPS", "PM", "APS", "AFS", "JNV", "MLZS", "GD"}
                        else w.capitalize() for w in name.split())
    return name


def load_raw() -> list[dict]:
    rows = []
    for f in sorted((WORK / "raw").glob("*.json")):
        for line in f.read_text(encoding="utf8").splitlines():
            if line.strip():
                v = json.loads(line)
                rows += [x for x in (v if isinstance(v, list) else [v]) if x]
    return rows


def main() -> None:
    geo = json.loads((WORK / "geocode.json").read_text(encoding="utf8"))
    centres = {}  # state -> [(city, lat, lng)]
    for key, c in geo.items():
        state, city = key.split("|")
        centres.setdefault(state, []).append((city, c["lat"], c["lng"]))

    raw = load_raw()
    rejected = []
    by_id = {}
    seen_ids = set()
    for r in raw:
        pid = r.get("data_id") or r.get("place_id") or r.get("cid")
        title = (r.get("title") or "").strip()
        cats = r.get("categories") or ([r["category"]] if r.get("category") else [])
        lat, lng = r.get("latitude"), r.get("longtitude") or r.get("longitude")

        def reject(why):
            rejected.append({"title": title, "address": r.get("address", ""), "categories": "; ".join(cats), "why": why})

        if not pid or not title or lat is None or lng is None:
            reject("no id or location")
            continue
        if pid in by_id or pid in seen_ids:
            continue
        seen_ids.add(pid)
        chain = next((c for c, rx in CHAIN_RE if rx.search(title)), None)
        if not chain:
            reject("name is not a chain school")
            continue
        if BAD_NAME.search(title):
            reject("name is not a school campus")
            continue
        is_inter = bool(re.search(r"\b(inter(mediate)?\.?\s+college|junior college)\b", title, re.I))

        if cats and BAD_CATEGORY.search(cats[0]) and not (
            # A real KV is often filed under "Government office".
            (chain in {"KV", "JNV"} and cats[0].lower() == "government office")
            or (is_inter and cats[0].lower() in {"college", "junior college"})
        ):
            reject(f"category {cats[0]}")
            continue
        if cats and not any(SCHOOL_CATEGORY.search(c) for c in cats) and not (
            is_inter and any(c.lower() in {"college", "junior college"} for c in cats)
        ):
            reject(f"no school category ({cats[0]})")
            continue

        addr = r.get("complete_address") or {}
        raw_state = (addr.get("state") or "").strip().lower()
        state = STATE_ALIASES.get(raw_state)
        if not state:
            for alias, canon in STATE_ALIASES.items():
                if raw_state.startswith(alias):
                    state = canon
                    break

        if raw_state and not state:
            reject(f"outside North India ({addr.get('state')})")
            continue

        full_addr = (r.get("address") or "").strip()
        if re.search(r"\b(madhya pradesh|bihar|jabalpur)\b", full_addr, re.I):
            reject(f"outside North India ({full_addr[-40:]})")
            continue

        if not state:
            # No state in the address: take the state of the nearest district centre.
            near = min(((km(lat, lng, la, ln), st) for st, cs in centres.items() for _, la, ln in cs))
            state = near[1] if near[0] < 40 else None
        if not state or state not in centres:
            reject(f"outside North India ({addr.get('state') or full_addr[-40:]})")
            continue

        if re.search(r"^shop\s+no\.?\b|^booth\s+no\.?\b", full_addr, re.I):
            reject("shop in market")
            continue

        addr_city = (addr.get("city") or "").lower()
        named = [c for c in centres[state] if re.search(rf"\b{re.escape(c[0].lower())}\b", addr_city)]
        options = named or centres[state]
        dist, city = min((km(lat, lng, la, ln), c) for c, la, ln in options)
        if dist > 60:
            reject(f"{dist:.0f} km from the nearest district centre")
            continue

        pincode = str(addr.get("postal_code") or "")
        if not re.fullmatch(r"\d{6}", pincode):
            m = re.search(r"\b(\d{6})\b", r.get("address", ""))
            pincode = m.group(1) if m else ""

        by_id[pid] = {
            "maps_place_id": pid,
            "chain": chain,
            "school": CHAIN_INFO[chain]["name"],
            "name": tidy(title),
            "state": state,
            "city": city,
            "address": (r.get("address") or "").strip(),
            "locality": (addr.get("borough") or "").split(",")[0].strip(),
            "pincode": pincode,
            "latitude": round(lat, 6),
            "longitude": round(lng, 6),
            "phone": re.sub(r"[^\d+]", "", r.get("phone") or "")[:20],
            "website": (r.get("web_site") or "")[:300],
            "categories": cats,
        }

    # Merge the same campus listed twice (primary and secondary wing, old pin).
    kept: list[dict] = []
    for b in sorted(by_id.values(), key=lambda b: (-bool(b["website"]), -bool(b["phone"]), len(b["name"]))):
        twin = next((k for k in kept if k["chain"] == b["chain"]
                     and km(k["latitude"], k["longitude"], b["latitude"], b["longitude"]) < 0.2), None)
        if twin:
            rejected.append({"title": b["name"], "address": b["address"], "categories": "",
                             "why": f"same campus as {twin['name']}"})
            continue
        kept.append(b)

    # Campus names must be unique within a school and city.
    seen: dict[tuple, int] = {}
    for b in sorted(kept, key=lambda b: (b["state"], b["city"], b["name"])):
        key = (b["chain"], b["state"], b["city"], b["name"].lower())
        if key in seen:
            extra = b["locality"] or b["pincode"] or str(seen[key] + 1)
            b["name"] = f"{b['name']}, {extra}"
        seen[key] = seen.get(key, 0) + 1
    names = {}
    for b in kept:
        key = (b["chain"], b["state"], b["city"], b["name"].lower())
        names[key] = names.get(key, 0) + 1
        if names[key] > 1:
            b["name"] = f"{b['name']} ({names[key]})"

    kept.sort(key=lambda b: (b["state"], b["city"], b["school"], b["name"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"chains": CHAIN_INFO, "branches": kept}, ensure_ascii=False, indent=1), encoding="utf8")

    with open(WORK / "rejected.csv", "w", newline="", encoding="utf8") as f:
        w = csv.DictWriter(f, fieldnames=["title", "address", "categories", "why"])
        w.writeheader()
        w.writerows(rejected)

    try:
        import openpyxl
        from openpyxl.styles import Font

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Branches"
        cols = ["state", "city", "school", "name", "address", "pincode", "phone", "website",
                "latitude", "longitude", "maps_place_id"]
        ws.append([c.replace("_", " ").title() for c in cols])
        for c in ws[1]:
            c.font = Font(bold=True)
        for b in kept:
            ws.append([b[c] for c in cols])
        ws.freeze_panes = "A2"
        for col, width in zip("ABCDEFGHIJK", (16, 16, 26, 42, 60, 9, 14, 30, 10, 10, 24)):
            ws.column_dimensions[col].width = width
        summary = wb.create_sheet("Summary")
        summary.append(["School", "Fit", "Branches"])
        for c, info in CHAIN_INFO.items():
            summary.append([info["name"], info["fit"], sum(b["chain"] == c for b in kept)])
        summary.append([])
        summary.append(["State", "Cities", "Branches"])
        for st in STATES:
            sb = [b for b in kept if b["state"] == st]
            summary.append([st, len({b["city"] for b in sb}), len(sb)])
        wb.save(WORK / "north_india_schools.xlsx")
    except ImportError:
        pass

    print(f"{len(raw)} raw places, {len(kept)} branches kept, {len(rejected)} rejected")
    for c, info in CHAIN_INFO.items():
        print(f"  {info['name']}: {sum(b['chain'] == c for b in kept)}")


if __name__ == "__main__":
    main()
