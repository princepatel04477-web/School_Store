"""
Give school branches their UDISE+ code, and add the chain schools on the
UDISE+ list that Google Maps did not return.

    python scripts/school_directory/udise.py

Source: the ADS Initiative schools directory (UDISE+ operational schools,
Apache 2.0, https://github.com/learnram/ads-schools-data), downloaded to
work/ads-schools-v10.csv.gz:

    gh release download schools-v10 -R learnram/ads-schools-data -p "ads-schools-v10.csv.gz" -D scripts/school_directory/work

1. Match each Google branch to a UDISE+ school. UDISE+ has no coordinates,
   and chains such as Kendriya Vidyalaya are filed under their administering
   region rather than their district, so matching starts from the pincode:
     high    the same pincode holds one school of the chain (for Saraswati,
             DAV and other chains whose campuses crowd together, it must also
             share a place word), or one that clearly shares the most place words
     medium  none of the chain in that pincode, but exactly one in the same
             state whose name holds every place word of the branch name
   Anything less certain is left without a code rather than guessed.
2. Add each chain school on the UDISE+ list that no branch matched, placed in
   the shop city for its district (from its pincode when it is filed under a
   region). These have the UDISE+ name and pincode but no map location.

Safe to run again: branches added by an earlier run are rebuilt. Updates
backend/schools/data/north_india_schools.json and writes work/udise_matches.csv.
"""

import csv
import gzip
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from clean import CHAIN_RE, OUT, tidy  # noqa: E402
from districts import STATES  # noqa: E402

WORK = HERE / "work"
ADS = WORK / "ads-schools-v10.csv.gz"

# First two digits of a UDISE code.
STATE_CODES = {
    "Jammu and Kashmir": "01", "Himachal Pradesh": "02", "Punjab": "03", "Chandigarh": "04",
    "Uttarakhand": "05", "Haryana": "06", "Delhi": "07", "Rajasthan": "08", "Uttar Pradesh": "09",
    "Ladakh": "37",
}

# UDISE+ district (IGOD spelling) -> the city the shop shows, where they differ.
DISTRICT_CITY = {
    "Mahendragarh": "Narnaul", "Mewat": "Nuh", "Kangra": "Dharamshala", "Kinnaur": "Reckong Peo",
    "Lahaul And Spiti": "Keylong", "Lahul And Spiti": "Keylong", "Sirmaur": "Nahan",
    "Chamoli": "Gopeshwar", "Pauri Garhwal": "Pauri", "Garhwal": "Pauri", "Tehri Garhwal": "New Tehri",
    "Udham Singh Nagar": "Rudrapur", "Ambedkar Nagar": "Akbarpur", "Sant Ravidas Nagar": "Bhadohi",
    "Gautam Buddha Nagar": "Noida", "Jalaun": "Orai", "Kanpur Nagar": "Kanpur",
    "Kushinagar": "Padrauna", "Kheri": "Lakhimpur", "Lakhimpur Kheri": "Lakhimpur",
    "Sant Kabir Nagar": "Khalilabad", "Shrawasti": "Bhinga", "Shravasti": "Bhinga",
    "Sonbhadra": "Robertsganj", "Siddharth Nagar": "Siddharthnagar", "Mahrajganj": "Maharajganj",
    "Allahabad": "Prayagraj", "Faizabad": "Ayodhya", "Sahibzada Ajit Singh Nagar": "Mohali",
    "S.A.S Nagar": "Mohali", "Shahid Bhagat Singh Nagar": "Nawanshahr", "Muktsar": "Sri Muktsar Sahib",
    "Ganganagar": "Sri Ganganagar", "Chittaurgarh": "Chittorgarh", "Jalor": "Jalore",
    "Jhunjhunun": "Jhunjhunu", "Dhaulpur": "Dholpur", "Leh Ladakh": "Leh", "Gurgaon": "Gurugram",
    "Firozpur": "Ferozepur", "Hardwar": "Haridwar", "Bulandshahar": "Bulandshahr", "Badaun": "Budaun",
    "Rae Bareli": "Raebareli", "Mahamaya Nagar": "Hathras", "Kanshiram Nagar": "Kasganj",
    "Jyotiba Phule Nagar": "Amroha", "Panchsheel Nagar": "Hapur", "Bhim Nagar": "Sambhal",
    "Shupiyan": "Shopian", "Badgam": "Budgam", "Bandipore": "Bandipora", "Punch": "Poonch",
    "Baramula": "Baramulla", "Rajauri": "Rajouri",
    # Rajasthan's districts formed in 2023, named by their headquarters in the shop.
    "Didwana-Kuchaman": "Didwana", "Kotputli-Behror": "Kotputli", "Khairthal-Tijara": "Khairthal",
}

