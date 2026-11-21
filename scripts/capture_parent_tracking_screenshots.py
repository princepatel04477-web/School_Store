"""
Capture Playwright screenshots for Day 3 Task B:
Parent order tracking (web My orders + app My Orders).

Screenshots to capture at 390x844 in en and gu:
1. placed
2. packed
3. sent by India Post with number
4. delivered
5. ready at school
6. cancelled
7. loading skeleton
8. error state

One desktop screenshot of web My orders (1280x800) to show the storefront is unchanged.
"""

import json
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = BASE_DIR / "docs" / "walkthroughs" / "screenshots"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

USER_MOCK = {
    "id": "parent-1",
    "username": "9876543210",
    "name": "Priya Patel",
    "role": "PARENT",
    "phone": "9876543210",
    "city": "city-1",
    "city_name": "Surat",
    "school": "school-1",
    "school_name": "DPS Surat",
}

STUDENTS_MOCK = {
    "count": 1,
    "next": None,
    "previous": None,
    "results": [
        {
            "id": "student-1",
            "name": "Aarav Patel",
            "gr_number": "GR-1042",
            "class_name": "5",
            "section": "A",
            "gender": "MALE",
            "school_name": "DPS Surat",
        }
    ],
}

SCENARIOS = {
    "placed": {
        "id": "ord-placed-1",
        "order_number": "ORD-2026-1001",
        "student_name": "Aarav Patel",
        "student_gr": "GR-1042",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "HOME_DELIVERY",
        "payment_status": "PAID",
        "status": "PLACED",
        "total": "1200.00",
        "created_at": "2026-11-20T10:00:00Z",
        "tracking": {
            "carrier": None,
            "consignment_number": None,
            "dispatched_at": None,
            "delivered_at": None,
            "steps": [
                {"key": "PLACED", "at": "2026-11-20T10:00:00Z"},
            ],
        },
    },
    "packed": {
        "id": "ord-packed-1",
        "order_number": "ORD-2026-1002",
        "student_name": "Aarav Patel",
        "student_gr": "GR-1042",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "HOME_DELIVERY",
        "payment_status": "PAID",
        "status": "PACKED",
        "total": "1800.00",
        "created_at": "2026-11-20T10:00:00Z",
        "tracking": {
            "carrier": None,
            "consignment_number": None,
            "dispatched_at": None,
            "delivered_at": None,
            "steps": [
                {"key": "PLACED", "at": "2026-11-20T10:00:00Z"},
                {"key": "CONFIRMED", "at": "2026-11-20T10:15:00Z"},
                {"key": "PACKED", "at": "2026-11-20T14:30:00Z"},
            ],
        },
    },
    "sent": {
        "id": "ord-sent-1",
        "order_number": "ORD-2026-1003",
        "student_name": "Aarav Patel",
        "student_gr": "GR-1042",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "HOME_DELIVERY",
        "payment_status": "PAID",
        "status": "DISPATCHED",
        "total": "2400.00",
        "created_at": "2026-11-20T10:00:00Z",
        "tracking": {
            "carrier": "INDIA_POST",
            "consignment_number": "EM123456789IN",
            "dispatched_at": "2026-11-21T09:00:00Z",
            "delivered_at": None,
            "steps": [
                {"key": "PLACED", "at": "2026-11-20T10:00:00Z"},
                {"key": "CONFIRMED", "at": "2026-11-20T10:15:00Z"},
                {"key": "PACKED", "at": "2026-11-20T14:30:00Z"},
                {"key": "DISPATCHED", "at": "2026-11-21T09:00:00Z"},
            ],
        },
    },
    "delivered": {
        "id": "ord-delivered-1",
        "order_number": "ORD-2026-1004",
        "student_name": "Aarav Patel",
        "student_gr": "GR-1042",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "HOME_DELIVERY",
        "payment_status": "PAID",
        "status": "DELIVERED",
        "total": "2400.00",
        "created_at": "2026-11-18T10:00:00Z",
        "tracking": {
            "carrier": "INDIA_POST",
            "consignment_number": "EM123456789IN",
            "dispatched_at": "2026-11-19T09:00:00Z",
            "delivered_at": "2026-11-21T11:30:00Z",
            "steps": [
                {"key": "PLACED", "at": "2026-11-18T10:00:00Z"},
                {"key": "CONFIRMED", "at": "2026-11-18T10:15:00Z"},
                {"key": "PACKED", "at": "2026-11-18T14:30:00Z"},
                {"key": "DISPATCHED", "at": "2026-11-19T09:00:00Z"},
                {"key": "DELIVERED", "at": "2026-11-21T11:30:00Z"},
            ],
        },
    },
    "ready_school": {
        "id": "ord-ready-1",
        "order_number": "ORD-2026-1005",
        "student_name": "Diya Patel",
        "student_gr": "GR-1043",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "SCHOOL_PICKUP",
        "payment_status": "PAID",
        "status": "DISPATCHED",
        "total": "1500.00",
        "created_at": "2026-11-20T10:00:00Z",
        "tracking": {
            "carrier": None,
            "consignment_number": None,
            "dispatched_at": "2026-11-21T10:00:00Z",
            "delivered_at": None,
            "steps": [
                {"key": "PLACED", "at": "2026-11-20T10:00:00Z"},
                {"key": "CONFIRMED", "at": "2026-11-20T10:15:00Z"},
                {"key": "PACKED", "at": "2026-11-20T14:30:00Z"},
                {"key": "DISPATCHED", "at": "2026-11-21T10:00:00Z"},
            ],
        },
    },
    "cancelled": {
        "id": "ord-cancelled-1",
        "order_number": "ORD-2026-1006",
        "student_name": "Aarav Patel",
        "student_gr": "GR-1042",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "HOME_DELIVERY",
        "payment_status": "FAILED",
        "status": "CANCELLED",
        "total": "900.00",
        "created_at": "2026-11-20T10:00:00Z",
        "tracking": {
            "carrier": None,
            "consignment_number": None,
            "dispatched_at": None,
            "delivered_at": None,
            "steps": [
                {"key": "PLACED", "at": "2026-11-20T10:00:00Z"},
                {"key": "CANCELLED", "at": "2026-11-20T10:15:00Z"},
            ],
        },
    },
}


