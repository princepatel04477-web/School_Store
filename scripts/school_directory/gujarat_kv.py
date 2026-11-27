"""
Build the Gujarat Kendriya Vidyalaya directory file.

    python scripts/school_directory/gujarat_kv.py [--csv scripts/school_directory/gujarat_kv_source.csv]

Reads the list of Kendriya Vidyalayas in Gujarat (gujarat_kv_source.csv: name, city,
district, cluster, sector, year, website), gives each its UDISE+ code and pincode from the
ADS Initiative UDISE+ file (work/ads-schools-v10.csv.gz, see udise.py for the download), and
finds its map position with OpenStreetMap Nominatim (cached in work/gujarat_geocode.json).
A position is only kept when OpenStreetMap names a Kendriya Vidyalaya place inside Gujarat
within 40 km of the city; otherwise latitude and longitude stay empty rather than guessed.

Each school's own website (its /en/contact-us page, cached in work/kvs_contact/) gives the
street address, pincode and office phone, and its header repeats the school's UDISE+ code, which
is checked against the code matched above. The school's pincode wins over the UDISE+ file's.

Writes backend/schools/data/gujarat_kv_schools.json, in the same shape as
north_india_schools.json. Load it with:

    cd backend && python manage.py import_school_directory schools/data/gujarat_kv_schools.json

Do not add --deactivate-missing: it would switch off the other Kendriya Vidyalaya branches.

Safe to run again: the file is rebuilt from the sources each time.
"""

import argparse
import csv
import gzip
import json
import math
import re
import time
import html
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = HERE / "work"
ADS = WORK / "ads-schools-v10.csv.gz"
CACHE = WORK / "gujarat_geocode.json"
SITES = WORK / "kvs_contact"
OUT = ROOT / "backend" / "schools" / "data" / "gujarat_kv_schools.json"

# Serial number in the source list -> UDISE+ code. Matched by hand on the "(Code-NNNN)" KVS
# code and the pincode, because UDISE+ files Kendriya Vidyalayas under "Ahmedabad Region",
# not under their district, and spells names differently (Junagarh, Dharangandhra, Himmat Nagar).
UDISE_BY_SR = {
    1: "24071201726", 2: "24070608739", 3: "24191304206", 4: "24140506640", 5: "24020407204",
    6: "24290201031", 7: "24011001062", 8: "24060202510", 9: "24060213036", 10: "24050703919",
    11: "24090501795", 12: "24121608051", 13: "24110107795", 14: "24091501244", 15: "24221500405",
    16: "24070308647", 17: "24170203181", 18: "24180107573", 19: "24071202426", 20: "24191304210",
    21: "24191306410", 22: "24010522131", 23: "24010522113", 24: "24080201010", 25: "24060213403",
    26: "24100710421", 27: "24100710529", 28: "24100710422", 29: "24100406604", 30: "24100710420",
    31: "24010705312", 32: "24290203209", 33: "24060304462", 34: "24191103002", 35: "24150104703",
    36: "24070501537", 37: "24060201720", 38: "24210201702", 39: "24191300627", 40: "24150401902",
    41: "24011001065", 42: "24040408605", 43: "24220200305", 44: "24221529808", 45: "24031203203",
    # DPA Gandhidham is the Deendayal Port Authority colony at Gopalpuri (UDISE+ lists it as
    # "Kendriya Vidyalaya Gopalpuri", same Gandhidham pincode).
    46: "24011001136",
    # 47 (100 Bn CRPF Vastral, opened 2026) is not on UDISE+ yet.
}

# Picker city for a campus whose "City / Location" names a place inside a bigger city, with
# the part that goes into the address.
CITY_FIX = {"Hazira, Surat": ("Surat", "Hazira"), "Vastral, Ahmedabad": ("Ahmedabad", "Vastral")}
# The street line as each school's contact page prints it, tidied by hand where the page mixes
# in the school's name, constituency, stray words or upper case. Anything not listed here is
# used as parsed by site_contact().
STREET_FIX = {
    4: "Near Old Loco Shed, Railway Colony",
    1: "Nr. Police Commissioner Office, Shahibaug",
    3: "Nr. Sangam Char Rasta, Harni Road",
    6: "Near Rukshmani Devi Temple",
    7: "Railway Colony",
    9: "Sector 30, Near CHH-6 Circle",
    11: "Rajkot-Porbandar Highway, Pedhla",
    15: "Opp. SVNIT, Ichhanath",
    16: "Opp. Sahyog Hotel, Near Hansalpur Chowkdi, State Highway 17",
    17: "Abraham Patel Na Muvada, National Highway Ahmedabad-Indore",
    18: "Freelandganj, Muvaliya Crossing, Godhra Road",
    19: "Near Hanuman Temple, Daffnala, Airport Road",
    20: "Near Metro Hospital, Sama-Savli Road",
    21: "Makarpura",
    22: "Khavda Road",
    24: "Army Area",
    26: "No. 1 AFS",
    27: "Infantry Lines, New Jail Road, Near Pawan Chakki",
    28: "No. 3 Air Force II, Opposite Rozy Petrol Pump",
    29: "Taluka Jam Jodhpur",
    30: "Rozibet",
    31: "Inside Air Force Station, Post Office Abdasa",
    32: "Near Hatila Hanuman Temple, Dwarka Road",
    33: "AFS Wadsar",
    34: "AFS Darjipura",
    35: "S.P. University Staff Quarters, Near APC",
    36: "DOS Housing Colony, IIM Road, Vastrapur",
    37: "Opp. Avni Bhavan, Eastern ONGC Campus, Chandkheda",
    40: "PO Kansari",
    42: "Near Circuit House",
    39: "ONGC Campus, Makarpura Road",
    41: "IFFCO Township, Udaynagar",
    43: "KRIBHCO, Hazira Road",
    44: "ONGC Nagar",
    45: "Chormarpura, Taluka Saraswati, Near Dinosaur Park",
}
# Office phone where the page prints it in a way site_contact() does not read.
PHONE_FIX = {44: "02612728329"}