# Filed under the body that runs them rather than a district: placed by pincode.
NOT_A_DISTRICT = ("REGION", "COMMAND")

# Words that say what kind of school it is, not where it is.
GENERIC = set("""
KENDRIYA VIDYALAYA VIDHYALAYA VIDYALAY KV PM SHRI SRI SHREE SMT ARMY PUBLIC SCHOOL SCHOOLS APS AIR FORCE
AFS SARASWATI SARASWATHI SHISHU SISHU BAL BALIKA VIDYA VIDHYA MANDIR NIKETAN INTER COLLEGE KIDZEE DAV D A V
DELHI DPS MOUNT LITERA ZEE MLZS SETH ANANDRAM ANAND RAM JAIPURIA GD G D GOENKA RYAN INTERNATIONAL SAINIK
JAWAHAR NAVODAYA JNV SENIOR SR SECONDARY SEC HIGHER HIGH JUNIOR JR PRIMARY PRE NURSERY MODEL CENTENARY
NO NUMBER THE AND OF CBSE ENGLISH MEDIUM CO ED PRESCHOOL PLAY WING SECTION BRANCH CAMPUS SECTOR
""".split())

# Chains whose every school is registered on UDISE+.
COMPLETE_ON_UDISE = {"KV", "JNV", "SAINIK"}

# Government chains rarely have two unrelated campuses in one pincode.
LOOSE_CHAINS = {"KV", "JNV", "AFS", "APS", "SAINIK"}


def words(name: str) -> list[str]:
    name = re.sub(r"\(code[- ]?\d+\)", " ", name, flags=re.I)
    return re.findall(r"[A-Z0-9]+", name.upper().replace(".", ""))


def place_words(name: str) -> set[str]:
    # Numbers stay: "No. 2" and "Sector 3" tell campuses apart.
    return {w for w in words(name) if w not in GENERIC and (len(w) > 1 or w.isdigit())}


def chain_of(name: str) -> str | None:
    return next((c for c, rx in CHAIN_RE if rx.search(name)), None)


def norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def load_ads():
    by_pin = defaultdict(list)
    by_state_chain = defaultdict(list)
    # pincode -> district votes from every school, so a chain school filed under
    # its administering region ("LUCKNOW REGION") can still be placed in a district.
    pin_district = defaultdict(lambda: defaultdict(int))
    wanted = set(STATE_CODES.values())
    with gzip.open(ADS, "rt", encoding="utf8", newline="") as f:
        for row in csv.DictReader(f):
            code = row["udise_code"]
            if row["source"] != "UDISE" or code[:2] not in wanted:
                continue
            if row["pincode"] and not any(w in row["igod_district_name"].upper() for w in NOT_A_DISTRICT):
                pin_district[row["pincode"]][(code[:2], row["igod_district_name"])] += 1
            chain = chain_of(row["school_name"])
            if not chain:
                continue
            row["chain"] = chain
            row["name_place"] = place_words(row["school_name"])
            # The district counts as a place word only when searching a whole state.
            row["place"] = row["name_place"] | set(words(row["igod_district_name"]))
            if row["pincode"]:
                by_pin[row["pincode"]].append(row)
            by_state_chain[(code[:2], chain)].append(row)
    return by_pin, by_state_chain, pin_district


def best(branch_words, candidates):
    scored = sorted(((len(branch_words & c["name_place"]), c) for c in candidates), key=lambda x: -x[0])
    if not scored or scored[0][0] == 0:
        return None
    if len(scored) > 1 and scored[0][0] <= scored[1][0]:
        return None  # a tie: do not guess
    return scored[0][1]


def match_google_branches(data, by_pin, by_state_chain):
    used = {}
    for b in data["branches"]:
        for k in ("udise_code", "udise_name", "udise_match"):
            b.pop(k, None)
        bw = place_words(b["name"])
        match, how = None, ""
        same_pin = [c for c in by_pin.get(b["pincode"], []) if c["chain"] == b["chain"]]
        if len(same_pin) == 1:
            only = same_pin[0]
            if b["chain"] in LOOSE_CHAINS or not bw or not only["name_place"] or bw & only["name_place"]:
                match, how = only, "high"
        elif same_pin:
            match = best(bw, same_pin)
            how = "high" if match else ""
        else:
            pool = by_state_chain.get((STATE_CODES.get(b["state"], "--"), b["chain"]), [])
            near = [c for c in pool if bw and bw <= c["place"] | {b["city"].upper()}]
            if len(near) == 1:
                match, how = near[0], "medium"
        if match and match["udise_code"] in used:
            match = None  # Google listed the same school twice: the first listing keeps the code
        if match:
            used[match["udise_code"]] = b["maps_place_id"]
            b["udise_code"], b["udise_name"], b["udise_match"] = match["udise_code"], match["school_name"], how
    return used


