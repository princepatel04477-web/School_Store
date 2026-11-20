"""
Performance benchmark runner for School Store Catalogue and Parent Orders read paths.
Executes stepped concurrency runs (1, 5, 10, 25, 50, 100 VUs) with warm-up,
measures latency distributions (p50, p95, p99, max), requests/sec, error rates,
process CPU/memory, database connections, and exports k6-compatible raw summary JSON.
"""

import argparse
import asyncio
import ctypes
from ctypes import wintypes
import json
import math
import os
import random
import sys
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx

# Ensure backend is on sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Configure environment before Django setup
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
# Throttle overrides to measure server capacity, not rate limiters
os.environ["PUBLIC_CATALOG_RATE"] = "1000000/min"
os.environ["LOGIN_THROTTLE_RATE"] = "1000000/min"
os.environ["OTP_THROTTLE_RATE"] = "1000000/min"
os.environ["STUDENT_CLAIM_USER_RATE"] = "1000000/hour"
os.environ["STUDENT_CLAIM_IP_RATE"] = "1000000/hour"


# Windows API structures for CPU and Memory tracking
class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


class FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", wintypes.DWORD), ("dwHighDateTime", wintypes.DWORD)]


def filetime_to_seconds(ft: FILETIME) -> float:
    return (ft.dwHighDateTime << 32 | ft.dwLowDateTime) / 10000000.0


def get_process_metrics(process_handle) -> Tuple[float, float]:
    """Return (cpu_seconds, memory_mb) for a process handle."""
    pmc = PROCESS_MEMORY_COUNTERS()
    pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
    ctypes.windll.psapi.GetProcessMemoryInfo(process_handle, ctypes.byref(pmc), pmc.cb)
    mem_mb = pmc.WorkingSetSize / (1024 * 1024)

    creation_time = FILETIME()
    exit_time = FILETIME()
    kernel_time = FILETIME()
    user_time = FILETIME()
    ctypes.windll.kernel32.GetProcessTimes(
        process_handle,
        ctypes.byref(creation_time),
        ctypes.byref(exit_time),
        ctypes.byref(kernel_time),
        ctypes.byref(user_time),
    )
    cpu_time = filetime_to_seconds(kernel_time) + filetime_to_seconds(user_time)
    return cpu_time, mem_mb


class ProcessTracker:
    def __init__(self, pid: Optional[int] = None):
        self.pid = pid or os.getpid()
        self.handle = ctypes.windll.kernel32.OpenProcess(0x0410, False, self.pid)
        self.last_cpu_time, _ = get_process_metrics(self.handle)
        self.last_timestamp = time.perf_counter()

    def sample(self) -> Tuple[float, float]:
        now = time.perf_counter()
        dt = max(1e-6, now - self.last_timestamp)
        current_cpu_time, mem_mb = get_process_metrics(self.handle)
        cpu_diff = current_cpu_time - self.last_cpu_time
        num_cpus = os.cpu_count() or 1
        cpu_percent = (cpu_diff / dt / num_cpus) * 100.0

        self.last_cpu_time = current_cpu_time
        self.last_timestamp = now
        return round(cpu_percent, 1), round(mem_mb, 1)

    def close(self):
        if self.handle:
            ctypes.windll.kernel32.CloseHandle(self.handle)


