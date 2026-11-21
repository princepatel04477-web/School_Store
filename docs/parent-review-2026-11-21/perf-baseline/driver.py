"""
Multi-process driver: each concurrency step is spread over several generator
processes (load.py `step` mode), so one Python process's CPU no longer caps the
load. Merges raw latencies, then records server CPU, Postgres connections and
generator CPU per step.

  python driver.py <scenario> <out.json>
"""
import json, os, subprocess, sys, time, tempfile

sys.path.insert(0, os.path.dirname(__file__))
from load import server_cpu_seconds, pg_connections, pct  # noqa: E402

STEPS = [1, 5, 10, 25, 50, 100]
WARMUP = int(os.environ.get("WARMUP", "15"))
STEP = int(os.environ.get("STEP", "60"))
MAX_PROCS = int(os.environ.get("PROCS", "6"))
REDIS_CLI = r"C:\SchoolStore\runtime\redis\redis-cli.exe"
PY = sys.executable
HERE = os.path.dirname(os.path.abspath(__file__))


def run(scenario, out):
    steps = []
    for vus in STEPS:
        if scenario == "catalog-cold":
            subprocess.run([REDIS_CLI, "-p", "6390", "FLUSHALL"], capture_output=True)
        procs = min(vus, MAX_PROCS)
        share = [vus // procs + (1 if i < vus % procs else 0) for i in range(procs)]
        tmp = tempfile.mkdtemp()
        files = [os.path.join(tmp, f"p{i}.json") for i in range(procs)]
        children = [
            subprocess.Popen([PY, "-I", os.path.join(HERE, "load.py"), "step", scenario, str(n), str(WARMUP), str(STEP), f])
            for n, f in zip(share, files)
        ]
        time.sleep(WARMUP)
        cpu0, t0 = server_cpu_seconds(), time.perf_counter()
        time.sleep(STEP / 2)
        conns = pg_connections()
        for c in children:
            c.wait()
        dt = time.perf_counter() - t0
        cpu1 = server_cpu_seconds()
        results, gen_cpu, seconds = [], 0.0, []
        for f in files:
            d = json.load(open(f))
            results += d["results"]
            gen_cpu += d["gen_cpu_s"]
            seconds.append(d["seconds"])
        measured = max(seconds)
        lat = sorted(r[1] for r in results)
        codes = {}
        for _, _, c in results:
            codes[str(c)] = codes.get(str(c), 0) + 1
        errors = sum(v for k, v in codes.items() if not k.startswith("2"))
        by_ep = {}
        for n, l, _ in results:
            by_ep.setdefault(n, []).append(l)
        res = {
            "vus": vus, "generator_processes": procs, "seconds": round(measured, 1),
            "requests": len(results), "rps": round(len(results) / measured, 1),
            "p50": pct(lat, 50), "p95": pct(lat, 95), "p99": pct(lat, 99), "max": round(lat[-1], 1) if lat else None,
            "error_pct": round(100 * errors / max(1, len(results)), 2), "codes": codes,
            "pg_connections_mid_step": conns,
            "server_cpu_cores_used": round((cpu1 - cpu0) / dt, 2),
            "generator_cpu_cores_used_total": round(gen_cpu / measured, 2),
            "generator_cpu_cores_per_process_max": round(max(json.load(open(f))["gen_cpu_s"] for f in files) / measured, 2),
            "p95_by_endpoint": {k: pct(sorted(v), 95) for k, v in by_ep.items()},
        }
        steps.append(res)
        print(json.dumps(res), flush=True)
        if res["error_pct"] > 1 or (res["p95"] or 0) > 2000:
            print(f"stop: limit reached at {vus} VUs", flush=True)
            break
    json.dump({"scenario": scenario, "warmup_s": WARMUP, "step_s": STEP, "steps": steps}, open(out, "w"), indent=2)


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2])
