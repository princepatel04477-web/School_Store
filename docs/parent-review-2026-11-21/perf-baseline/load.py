"""
Stepped read-load generator for the School Store API. Runs in its OWN process
(the app server is a separate waitress process), so generator and server do not
share an interpreter.

  python load.py <scenario> <out.json>   scenario: catalog-cold | catalog-warm | parent

Each step: WARMUP s unmeasured, then STEP s measured. Stops early when the error
rate passes 1% or p95 passes 2 s. Records latency percentiles, status codes,
generator CPU, server CPU (waitress process), Postgres connections at mid-step.
"""
import asyncio, json, os, random, subprocess, sys, time

import httpx
import psycopg

BASE = "http://127.0.0.1:8010/api"
STEPS = [1, 5, 10, 25, 50, 100]
WARMUP = int(os.environ.get("WARMUP", "15"))
STEP = int(os.environ.get("STEP", "60"))
PG = "host=127.0.0.1 port=5544 user=postgres dbname=schoolstore_perf"
TOKENS = os.environ.get("TOKENS", "")
SERVER_PID = int(os.environ.get("SERVER_PID", "0"))


def server_cpu_seconds():
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", f"(Get-Process -Id {SERVER_PID}).TotalProcessorTime.TotalSeconds"],
        capture_output=True, text=True,
    ).stdout.strip()
    return float(out.replace(",", ".")) if out else float("nan")


def pg_connections():
    with psycopg.connect(PG) as c:
        return c.execute(
            "select count(*) from pg_stat_activity where datname='schoolstore_perf' and pid<>pg_backend_pid()"
        ).fetchone()[0]


