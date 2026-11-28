#!/usr/bin/env python3
"""Compare the Supabase catalogue with Django, request by request.

Two modes:

  rpc   Ask Django and the store_api functions directly (before the Worker is switched):
        parity_check.py rpc --django http://<store-server>:8000 --rpc http://127.0.0.1:8200 --secret-file edge.secret

  site  Ask the live site (Worker -> Supabase) and Django directly (after the switch):
        parity_check.py site --django http://<store-server>:8000 --site https://school-store.aqualite.workers.dev

The list of requests is built from Django's own answers: every school, state, city, branch list,
class (by name and by id) and gender, plus search, category, product type and paging cases.
Exit code 0 when every answer matches.
"""

import argparse
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CITY_PRICE_CITIES = set()
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
GENDER_WORDS = {"boy", "girl", "male", "female", "m", "f"}


def get(url, headers=None):
    """GET one URL. Waits out Django's public catalogue throttle (120 a minute per address)."""
    # Cloudflare turns away Python's default "Python-urllib" agent, so name ourselves.
    headers = {"User-Agent": "school-store-parity-check/1.0", **(headers or {})}
    for _ in range(10):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.status, json.loads(res.read().decode()), dict(res.headers)
        except urllib.error.HTTPError as err:
            body = err.read().decode()
            if err.code == 429:
                time.sleep(int(err.headers.get("Retry-After") or 5) + 1)
                continue
            try:
                body = json.loads(body)
            except ValueError:
                pass
            return err.code, body, dict(err.headers)
    raise RuntimeError(f"still throttled: {url}")


# ---- mirror of catalogueCall() in frontend/worker/index.js ----
def only_keys(params, allowed):
    return all(k in allowed for k in params)


def school_arg(params, args):
    school = (params.get("school") or "").strip()
    if not school:
        return True
    if not UUID_RE.match(school):
        return False
    args["school"] = school
    return True


def catalogue_call(path, query, origin):
    p = dict(urllib.parse.parse_qsl(query, keep_blank_values=True))
    if path == "/api/public/schools/":
        if not only_keys(p, ["search"]):
            return None
        search = (p.get("search") or "").strip()
        return "schools", ({"search": search} if search else {})
    if path in ("/api/public/schools/delivered/", "/api/public/schools/logos/"):
        return None if p else ("schools_delivered", {})
    m = re.match(r"^/api/public/schools/([^/]+)/cities/$", path)
    if m:
        return None if (not UUID_RE.match(m[1]) or p) else ("school_cities", {"school_id": m[1]})
    if path == "/api/public/states/":
        args = {}
        return ("states", args) if only_keys(p, ["school"]) and school_arg(p, args) else None
    if path == "/api/public/cities/":
        state = (p.get("state") or "").strip()
        args = {"state": state}
        ok = state and only_keys(p, ["state", "school"]) and school_arg(p, args)
        return ("cities", args) if ok else None
    m = re.match(r"^/api/public/cities/([^/]+)/branches/$", path)
    if m:
        args = {"city_id": m[1], "media_base": origin}
        if not UUID_RE.match(m[1]) or not only_keys(p, ["search", "school"]) or not school_arg(p, args):
            return None
        search = (p.get("search") or "").strip()
        if search:
            args["search"] = search
        return "city_branches", args
    if path == "/api/public/grades/":
        return None if p else ("grades", {})
    if path == "/api/public/products/":
        if not only_keys(p, ["school", "class", "grade", "gender", "city", "category", "product_type", "page_size"]):
            return None
        school, grade = p.get("school") or "", p.get("class") or p.get("grade") or ""
        gender, city = p.get("gender") or "", p.get("city") or ""
        if not UUID_RE.match(school) or not grade or gender.strip().lower() not in GENDER_WORDS:
            return None
        if city and not UUID_RE.match(city):
            return None
        args = {"school": school, "grade": grade, "gender": gender}
        if city:
            args["city"] = city
        for k in ("category", "product_type"):
            if p.get(k):
                args[k] = p[k]
        if "page_size" in p:
            n = int(p["page_size"]) if p["page_size"].isdigit() else 0
            args["page_size"] = str(min(n, 50) if n > 0 else 25)
        return "products", args
    return None


def via_rpc(rpc_base, secret, path, query, origin):
    call = catalogue_call(path, query, origin)
    if call is None:
        return None
    fn, args = call
    status, answer, _ = get(f"{rpc_base}/rpc/{fn}?{urllib.parse.urlencode(args)}", {"x-store-edge": secret})
    if status != 200 or answer.get("status") != 200:
        return ("error", status, answer)
    body = answer["body"]
    if fn == "products":
        nxt = None
        if body["next_after"]:
            q = dict(urllib.parse.parse_qsl(query, keep_blank_values=True))
            q["cursor"] = base64.b64encode(f"p={body['next_after']}".encode()).decode()
            nxt = "/api/public/products/?" + urllib.parse.urlencode(sorted(q.items()))
        body = {"next": nxt, "previous": None, "results": body["results"]}
    return ("ok", 200, body)


def same(a, b):
    if isinstance(a, float) or isinstance(b, float):
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) < 1e-9
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b


def link_path(url):
    if not url:
        return None
    parsed = urllib.parse.urlparse(url)
    return parsed.path + "?" + urllib.parse.urlencode(sorted(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)))