def city_finder():
    """(state code, UDISE district) -> (state, shop city), or None."""
    cities = {}
    for state, items in STATES.items():
        for city, _ in items:
            cities[(STATE_CODES[state], norm(city))] = (state, city)
    aliases = {norm(k): v for k, v in DISTRICT_CITY.items()}

    def find(state_code, district):
        if state_code == STATE_CODES["Delhi"]:
            return ("Delhi", "Delhi")
        if state_code == STATE_CODES["Chandigarh"]:
            return ("Chandigarh", "Chandigarh")
        d = norm(district)
        for key in (d, norm(aliases.get(d, ""))):
            if key and (state_code, key) in cities:
                return cities[(state_code, key)]
        return None

    return find


def udise_branch_name(name: str) -> str:
    name = re.sub(r"\(code[- ]?\d+\)", "", name, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip(" ,.-")
    name = " ".join(w if w in {"PM", "DAV", "KV", "JNV", "AFS", "APS", "MLZS", "GD", "DPS"} else w.capitalize()
                    for w in name.split())
    return tidy(name.replace("Pm Shri", "PM SHRI").replace("D.a.v", "DAV").replace("D.a.v.", "DAV"))


def google_twin(unmatched, chain, state, city, row):
    """An unmatched Google branch in the same city that is clearly this UDISE+ school."""
    city_words = set(words(city))
    want = row["name_place"] - city_words
    if not want:
        return None
    scored = sorted(((len((place_words(b["name"]) - city_words) & want), b)
                     for b in unmatched.get((chain, state, city), [])), key=lambda x: -x[0])
    if not scored or scored[0][0] == 0 or (len(scored) > 1 and scored[0][0] <= scored[1][0]):
        return None
    return scored[0][1]


def add_udise_only(data, by_state_chain, pin_district, used):
    find = city_finder()
    unplaced = defaultdict(int)
    added = 0
    unmatched = defaultdict(list)
    for b in data["branches"]:
        if not b.get("udise_code"):
            unmatched[(b["chain"], b["state"], b["city"])].append(b)
    for (state_code, chain), schools in by_state_chain.items():
        if chain not in data["chains"]:
            continue
        for row in schools:
            if row["udise_code"] in used:
                continue
            district = row["igod_district_name"]
            if not district or any(w in district.upper() for w in NOT_A_DISTRICT):
                votes = {k: v for k, v in pin_district.get(row["pincode"], {}).items() if k[0] == state_code}
                district = max(votes, key=votes.get)[1] if votes else ""
            place = find(state_code, district)
            if not place:
                unplaced[f"{district or '?'} ({state_code})"] += 1
                continue
            state, city = place
            pin = row["pincode"]
            twin = google_twin(unmatched, chain, state, city, row)
            if twin:
                # The Google listing of this school had another pincode: give it the code.
                twin["udise_code"], twin["udise_name"], twin["udise_match"] = row["udise_code"], row["school_name"], "city"
                unmatched[(chain, state, city)].remove(twin)
                used[row["udise_code"]] = twin["maps_place_id"]
                continue
            data["branches"].append({
                "maps_place_id": None,
                "source": "udise",
                "chain": chain,
                "school": data["chains"][chain]["name"],
                "name": udise_branch_name(row["school_name"]),
                "state": state,
                "city": city,
                "address": f"{district.title()}, {state}" + (f" {pin}" if pin else ""),
                "locality": "",
                "pincode": pin,
                "latitude": None,
                "longitude": None,
                "phone": "",
                "website": "",
                "categories": [],
                "udise_code": row["udise_code"],
                "udise_name": row["school_name"],
                "udise_match": "udise-only",
            })
            used[row["udise_code"]] = "udise"
            added += 1

    # Campus names must stay unique within a school and city (Google names win).
    taken = set()
    for b in sorted(data["branches"], key=lambda b: (b.get("source") == "udise", b["name"])):
        place = (b["chain"], b["state"], b["city"])
        name, n = b["name"][:180], 1
        while (*place, name.lower()) in taken:
            n += 1
            name = f"{b['name'][:180]} ({b['pincode']}, {n})" if b["pincode"] else f"{b['name'][:180]} ({n})"
            if n == 2 and b["pincode"] and (*place, f"{b['name'][:180]} ({b['pincode']})".lower()) not in taken:
                name = f"{b['name'][:180]} ({b['pincode']})"
        b["name"] = name
        taken.add((*place, name.lower()))
    return added, unplaced


def write_workbook(data):
    """work/north_india_schools.xlsx: every branch with its UDISE+ code, plus a summary."""
    import openpyxl
    from openpyxl.styles import Font

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Branches"
    cols = [("State", "state"), ("City", "city"), ("School", "school"), ("Branch", "name"),
            ("UDISE code", "udise_code"), ("Address", "address"), ("Pincode", "pincode"),
            ("Phone", "phone"), ("Website", "website"), ("Latitude", "latitude"), ("Longitude", "longitude"),
            ("Source", "source"), ("UDISE match", "udise_match")]
    ws.append([c for c, _ in cols])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for b in data["branches"]:
        row = [b.get(k) if k != "source" else ("UDISE+" if b.get("source") == "udise" else "Google Maps")
               for _, k in cols]
        ws.append(row)
        ws.cell(ws.max_row, 5).number_format = "@"  # keep leading zeros
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for col, width in zip("ABCDEFGHIJKLM", (16, 16, 26, 44, 14, 50, 9, 14, 28, 10, 10, 12, 12)):
        ws.column_dimensions[col].width = width
    summary = wb.create_sheet("Summary")
    summary.append(["School", "Fit", "Branches", "With UDISE code"])
    for chain, info in data["chains"].items():
        bs = [b for b in data["branches"] if b["chain"] == chain]
        summary.append([info["name"], info["fit"], len(bs), sum(bool(b.get("udise_code")) for b in bs)])
    summary.append([])
    summary.append(["State", "Cities", "Branches", "With UDISE code"])
    for state in STATES:
        bs = [b for b in data["branches"] if b["state"] == state]
        summary.append([state, len({b["city"] for b in bs}), len(bs), sum(bool(b.get("udise_code")) for b in bs)])
    for cell in summary[1]:
        cell.font = Font(bold=True)
    wb.save(WORK / "north_india_schools.xlsx")


def main() -> None:
    if not ADS.exists():
        sys.exit(f"Missing {ADS}. Download it first (see the docstring).")
    data = json.loads(OUT.read_text(encoding="utf8"))
    by_pin, by_state_chain, pin_district = load_ads()
    data["branches"] = [b for b in data["branches"] if b.get("source") != "udise"]
    google = len(data["branches"])

    used = match_google_branches(data, by_pin, by_state_chain)
    added, unplaced = add_udise_only(data, by_state_chain, pin_district, used)
    matched = sum(bool(b.get("udise_code")) for b in data["branches"] if b.get("source") != "udise")
    # Every recognised KV, Navodaya and Sainik school is on UDISE+, so a Google listing of
    # one with no code is a duplicate or a stray pin. (Army and Air Force pre-primary
    # schools often are not on UDISE+, so those stay.)
    dropped = [b for b in data["branches"] if b["chain"] in COMPLETE_ON_UDISE and not b.get("udise_code")]
    data["branches"] = [b for b in data["branches"] if b not in dropped]
    print(f"Dropped {len(dropped)} KV/JNV/Sainik Google listings with no UDISE code (duplicates)")
    data["branches"].sort(key=lambda b: (b["state"], b["city"], b["school"], b["name"]))
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf8")

    rows = [{
        "state": b["state"], "city": b["city"], "school": b["school"], "name": b["name"],
        "pincode": b["pincode"], "udise_code": b.get("udise_code", ""), "udise_name": b.get("udise_name", ""),
        "match": b.get("udise_match", ""), "source": b.get("source", "google"),
    } for b in data["branches"]]
    with open(WORK / "udise_matches.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    write_workbook(data)
    total = len(data["branches"])
    coded = sum(bool(b.get("udise_code")) for b in data["branches"])
    print(f"Google branches: {google}, matched to UDISE+: {matched}")
    print(f"Added from UDISE+ (not on Google): {added}; could not place in a city: {sum(unplaced.values())}")
    for d, n in sorted(unplaced.items(), key=lambda x: -x[1])[:20]:
        print(f"    unplaced: {d}: {n}")
    print(f"Total branches: {total}, with a UDISE code: {coded}")
    for chain, info in data["chains"].items():
        n = sum(b["chain"] == chain for b in data["branches"])
        k = sum(b["chain"] == chain and bool(b.get("udise_code")) for b in data["branches"])
        print(f"  {info['name']}: {n} branches, {k} with UDISE code")


if __name__ == "__main__":
    main()