# Where the source list's wording is not what OpenStreetMap knows the campus as.
GEOCODE_NAME = {
    12: "Kendriya Vidyalaya Junagadh",
    24: "Kendriya Vidyalaya Dhrangadhra",
    35: "Kendriya Vidyalaya Vallabh Vidyanagar",
    43: "Kendriya Vidyalaya Hazira",
}

# Fits Gujarat, with a margin: anything outside is a wrong match.
BBOX = (20.0, 68.0, 25.0, 74.6)
MAX_KM = 40


def km(a, b):
    r = 6371
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


_last = [0.0]


def nominatim(cache, query, **extra):
    key = query + json.dumps(extra, sort_keys=True)
    if key in cache:
        return cache[key]
    wait = 1.2 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)  # usage policy: one request a second
    params = {"q": query, "format": "json", "limit": 5, "countrycodes": "in", **extra}
    req = urllib.request.Request(
        "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params),
        headers={"User-Agent": "SchoolStore-directory/1.0"},
    )
    try:
        hits = json.loads(urllib.request.urlopen(req, timeout=30).read())
    except Exception as exc:  # network hiccup: not cached, retried next run
        print(f"  geocode failed ({exc})")
        return []
    _last[0] = time.time()
    cache[key] = hits
    CACHE.write_text(json.dumps(cache, indent=1), encoding="utf8")
    return hits


def city_centre(cache, city):
    hits = nominatim(cache, f"{city}, Gujarat, India")
    if hits:
        return float(hits[0]["lat"]), float(hits[0]["lon"])
    return None


def find_position(cache, sr, name, city, locality):
    centre = city_centre(cache, city)
    if centre is None:
        return None, ""
    short = GEOCODE_NAME.get(sr) or name
    queries = [f"{short}, {city}, Gujarat", f"{short}, Gujarat"]
    if locality:
        queries.append(f"Kendriya Vidyalaya, {locality}, {city}, Gujarat")
    for q in queries:
        for h in nominatim(cache, q):
            pos = (float(h["lat"]), float(h["lon"]))
            inside = BBOX[0] <= pos[0] <= BBOX[2] and BBOX[1] <= pos[1] <= BBOX[3]
            text = (h.get("display_name") or "").lower() + " " + (h.get("name") or "").lower()
            if inside and "kendriya" in text and km(pos, centre) <= MAX_KM:
                return pos, "openstreetmap"
    return None, ""


def site_text(site):
    """Plain text of the school's /en/contact-us page, fetched once and kept in work/kvs_contact."""
    host = re.sub(r"https?://", "", site).strip("/")
    path = SITES / f"{host}.html"
    if not path.exists() or path.stat().st_size < 5000:
        SITES.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(
            site.rstrip("/") + "/en/contact-us", headers={"User-Agent": "Mozilla/5.0"}
        )
        try:
            path.write_bytes(urllib.request.urlopen(req, timeout=30).read())
        except Exception as exc:
            print(f"  {host}: contact page not fetched ({exc})")
            return ""
        time.sleep(0.5)
    raw = path.read_text(encoding="utf8", errors="ignore")
    raw = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw)))


def name_words(name):
    return {w for w in re.findall(r"[a-z0-9]+", name.lower())}