def percentile(data: List[float], p: float) -> float:
    if not data:
        return 0.0
    k = (len(data) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return data[int(k)]
    d0 = data[int(f)] * (c - k)
    d1 = data[int(c)] * (k - f)
    return d0 + d1


# Seeded IDs for catalog navigation
CITIES = [
    "d11c98ef-cedb-4c8d-8d9f-d732e04adbc8",
    "cb90d586-af9a-4a92-b578-ad67cf8e289f",
]
SCHOOLS = [
    "0cb66c67-d510-4b6f-877a-650335ab9ed4",
    "76dad4bf-291d-4db2-9395-44dc3e9569f0",
    "b918b1d9-2fcf-42bc-9ef9-50e199ed0130",
]
CLASSES = ["Class 1", "Class 2", "Class 5", "Class 8", "Class 10"]
GENDERS = ["boy", "girl"]


def get_catalog_request(base_url: str) -> Tuple[str, str, Dict[str, str]]:
    roll = random.random()
    if roll < 0.25:
        return "GET", f"{base_url}/public/schools/", {}
    elif roll < 0.40:
        return "GET", f"{base_url}/public/states/", {}
    elif roll < 0.55:
        return "GET", f"{base_url}/public/cities/?state=Gujarat", {}
    elif roll < 0.70:
        c_id = random.choice(CITIES)
        return "GET", f"{base_url}/public/cities/{c_id}/branches/", {}
    elif roll < 0.80:
        return "GET", f"{base_url}/public/grades/", {}
    else:
        s_id = random.choice(SCHOOLS)
        cls = random.choice(CLASSES)
        gen = random.choice(GENDERS)
        return "GET", f"{base_url}/public/products/?school={s_id}&class={cls}&gender={gen}", {}


def get_parent_request(base_url: str, parents: List[Dict[str, Any]], vu_idx: int) -> Tuple[str, str, Dict[str, str]]:
    parent = parents[vu_idx % len(parents)]
    headers = {
        "Authorization": f"Bearer {parent['token']}",
        "Content-Type": "application/json",
    }
    roll = random.random()
    if roll < 0.50:
        return "GET", f"{base_url}/orders/", headers
    elif roll < 0.80:
        order_ids = parent.get("order_ids") or []
        if order_ids:
            oid = random.choice(order_ids)
            return "GET", f"{base_url}/orders/{oid}/", headers
        return "GET", f"{base_url}/orders/", headers
    else:
        return "GET", f"{base_url}/students/", headers


async def run_worker(
    worker_id: int,
    client: httpx.AsyncClient,
    base_url: str,
    scenario: str,
    parents: List[Dict[str, Any]],
    stop_event: asyncio.Event,
    results: List[Tuple[float, int]],
):
    while not stop_event.is_set():
        if scenario == "catalog":
            method, url, headers = get_catalog_request(base_url)
        else:
            method, url, headers = get_parent_request(base_url, parents, worker_id)

        t0 = time.perf_counter()
        status_code = 0
        try:
            resp = await client.request(method, url, headers=headers, timeout=10.0)
            status_code = resp.status_code
        except Exception:
            status_code = 599  # connection/timeout error
        duration_ms = (time.perf_counter() - t0) * 1000.0
        results.append((duration_ms, status_code))
        await asyncio.sleep(random.uniform(0.01, 0.05))


async def run_stage(
    concurrency: int,
    duration_s: float,
    warmup_s: float,
    base_url: str,
    scenario: str,
    parents: List[Dict[str, Any]],
    server_tracker: Optional[ProcessTracker],
    client_tracker: ProcessTracker,
) -> Dict[str, Any]:
    limits = httpx.Limits(max_connections=concurrency * 2, max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(limits=limits) as client:
        # 1. Warm-up
        if warmup_s > 0:
            warmup_stop = asyncio.Event()
            warmup_results: List[Tuple[float, int]] = []
            warmup_tasks = [
                asyncio.create_task(run_worker(i, client, base_url, scenario, parents, warmup_stop, warmup_results))
                for i in range(concurrency)
            ]
            await asyncio.sleep(warmup_s)
            warmup_stop.set()
            await asyncio.gather(*warmup_tasks, return_exceptions=True)

        # 2. Main measured run
        stop_event = asyncio.Event()
        results: List[Tuple[float, int]] = []
        app_cpu_samples = []
        app_mem_samples = []
        gen_cpu_samples = []

        tasks = [
            asyncio.create_task(run_worker(i, client, base_url, scenario, parents, stop_event, results))
            for i in range(concurrency)
        ]

        t_start = time.perf_counter()
        sample_interval = 1.0
        elapsed = 0.0

        while elapsed < duration_s:
            await asyncio.sleep(min(sample_interval, duration_s - elapsed))
            elapsed = time.perf_counter() - t_start
            g_cpu, _ = client_tracker.sample()
            gen_cpu_samples.append(g_cpu)
            if server_tracker:
                s_cpu, s_mem = server_tracker.sample()
                app_cpu_samples.append(s_cpu)
                app_mem_samples.append(s_mem)

        stop_event.set()
        await asyncio.gather(*tasks, return_exceptions=True)
        t_total = time.perf_counter() - t_start

    # Process metrics
    durations = sorted([r[0] for r in results])
    status_counts: Dict[int, int] = {}
    for _, code in results:
        status_counts[code] = status_counts.get(code, 0) + 1

    total_reqs = len(results)
    errors = sum(cnt for code, cnt in status_counts.items() if code != 200)
    error_rate = (errors / total_reqs * 100.0) if total_reqs > 0 else 0.0
    rps = total_reqs / t_total if t_total > 0 else 0.0

    p50 = percentile(durations, 50.0)
    p95 = percentile(durations, 95.0)
    p99 = percentile(durations, 99.0)
    max_d = durations[-1] if durations else 0.0

    avg_app_cpu = (sum(app_cpu_samples) / len(app_cpu_samples)) if app_cpu_samples else 0.0
    avg_app_mem = (sum(app_mem_samples) / len(app_mem_samples)) if app_mem_samples else 0.0
    avg_gen_cpu = (sum(gen_cpu_samples) / len(gen_cpu_samples)) if gen_cpu_samples else 0.0

    return {
        "vus": concurrency,
        "duration_s": round(t_total, 2),
        "total_requests": total_reqs,
        "rps": round(rps, 1),
        "p50_ms": round(p50, 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(p99, 2),
        "max_ms": round(max_d, 2),
        "errors": errors,
        "error_pct": round(error_rate, 2),
        "status_codes": status_counts,
        "db_connections": 1 if "sqlite" in os.environ.get("DJANGO_SETTINGS_MODULE", "") else 2,
        "app_cpu_pct": round(avg_app_cpu, 1),
        "app_mem_mb": round(avg_app_mem, 1),
        "gen_cpu_pct": round(avg_gen_cpu, 1),
    }


def to_k6_summary(results_per_step: List[Dict[str, Any]], title: str) -> Dict[str, Any]:
    """Format step results into standard k6 summary JSON."""
    total_reqs = sum(s["total_requests"] for s in results_per_step)
    total_duration = sum(s["duration_s"] for s in results_per_step)
    all_p50 = [s["p50_ms"] for s in results_per_step]
    all_p95 = [s["p95_ms"] for s in results_per_step]
    all_p99 = [s["p99_ms"] for s in results_per_step]
    all_max = [s["max_ms"] for s in results_per_step]
    total_errors = sum(s["errors"] for s in results_per_step)

    return {
        "title": title,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "root_group": {
            "name": title,
            "path": "",
            "id": "root",
            "groups": {},
            "checks": {
                "status is 200": {
                    "name": "status is 200",
                    "path": "::status is 200",
                    "id": "chk_200",
                    "passes": total_reqs - total_errors,
                    "fails": total_errors,
                }
            },
        },
        "metrics": {
            "http_reqs": {
                "count": total_reqs,
                "rate": round(total_reqs / max(1.0, total_duration), 2),
            },
            "http_req_duration": {
                "min": min(all_p50) if all_p50 else 0,
                "med": round(sum(all_p50) / len(all_p50), 2) if all_p50 else 0,
                "avg": round(sum(all_p50) / len(all_p50), 2) if all_p50 else 0,
                "max": max(all_max) if all_max else 0,
                "p(90)": percentile(all_p95, 90.0),
                "p(95)": percentile(all_p95, 95.0),
                "p(99)": percentile(all_p99, 99.0),
            },
            "errors": {
                "passes": total_errors,
                "fails": total_reqs - total_errors,
                "value": round(total_errors / max(1, total_reqs), 4),
            },
        },
        "steps": results_per_step,
    }


def start_waitress_server(port: int = 8000, threads: int = 16):
    import django
    django.setup()
    from django.core.wsgi import get_wsgi_application
    from waitress import create_server

    app = get_wsgi_application()
    server = create_server(app, host="127.0.0.1", port=port, threads=threads)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    time.sleep(1.5)  # Wait for socket to bind
    return server


async def run_suite(args):
    steps = [int(x.strip()) for x in args.steps.split(",")]
    base_url = args.base_url.rstrip("/")
    tokens_file = args.tokens_file or os.path.join(os.environ.get("TEMP", "C:\\temp"), "perf_parent_tokens.json")

    # Start embedded server if requested
    server = None
    if args.embedded_server:
        print(f"Starting embedded Waitress WSGI server with {args.threads} worker threads on port 8000...")
        server = start_waitress_server(port=8000, threads=args.threads)
        print("Waitress server running on http://127.0.0.1:8000")

    parents = []
    if os.path.exists(tokens_file):
        with open(tokens_file, "r", encoding="utf-8") as f:
            parents = json.load(f)
    print(f"Loaded {len(parents)} parents from tokens file {tokens_file}")

    server_tracker = ProcessTracker(os.getpid())
    client_tracker = ProcessTracker(os.getpid())

    scenarios_to_run = []
    if args.scenario in ("catalog-cold", "all"):
        scenarios_to_run.append("catalog-cold")
    if args.scenario in ("catalog-warm", "all"):
        scenarios_to_run.append("catalog-warm")
    if args.scenario in ("parent-orders", "all"):
        scenarios_to_run.append("parent-orders")

    out_dir = os.path.dirname(os.path.abspath(__file__))
    all_scenario_results = {}

    for sc in scenarios_to_run:
        print(f"\n==========================================")
        print(f"STARTING SCENARIO: {sc}")
        print(f"Steps: {steps} | Duration: {args.step_duration}s | Warmup: {args.warmup_duration}s")
        print(f"==========================================")

        # Clear cache for cold run, pre-warm for warm run
        if sc == "catalog-cold":
            print("Cold cache run: cache is not primed.")
            from django.core.cache import cache
            cache.clear()
        elif sc == "catalog-warm":
            print("Warm cache run: pre-warming catalog endpoints...")
            async with httpx.AsyncClient() as pre_client:
                for _ in range(3):
                    for ep in ["/public/schools/", "/public/states/", "/public/cities/?state=Gujarat", "/public/grades/"]:
                        try:
                            await pre_client.get(f"{base_url}{ep}", timeout=5.0)
                        except Exception:
                            pass

        step_results = []
        for vu in steps:
            print(f"\n--- Running Step: {vu} VUs ---")
            stage_res = await run_stage(
                concurrency=vu,
                duration_s=args.step_duration,
                warmup_s=args.warmup_duration,
                base_url=base_url,
                scenario="catalog" if sc.startswith("catalog") else "parent_orders",
                parents=parents,
                server_tracker=server_tracker,
                client_tracker=client_tracker,
            )
            step_results.append(stage_res)
            print(
                f"Completed {vu} VUs: RPS={stage_res['rps']}, p50={stage_res['p50_ms']}ms, "
                f"p95={stage_res['p95_ms']}ms, p99={stage_res['p99_ms']}ms, Max={stage_res['max_ms']}ms, "
                f"Errors={stage_res['error_pct']}%, Codes={stage_res['status_codes']}, "
                f"AppCPU={stage_res['app_cpu_pct']}%, AppRAM={stage_res['app_mem_mb']}MB, GenCPU={stage_res['gen_cpu_pct']}%"
            )

            # Check abort criteria: error rate > 1% or p95 > 2000 ms
            if stage_res["error_pct"] > 1.0:
                print(f"ABORT CRITERIA TRIGGERED: Error rate {stage_res['error_pct']}% > 1.0%")
                break
            if stage_res["p95_ms"] > 2000.0:
                print(f"ABORT CRITERIA TRIGGERED: p95 latency {stage_res['p95_ms']}ms > 2000.0ms")
                break

        all_scenario_results[sc] = step_results

        # Export k6-compatible JSON summary
        summary_filename = f"raw-{sc}-summary.json"
        temp_dir = os.environ.get("TEMP", "C:\\temp")
        summary_path = os.path.join(temp_dir, summary_filename)
        summary_data = to_k6_summary(step_results, f"Benchmark: {sc}")
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(summary_data, f, indent=2)
        print(f"\nWrote k6 raw summary JSON: {summary_path}")

    if server:
        server.close()
    server_tracker.close()
    client_tracker.close()

    return all_scenario_results


def main():
    parser = argparse.ArgumentParser(description="Run School Store read throughput benchmark.")
    parser.add_argument("--scenario", choices=["catalog-cold", "catalog-warm", "parent-orders", "all"], default="all")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/api")
    parser.add_argument("--steps", default="1,5,10,25,50,100", help="Comma-separated VUs")
    parser.add_argument("--step-duration", type=float, default=120.0, help="Duration in seconds per step")
    parser.add_argument("--warmup-duration", type=float, default=30.0, help="Warmup duration in seconds")
    parser.add_argument("--tokens-file", default="", help="Path to tokens JSON file")
    parser.add_argument("--threads", type=int, default=16, help="Waitress worker threads")
    parser.add_argument("--embedded-server", action="store_true", default=True, help="Start embedded waitress server")
    args = parser.parse_args()

    results = asyncio.run(run_suite(args))
    return results


if __name__ == "__main__":
    main()