def requests_to_check(django):
    def d(path):
        status, body, _ = get(django + path)
        return body if status == 200 else []

    paths = ["/api/public/grades/", "/api/public/schools/", "/api/public/schools/?search=kv",
             "/api/public/schools/?search=%20Vidyalaya%20", "/api/public/schools/?search=zzzz",
             "/api/public/schools/delivered/", "/api/public/schools/logos/", "/api/public/states/"]
    grades = d("/api/public/grades/")
    schools = d("/api/public/schools/")
    for s in schools:
        paths += [f"/api/public/schools/{s['id']}/cities/", f"/api/public/states/?school={s['id']}"]
    states = d("/api/public/states/")
    cities = []
    for st in states:
        q = urllib.parse.quote(st["name"])
        paths += [f"/api/public/cities/?state={q}", f"/api/public/cities/?state={urllib.parse.quote(st['name'].lower())}"]
        for s in schools:
            paths.append(f"/api/public/cities/?state={q}&school={s['id']}")
        cities += d(f"/api/public/cities/?state={q}")
    # Django allows 120 catalogue requests a minute, so check branch lists for a spread of
    # cities (about 25, evenly spread) rather than all of them.
    step = max(1, len(cities) // 25)
    for c in cities[::step]:
        base = f"/api/public/cities/{c['id']}/branches/"
        paths.append(base)
        branches = d(base)
        if branches:
            word = (branches[0]["name"] or "").split(" ")[0]
            paths += [base + "?search=" + urllib.parse.quote(word), base + "?search=" + branches[0]["pincode"][:3]]
            paths.append(base + f"?school={branches[0]['school']['id']}")
    for s in schools:
        # Only the price changes with the city, so: no city, the first few cities, and every
        # city that has its own price for something (CITY_PRICE_CITIES, filled in main()).
        all_cities = [c["id"] for c in d(f"/api/public/schools/{s['id']}/cities/")]
        school_cities = [None] + all_cities[:4] + [c for c in all_cities[4:] if c in CITY_PRICE_CITIES]
        for city in school_cities:
            for g in grades:
                for gender in ("boy", "girl"):
                    q = {"school": s["id"], "class": g["name"], "gender": gender}
                    if city:
                        q["city"] = city
                    paths.append("/api/public/products/?" + urllib.parse.urlencode(q))
            q = {"school": s["id"], "grade": grades[3]["id"], "gender": "Male"}
            if city:
                q["city"] = city
            paths.append("/api/public/products/?" + urllib.parse.urlencode(q))
        q = {"school": s["id"], "class": "Class 5", "gender": "girl"}
        for extra in ({"category": "Uniform"}, {"category": "uniform-accessories"}, {"product_type": "SOCKS"},
                      {"product_type": "belt"}, {"product_type": "SHOES"}, {"page_size": "3"}, {"page_size": "0"},
                      {"class": "5"}, {"class": "std 5"}, {"class": "LKG"}, {"class": "Class 99"}):
            paths.append("/api/public/products/?" + urllib.parse.urlencode({**q, **extra}))
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["rpc", "site"])
    ap.add_argument("--django", required=True)
    ap.add_argument("--rpc")
    ap.add_argument("--secret-file")
    ap.add_argument("--site")
    ap.add_argument("--origin", default="https://school-store.aqualite.workers.dev")
    ap.add_argument("--city-price-cities", default="", help="comma-separated city ids that have city prices")
    a = ap.parse_args()
    secret = open(a.secret_file).read().strip() if a.secret_file else None
    CITY_PRICE_CITIES.update(filter(None, a.city_price_cities.split(",")))

    paths = requests_to_check(a.django)
    checked = skipped = 0
    failures = []
    served = {}
    for path in paths:
        parsed = urllib.parse.urlparse(path)
        d_status, d_body, _ = get(a.django + path)
        if a.mode == "rpc":
            got = via_rpc(a.rpc, secret, parsed.path, parsed.query, a.origin)
            if got is None:
                skipped += 1
                continue
            kind, s_status, s_body = got
            if kind == "error":
                if d_status == 200:
                    failures.append((path, "supabase error but django 200", s_status, s_body))
                else:
                    checked += 1   # Worker hands errors to Django, so Django answers them anyway
                continue
        else:
            s_status, s_body, headers = get(a.site + path)
            served[headers.get("x-served-by", "?")] = served.get(headers.get("x-served-by", "?"), 0) + 1
        if d_status != s_status:
            failures.append((path, "status", d_status, s_status))
            continue
        if isinstance(d_body, dict) and "next" in d_body and isinstance(s_body, dict):
            d_body = {**d_body, "next": link_path(d_body["next"]), "previous": None}
            s_body = {**s_body, "next": link_path(s_body["next"]), "previous": None}
        if not same(d_body, s_body):
            failures.append((path, "body differs", json.dumps(d_body)[:300], json.dumps(s_body)[:300]))
        else:
            checked += 1

    print(f"requests: {len(paths)}, matched: {checked}, handed to Django: {skipped}, different: {len(failures)}")
    if served:
        print("served by:", served)
    for f in failures[:20]:
        print("DIFF", *f, sep="\n  ")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