async def catalog_targets(client):
    schools = (await client.get(f"{BASE}/public/schools/")).json()
    states = (await client.get(f"{BASE}/public/states/")).json()
    state = states[0]["name"]
    cities = (await client.get(f"{BASE}/public/cities/", params={"state": state})).json()
    grades = (await client.get(f"{BASE}/public/grades/")).json()
    grade_names = [g["name"] for g in grades] if grades and isinstance(grades[0], dict) else ["Class 5"]
    mix = []
    mix += [("schools", f"{BASE}/public/schools/", None)] * 25
    mix += [("states", f"{BASE}/public/states/", None)] * 15
    mix += [("cities", f"{BASE}/public/cities/", {"state": state})] * 15
    for c in cities:
        mix += [("branches", f"{BASE}/public/cities/{c['id']}/branches/", None)] * max(1, 15 // len(cities))
    mix += [("grades", f"{BASE}/public/grades/", None)] * 10
    for s in schools:
        for _ in range(max(1, 20 // len(schools))):
            mix.append(("products", f"{BASE}/public/products/",
                        {"school": s["id"], "class": random.choice(grade_names[3:] or grade_names),
                         "gender": random.choice(["boy", "girl"])}))
    return mix


def parent_targets():
    parents = json.load(open(TOKENS))
    return parents


async def worker(client, scenario, targets, stop, results):
    while not stop.is_set():
        if scenario == "parent":
            p = random.choice(targets)
            h = {"Authorization": f"Bearer {p['token']}"}
            r = random.random()
            if r < 0.5:
                name, url = "orders", f"{BASE}/orders/"
            elif r < 0.8 and p.get("order_ids"):
                name, url = "order_detail", f"{BASE}/orders/{random.choice(p['order_ids'])}/"
            else:
                name, url = "students", f"{BASE}/students/"
            params = None
        else:
            name, url, params = random.choice(targets)
            h = {}
        t0 = time.perf_counter()
        try:
            resp = await client.get(url, params=params, headers=h)
            code = resp.status_code
        except Exception as exc:  # timeouts, refused connections
            code = type(exc).__name__
        results.append((name, (time.perf_counter() - t0) * 1000, code))


def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    return round(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f), 1)


async def run_step(scenario, targets, vus):
    limits = httpx.Limits(max_connections=vus + 5, max_keepalive_connections=vus + 5)
    async with httpx.AsyncClient(timeout=30, limits=limits) as client:
        # warm-up (unmeasured)
        stop, junk = asyncio.Event(), []
        tasks = [asyncio.create_task(worker(client, scenario, targets, stop, junk)) for _ in range(vus)]
        await asyncio.sleep(WARMUP)
        stop.set(); await asyncio.gather(*tasks)
        # measured
        stop, results = asyncio.Event(), []
        cpu_s0, gen0, t0 = server_cpu_seconds(), time.process_time(), time.perf_counter()
        tasks = [asyncio.create_task(worker(client, scenario, targets, stop, results)) for _ in range(vus)]
        await asyncio.sleep(STEP / 2)
        conns = await asyncio.to_thread(pg_connections)
        await asyncio.sleep(STEP / 2)
        stop.set(); await asyncio.gather(*tasks)
        dt = time.perf_counter() - t0
        cpu_s1, gen1 = server_cpu_seconds(), time.process_time()
    lat = sorted(r[1] for r in results)
    codes = {}
    for _, _, c in results:
        codes[str(c)] = codes.get(str(c), 0) + 1
    errors = sum(v for k, v in codes.items() if not k.startswith("2"))
    ncpu = os.cpu_count()
    by_ep = {}
    for n, l, _ in results:
        by_ep.setdefault(n, []).append(l)
    return {
        "vus": vus, "seconds": round(dt, 1), "requests": len(results),
        "rps": round(len(results) / dt, 1),
        "p50": pct(lat, 50), "p95": pct(lat, 95), "p99": pct(lat, 99), "max": round(lat[-1], 1) if lat else None,
        "error_pct": round(100 * errors / max(1, len(results)), 2), "codes": codes,
        "pg_connections_mid_step": conns,
        "server_cpu_pct_of_machine": round(100 * (cpu_s1 - cpu_s0) / dt / ncpu, 1),
        "server_cpu_cores_used": round((cpu_s1 - cpu_s0) / dt, 2),
        "generator_cpu_cores_used": round((gen1 - gen0) / dt, 2),
        "p95_by_endpoint": {k: pct(sorted(v), 95) for k, v in by_ep.items()},
    }


async def main():
    scenario, out = sys.argv[1], sys.argv[2]
    if scenario.startswith("catalog"):
        async with httpx.AsyncClient(timeout=30) as c:
            targets = await catalog_targets(c)
        if scenario == "catalog-cold":
            subprocess.run([r"C:\SchoolStore\runtime\redis\redis-cli.exe", "-p", "6390", "FLUSHALL"], capture_output=True)
    else:
        targets = parent_targets()
    steps = []
    for vus in STEPS:
        if scenario == "catalog-cold":
            subprocess.run([r"C:\SchoolStore\runtime\redis\redis-cli.exe", "-p", "6390", "FLUSHALL"], capture_output=True)
        res = await run_step(scenario, targets, vus)
        steps.append(res)
        print(json.dumps(res), flush=True)
        if res["error_pct"] > 1 or (res["p95"] or 0) > 2000:
            print(f"stop: limit reached at {vus} VUs", flush=True)
            break
    json.dump({"scenario": scenario, "warmup_s": WARMUP, "step_s": STEP, "steps": steps}, open(out, "w"), indent=2)



async def one_step(scenario, vus, warmup, step, out):
    """Driver mode: one generator process, raw results to a file."""
    if scenario.startswith("catalog"):
        async with httpx.AsyncClient(timeout=30) as c:
            targets = await catalog_targets(c)
    else:
        targets = parent_targets()
    limits = httpx.Limits(max_connections=vus + 5, max_keepalive_connections=vus + 5)
    async with httpx.AsyncClient(timeout=30, limits=limits) as client:
        if warmup:
            stop, junk = asyncio.Event(), []
            tasks = [asyncio.create_task(worker(client, scenario, targets, stop, junk)) for _ in range(vus)]
            await asyncio.sleep(warmup)
            stop.set(); await asyncio.gather(*tasks)
        stop, results = asyncio.Event(), []
        g0, t0 = time.process_time(), time.perf_counter()
        tasks = [asyncio.create_task(worker(client, scenario, targets, stop, results)) for _ in range(vus)]
        await asyncio.sleep(step)
        stop.set(); await asyncio.gather(*tasks)
        dt, g1 = time.perf_counter() - t0, time.process_time()
    json.dump({"results": results, "gen_cpu_s": g1 - g0, "seconds": dt}, open(out, "w"))


if __name__ == "__main__":
    if sys.argv[1] == "step":
        _, _, sc, vus, w, st, out = sys.argv
        asyncio.run(one_step(sc, int(vus), int(w), int(st), out))
    else:
        asyncio.run(main())