def site_contact(site, name):
    """Street address (school's name, state and pincode taken out), pincode, phone and the UDISE+ code
    the school's header shows, from the school's own contact page."""
    text = site_text(site)
    out = {"street": "", "pincode": "", "phone": "", "udise": ""}
    m = re.search(r"UDISE Code:\s*(\d{11})", text)
    if m:
        out["udise"] = m.group(1)
    start = text.rfind("Share on Linkedin")
    if start < 0:
        return out
    block = text[start + len("Share on Linkedin"):]
    block = block.split("Feedback Website Policies")[0]
    block = re.sub(r"^\s*Contact Us\s*", "", block)
    head = re.split(r"(?i)\b(?:Website|E-?mail|Phone|Landline|Principal|Highest)\b", block, maxsplit=1)[0]
    phone_part = block[len(head):]
    pin = re.search(r"(?i)\bpin(?:\s*code)?\s*[-–:]*\s*(\d{6})\b", block) or re.search(r"\b([1-9]\d{5})\b", head)
    if pin:
        out["pincode"] = pin.group(1)
    head = re.sub(r"(?i)\bstate\s*[-:–]*\s*gujarat\b", " ", head)
    head = re.sub(r"(?i)\bpin(?:\s*code)?\s*[-–:]*\s*\d{6}\b", " ", head)
    head = re.sub(r"\b[1-9]\d{5}\b", " ", head)
    head = re.sub(r"(?i)\baddress\s*[-:–]*", " ", head)
    # Drop the school's own name and region from the front.
    skip = name_words(name) | {"pm", "shri", "kendriya", "vidyalaya", "ahmedabad", "region", "no", "air", "force", "station"}
    tokens = head.split()
    while tokens and re.sub(r"[^a-z0-9]", "", tokens[0].lower()) in skip | {""}:
        tokens.pop(0)
    street = " ".join(tokens).strip(" ,.-–:|")
    street = re.sub(r"\s+,", ",", street)
    out["street"] = street
    ph = re.search(r"(\(?0\d{2,4}\)?[\s\-\u2013]*\d{5,8}|\b[6-9]\d{9}\b)", phone_part)
    if ph:
        out["phone"] = re.sub(r"\D", "", ph.group(1))[:20]
    return out


def tidy_name(name):
    name = re.sub(r"\s+", " ", name).strip()
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(HERE / "gujarat_kv_source.csv"))
    ap.add_argument("--no-geocode", action="store_true")
    args = ap.parse_args()

    ads = {}
    with gzip.open(ADS, "rt", encoding="utf8") as f:
        for row in csv.DictReader(f):
            if row["udise_code"] in UDISE_BY_SR.values():
                ads[row["udise_code"]] = row
    cache = json.loads(CACHE.read_text(encoding="utf8")) if CACHE.exists() else {}

    branches = []
    with open(args.csv, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        sr = int(row["Sr. No."])
        name = tidy_name(row["Vidyalaya Name"])
        place = row["City / Location"].strip()
        city, locality = CITY_FIX.get(place, (place, ""))
        district = row["District"].strip()
        code = UDISE_BY_SR.get(sr)
        u = ads.get(code) if code else None
        if code and u is None:
            raise SystemExit(f"UDISE+ code {code} for #{sr} {name} is not in {ADS.name}")
        site = row["Official Website"].strip()
        contact = site_contact(site, name) if site else {"street": "", "pincode": "", "phone": "", "udise": ""}
        if code and contact["udise"] and contact["udise"] != code:
            raise SystemExit(f"#{sr} {name}: its website says UDISE+ {contact['udise']}, matched {code}")
        udise_pin = (u or {}).get("pincode", "").strip()
        if not re.fullmatch(r"\d{6}", udise_pin):
            udise_pin = ""
        pincode = contact["pincode"] or udise_pin
        if contact["pincode"] and udise_pin and contact["pincode"] != udise_pin:
            print(f"  note: website pincode {contact['pincode']} differs from UDISE+ {udise_pin}")
        pos, source = (None, "")
        if not args.no_geocode:
            print(f"#{sr} {name} ...", flush=True)
            pos, source = find_position(cache, sr, name, city, locality)
            print(f"  -> {pos or 'no position'}")
        parts = []
        for part in [STREET_FIX.get(sr) or contact["street"] or name, locality, city, district, "Gujarat"]:
            if part and part.lower() not in ", ".join(parts).lower():
                parts.append(part)
        address = ", ".join(parts)
        if pincode:
            address += f" {pincode}"
        branches.append({
            "maps_place_id": None,
            "source": "kvs-list",
            "chain": "KV",
            "school": "Kendriya Vidyalaya",
            "name": name,
            "state": "Gujarat",
            "city": city,
            "district": district,
            "address": address,
            "locality": locality,
            "pincode": pincode,
            "udise_pincode": udise_pin,
            "latitude": round(pos[0], 6) if pos else None,
            "longitude": round(pos[1], 6) if pos else None,
            "geo_source": source,
            "phone": PHONE_FIX.get(sr) or contact["phone"],
            "website": site,
            "categories": [],
            "cluster": row["Cluster"].strip(),
            "sector": row["Sector"].strip(),
            "year_of_opening": int(row["Year of Opening"]),
            "udise_code": code,
            "udise_name": (u or {}).get("school_name", ""),
            "udise_match": ("kvs-code+site" if contact["udise"] == code else "kvs-code") if u else "none",
        })

    data = {"chains": {"KV": {"name": "Kendriya Vidyalaya", "board": "CBSE", "fit": "Best"}}, "branches": branches}
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf8")
    with_pos = sum(1 for b in branches if b["latitude"] is not None)
    with_code = sum(1 for b in branches if b["udise_code"])
    print(f"wrote {len(branches)} branches to {OUT}: {with_code} with UDISE+ code, {with_pos} with map position")


if __name__ == "__main__":
    main()
