"""
Scrape the North India school chains from Google Maps with gosom/google-maps-scraper.

    python scripts/school_directory/scrape.py --exe <path to google_maps_scraper.exe>

1. Geocodes every district headquarters in districts.py (OpenStreetMap
   Nominatim, cached in work/geocode.json).
2. Runs the scraper in fast mode once per search point with every chain query,
   writing work/raw/<point>.json. Points already scraped are skipped, so the
   script can be stopped and run again.

Then run clean.py to filter, dedupe and assign each school to a state and city.
The scraper's full mode (with photos) fails with "unexpected page type" since
November 2026 (gosom/google-maps-scraper#322), so fast mode is used.
"""

import argparse
import json
import math
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from districts import GRID_KM, STATES  # noqa: E402

WORK = HERE / "work"
RAW = WORK / "raw"
GEOCODE_CACHE = WORK / "geocode.json"

# One query per chain in "North India School Chains Uniform Targets.xlsx".
CHAIN_QUERIES = [
    "Kendriya Vidyalaya",
    "Army Public School",
    "Saraswati Vidya Mandir",
    "Saraswati Shishu Mandir",
    "Air Force School",
    "Kidzee",
    "DAV Public School",
    "Delhi Public School",
    "Mount Litera Zee School",
    "Seth Anandram Jaipuria School",
    "GD Goenka Public School",
    "Ryan International School",
    "Sainik School",
    "Jawahar Navodaya Vidyalaya",
]


def slug(s: str) -> str:
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-")


def geocode_all() -> dict:
    cache = json.loads(GEOCODE_CACHE.read_text(encoding="utf8")) if GEOCODE_CACHE.exists() else {}
    for state, cities in STATES.items():
        for city, place in cities:
            key = f"{state}|{city}"
            if key in cache:
                continue
            q = urllib.parse.urlencode(
                {"q": f"{place}, {state}, India", "format": "json", "limit": 1, "countrycodes": "in"}
            )
            req = urllib.request.Request(
                f"https://nominatim.openstreetmap.org/search?{q}",
                headers={"User-Agent": "SchoolStore-directory/1.0"},
            )
            try:
                hits = json.loads(urllib.request.urlopen(req, timeout=30).read())
            except Exception as exc:  # network hiccup: retry next run
                print(f"geocode failed {key}: {exc}", flush=True)
                hits = None
            if hits:
                cache[key] = {"lat": float(hits[0]["lat"]), "lng": float(hits[0]["lon"])}
                print(f"geocoded {key}: {cache[key]}", flush=True)
            elif hits == []:
                print(f"NOT FOUND {key} ({place})", flush=True)
            GEOCODE_CACHE.write_text(json.dumps(cache, indent=1), encoding="utf8")
            time.sleep(1.1)  # Nominatim usage policy: 1 request a second
    return cache


def search_points(geo: dict) -> list[dict]:
    points = []
    for state, cities in STATES.items():
        for city, _ in cities:
            c = geo.get(f"{state}|{city}")
            if not c:
                continue
            n, step = GRID_KM.get(city, (1, 0.0))
            half = (n - 1) / 2
            for i in range(n):
                for j in range(n):
                    dlat = (i - half) * step / 111.0
                    dlng = (j - half) * step / (111.0 * math.cos(math.radians(c["lat"])))
                    points.append({
                        "id": f"{slug(state)}__{slug(city)}__{i}{j}",
                        "state": state,
                        "city": city,
                        "lat": round(c["lat"] + dlat, 5),
                        "lng": round(c["lng"] + dlng, 5),
                        # A single centre point searches wider than a grid cell.
                        "radius": 25000 if n == 1 else int(step * 1000),
                    })
    return points


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    geo = geocode_all()
    points = search_points(geo)
    (WORK / "points.json").write_text(json.dumps(points, indent=1), encoding="utf8")
    queries = WORK / "queries.txt"
    queries.write_text("\n".join(CHAIN_QUERIES) + "\n", encoding="utf8")

    todo = [p for p in points if not (RAW / f"{p['id']}.json").exists()]
    print(f"{len(points)} search points, {len(todo)} to scrape", flush=True)
    for n, p in enumerate(todo, 1):
        out = RAW / f"{p['id']}.json"
        tmp = out.with_suffix(".part")
        tmp.unlink(missing_ok=True)
        cmd = [
            args.exe, "-input", str(queries), "-results", str(tmp), "-json", "-fast-mode",
            "-geo", f"{p['lat']},{p['lng']}", "-zoom", "13", "-radius", str(p["radius"]),
            "-c", str(args.concurrency), "-exit-on-inactivity", "40s",
        ]
        started = time.time()
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf8", errors="replace")
        failed = proc.stdout.count('"status":"failed"') + proc.stderr.count('"status":"failed"')
        lines = tmp.read_text(encoding="utf8").count("\n") if tmp.exists() else 0
        if tmp.exists() and lines:
            tmp.replace(out)
        print(
            f"[{n}/{len(todo)}] {p['id']}: {lines} query results, {failed} failed, "
            f"{time.time() - started:.0f}s",
            flush=True,
        )
        if not lines:
            # Probably rate limited: back off before the next point.
            time.sleep(60)


if __name__ == "__main__":
    main()