def run():
    print("Starting vite preview server...")
    proc = subprocess.Popen(
        ["npx", "vite", "preview", "--port", "4174"],
        cwd=str(BASE_DIR / "frontend"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    time.sleep(2)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            def setup_page(lang="en", width=390, height=844):
                page = browser.new_page(viewport={"width": width, "height": height})
                page.add_init_script(
                    f"""
                    localStorage.setItem('access', 'mock-jwt-token');
                    localStorage.setItem('refresh', 'mock-refresh-token');
                    localStorage.setItem('schoolstore_lang', '{lang}');
                    """
                )
                return page

            # 1. Capture standard order scenarios (placed, packed, sent, delivered, ready_school, cancelled)
            for scenario_key, order_data in SCENARIOS.items():
                for lang in ["en", "gu"]:
                    page = setup_page(lang=lang, width=390, height=844)

                    def make_handler(data):
                        def route_handler(route):
                            url = route.request.url
                            if "/me/" in url or "/auth/me/" in url:
                                route.fulfill(
                                    status=200,
                                    content_type="application/json",
                                    body=json.dumps(USER_MOCK),
                                )
                            elif "/students/" in url:
                                route.fulfill(
                                    status=200,
                                    content_type="application/json",
                                    body=json.dumps(STUDENTS_MOCK),
                                )
                            elif "/orders/" in url:
                                route.fulfill(
                                    status=200,
                                    content_type="application/json",
                                    body=json.dumps({"count": 1, "next": None, "previous": None, "results": [data]}),
                                )
                            else:
                                route.continue_()
                        return route_handler

                    page.route("**/api/**", make_handler(order_data))
                    page.goto("http://localhost:4174/orders")
                    page.wait_for_selector(".order-card, .native-order-card")
                    page.wait_for_timeout(400)
                    out_path = SCREENSHOT_DIR / f"parent-tracking-{scenario_key.replace('_', '-')}-390-{lang}.png"
                    page.screenshot(path=str(out_path), full_page=False)
                    print(f"Captured: {out_path.name}")
                    page.close()

            # 2. Loading skeleton (en & gu)
            for lang in ["en", "gu"]:
                page = setup_page(lang=lang, width=390, height=844)

                def loading_handler(route):
                    url = route.request.url
                    if "/me/" in url or "/auth/me/" in url:
                        route.fulfill(status=200, content_type="application/json", body=json.dumps(USER_MOCK))
                    elif "/orders/" in url:
                        # Keep pending so loading skeleton stays on screen
                        pass
                    else:
                        route.continue_()

                page.route("**/api/**", loading_handler)
                page.goto("http://localhost:4174/orders")
                page.wait_for_selector(".orders-skeleton-list", timeout=10000)
                page.wait_for_timeout(300)
                out_path = SCREENSHOT_DIR / f"parent-tracking-skeleton-390-{lang}.png"
                page.screenshot(path=str(out_path), full_page=False)
                print(f"Captured: {out_path.name}")
                page.close()

            # 3. Error state (en & gu)
            for lang in ["en", "gu"]:
                page = setup_page(lang=lang, width=390, height=844)

                def error_handler(route):
                    url = route.request.url
                    if "/me/" in url or "/auth/me/" in url:
                        route.fulfill(status=200, content_type="application/json", body=json.dumps(USER_MOCK))
                    elif "/orders/" in url:
                        route.fulfill(status=500, content_type="application/json", body=json.dumps({"detail": "Server error"}))
                    else:
                        route.continue_()

                page.route("**/api/**", error_handler)
                page.goto("http://localhost:4174/orders")
                page.wait_for_selector(".native-error-state, .orders-error-state", timeout=15000)
                page.wait_for_timeout(300)
                out_path = SCREENSHOT_DIR / f"parent-tracking-error-390-{lang}.png"
                page.screenshot(path=str(out_path), full_page=False)
                print(f"Captured: {out_path.name}")
                page.close()

            # 4. Desktop web My orders (1280x800) showing storefront unchanged
            page = setup_page(lang="en", width=1280, height=800)

            def desktop_handler(route):
                url = route.request.url
                if "/me/" in url or "/auth/me/" in url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(USER_MOCK))
                elif "/students/" in url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(STUDENTS_MOCK))
                elif "/orders/" in url:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps({
                            "count": 2,
                            "next": None,
                            "previous": None,
                            "results": [SCENARIOS["sent"], SCENARIOS["ready_school"]],
                        }),
                    )
                else:
                    route.continue_()

            page.route("**/api/**", desktop_handler)
            page.goto("http://localhost:4174/parent/orders")
            page.wait_for_selector(".order-card")
            page.wait_for_timeout(400)
            out_path = SCREENSHOT_DIR / "parent-orders-storefront-desktop.png"
            page.screenshot(path=str(out_path), full_page=False)
            print(f"Captured: {out_path.name}")
            page.close()

            browser.close()
            print("All screenshots captured successfully!")

    finally:
        proc.terminate()


if __name__ == "__main__":
    run()
