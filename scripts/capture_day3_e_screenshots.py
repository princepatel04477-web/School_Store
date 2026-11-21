"""
Capture Playwright screenshots for Day 3 Task E:
Parent order detail on mobile My Orders (390x844) in en, hi, gu.

Required screenshots:
1. placed
2. packed with its timestamp
3. dispatched with a long (40 char) article number
4. pickup ready
5. older dispatched order with no number
6. payment pending next to a packed order
7. COD due
8. error with Retry
9. skeleton

Layout validations at 390x844:
- No horizontal scroll
- Copy and Track buttons at least 44px high
- Nothing obscured under bottom gesture bar
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
        "payment_method": "ONLINE",
        "status": "PLACED",
        "total": "1200.00",
        "created_at": "2026-11-20T10:00:00Z",
        "items": [
            {
                "id": "it-1",
                "product_name": "Uniform Shirt",
                "size": "M",
                "quantity": 2,
                "unit_price_snapshot": "600.00",
                "customisation_display": {"student_name": {"value": "Aarav"}},
            }
        ],
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
        "payment_method": "ONLINE",
        "status": "PACKED",
        "total": "1800.00",
        "created_at": "2026-11-20T10:00:00Z",
        "items": [
            {
                "id": "it-2",
                "product_name": "Uniform Trousers",
                "size": "30",
                "quantity": 1,
                "unit_price_snapshot": "1800.00",
            }
        ],
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
    "dispatched_long": {
        "id": "ord-sent-long",
        "order_number": "ORD-2026-1003",
        "student_name": "Aarav Patel",
        "student_gr": "GR-1042",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "HOME_DELIVERY",
        "payment_status": "PAID",
        "payment_method": "ONLINE",
        "status": "DISPATCHED",
        "total": "2400.00",
        "created_at": "2026-11-20T10:00:00Z",
        "items": [
            {
                "id": "it-3",
                "product_name": "Complete Uniform Set",
                "size": "M",
                "quantity": 3,
                "unit_price_snapshot": "800.00",
                "customisation_display": {"house": {"value": "Tagore Red"}},
            }
        ],
        "tracking": {
            "carrier": "INDIA_POST",
            "consignment_number": "EM123456789012345678901234567890123456IN",  # 40 chars
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
    "pickup_ready": {
        "id": "ord-pickup-1",
        "order_number": "ORD-2026-1005",
        "student_name": "Diya Patel",
        "student_gr": "GR-1043",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "SCHOOL_PICKUP",
        "payment_status": "PAID",
        "payment_method": "ONLINE",
        "status": "DISPATCHED",
        "total": "1500.00",
        "created_at": "2026-11-20T10:00:00Z",
        "items": [
            {
                "id": "it-4",
                "product_name": "School Kit",
                "size": "Standard",
                "quantity": 1,
                "unit_price_snapshot": "1500.00",
            }
        ],
        "tracking": {
            "carrier": None,
            "consignment_number": None,
            "dispatched_at": "2026-11-21T10:00:00Z",
            "delivered_at": None,
            "steps": [
                {"key": "PLACED", "at": "2026-11-20T10:00:00Z"},
                {"key": "CONFIRMED", "at": "2026-11-20T10:30:00Z"},
                {"key": "PACKED", "at": "2026-11-20T15:00:00Z"},
                {"key": "DISPATCHED", "at": "2026-11-21T10:00:00Z"},
            ],
        },
    },
    "older_dispatched_no_number": {
        "id": "ord-old-no-num",
        "order_number": "ORD-2025-0988",
        "student_name": "Aarav Patel",
        "student_gr": "GR-1042",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "HOME_DELIVERY",
        "payment_status": "PAID",
        "payment_method": "ONLINE",
        "status": "DISPATCHED",
        "total": "750.00",
        "created_at": "2025-10-15T10:00:00Z",
        "items": [
            {
                "id": "it-5",
                "product_name": "Uniform Tie & Belt",
                "size": "Standard",
                "quantity": 1,
                "unit_price_snapshot": "750.00",
            }
        ],
        "tracking": {
            "carrier": None,
            "consignment_number": None,
            "dispatched_at": "2025-10-16T11:00:00Z",
            "delivered_at": None,
            "steps": [
                {"key": "PLACED", "at": "2025-10-15T10:00:00Z"},
                {"key": "DISPATCHED", "at": "2025-10-16T11:00:00Z"},
            ],
        },
    },
    "payment_pending_packed": {
        "id": "ord-pending-pack",
        "order_number": "ORD-2026-1006",
        "student_name": "Aarav Patel",
        "student_gr": "GR-1042",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "HOME_DELIVERY",
        "payment_status": "PENDING",
        "payment_method": "ONLINE",
        "status": "PACKED",
        "total": "1100.00",
        "created_at": "2026-11-20T10:00:00Z",
        "items": [
            {
                "id": "it-6",
                "product_name": "Uniform Pinafore",
                "size": "28",
                "quantity": 1,
                "unit_price_snapshot": "1100.00",
            }
        ],
        "tracking": {
            "carrier": None,
            "consignment_number": None,
            "dispatched_at": None,
            "delivered_at": None,
            "steps": [
                {"key": "PLACED", "at": "2026-11-20T10:00:00Z"},
                {"key": "CONFIRMED", "at": "2026-11-20T10:15:00Z"},
                {"key": "PACKED", "at": "2026-11-20T16:00:00Z"},
            ],
        },
    },
    "cod_due": {
        "id": "ord-cod-due",
        "order_number": "ORD-2026-1007",
        "student_name": "Aarav Patel",
        "student_gr": "GR-1042",
        "school_name": "DPS Surat",
        "school_code": "DPS-SUR",
        "city_name": "Surat",
        "fulfillment_type": "HOME_DELIVERY",
        "payment_status": "PENDING",
        "payment_method": "COD",
        "status": "PACKED",
        "total": "950.00",
        "created_at": "2026-11-20T10:00:00Z",
        "items": [
            {
                "id": "it-7",
                "product_name": "School Leather Shoes",
                "size": "7",
                "quantity": 1,
                "unit_price_snapshot": "950.00",
            }
        ],
        "tracking": {
            "carrier": None,
            "consignment_number": None,
            "dispatched_at": None,
            "delivered_at": None,
            "steps": [
                {"key": "PLACED", "at": "2026-11-20T10:00:00Z"},
                {"key": "PACKED", "at": "2026-11-20T16:30:00Z"},
            ],
        },
    },
}


def run():
    print("Building frontend before screenshot run...")
    subprocess.run(["npm", "run", "build"], cwd=BASE_DIR / "frontend", check=True)

    print("Starting preview server on port 4175...")
    proc = subprocess.Popen(
        ["npx", "vite", "preview", "--port", "4175", "--strictPort"],
        cwd=BASE_DIR / "frontend",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    time.sleep(2.5)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

            def setup_page(lang="en", width=390, height=844):
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
                    device_scale_factor=2,
                )
                page = context.new_page()
                page.add_init_script(f"""
                    localStorage.setItem('schoolstore_lang', '{lang}');
                    localStorage.setItem('access', 'test-access-token');
                    localStorage.setItem('refresh', 'test-refresh-token');
                """)
                return page

            # 1. Capture the 7 order data scenarios in en, hi, gu
            for scenario_key, order_data in SCENARIOS.items():
                for lang in ["en", "hi", "gu"]:
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
                                    body=json.dumps(data),
                                )
                            else:
                                route.continue_()
                        return route_handler

                    page.route("**/api/**", make_handler(order_data))
                    page.goto(f"http://localhost:4175/orders/{order_data['id']}")
                    page.wait_for_selector("[data-testid='order-detail-content']")
                    page.wait_for_timeout(400)

                    # Layout verification: No horizontal scroll
                    has_hscroll = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
                    if has_hscroll:
                        print(f"WARNING: Horizontal scroll detected in {scenario_key} ({lang})!")

                    # If dispatched_long, verify button heights >= 44px
                    if scenario_key == "dispatched_long":
                        copy_box = page.locator(".order-detail-copy-btn").bounding_box()
                        track_box = page.locator(".order-detail-track-link").bounding_box()
                        if copy_box and copy_box["height"] < 44:
                            print(f"WARNING: Copy button height {copy_box['height']} < 44px in {lang}!")
                        if track_box and track_box["height"] < 44:
                            print(f"WARNING: Track button height {track_box['height']} < 44px in {lang}!")

                    out_path = SCREENSHOT_DIR / f"order-detail-{scenario_key.replace('_', '-')}-390-{lang}.png"
                    page.screenshot(path=str(out_path), full_page=False)
                    print(f"Captured: {out_path.name}")
                    page.close()

            # 2. Skeleton loading state (en, hi, gu)
            for lang in ["en", "hi", "gu"]:
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
                page.goto("http://localhost:4175/orders/ord-loading")
                page.wait_for_selector("[data-testid='order-detail-skeleton']", timeout=10000)
                page.wait_for_timeout(300)
                out_path = SCREENSHOT_DIR / f"order-detail-skeleton-390-{lang}.png"
                page.screenshot(path=str(out_path), full_page=False)
                print(f"Captured: {out_path.name}")
                page.close()

            # 3. Error state with Retry button (en, hi, gu)
            for lang in ["en", "hi", "gu"]:
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
                page.goto("http://localhost:4175/orders/ord-error")
                page.wait_for_selector("[data-testid='order-detail-error']", timeout=15000)
                page.wait_for_timeout(300)
                out_path = SCREENSHOT_DIR / f"order-detail-error-retry-390-{lang}.png"
                page.screenshot(path=str(out_path), full_page=False)
                print(f"Captured: {out_path.name}")
                page.close()

            # 4. Desktop web storefront view of order detail (1280x800)
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
                        body=json.dumps(SCENARIOS["dispatched_long"]),
                    )
                else:
                    route.continue_()

            page.route("**/api/**", desktop_handler)
            page.goto("http://localhost:4175/parent/orders/ord-sent-long")
            page.wait_for_selector("[data-testid='order-detail-content']")
            page.wait_for_timeout(400)
            out_path = SCREENSHOT_DIR / "order-detail-storefront-desktop.png"
            page.screenshot(path=str(out_path), full_page=False)
            print(f"Captured: {out_path.name}")
            page.close()

            browser.close()
            print("All Task E screenshots captured successfully!")

    finally:
        proc.terminate()


if __name__ == "__main__":
    run()
