"""
Capture Playwright screenshots of FulfilmentQueue in desktop (1280x800) and mobile (390x844).
Scenarios:
1. To pack with one blocked row
2. The 503 notice
3. To dispatch with a consignment entered
4. Sent
"""

import json
import os
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = BASE_DIR / "docs" / "walkthroughs" / "screenshots"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

USER_MOCK = {
    "id": "admin-1",
    "username": "admin_pune",
    "role": "ADMIN",
    "city_id": "city-1",
    "city_name": "Pune",
}

SCHOOLS_MOCK = {
    "next": None,
    "previous": None,
    "results": [
        {"id": "school-1", "name": "DPS Pune", "code": "DPS-PNQ"},
    ],
}

ORDERS_TO_PACK = {
    "next": None,
    "previous": None,
    "results": [
        {
            "id": "ord-1",
            "order_number": "ORD-2026-0891",
            "school_name": "DPS Pune",
            "school_code": "DPS-PNQ",
            "student_name": "Aarav Sharma",
            "student_gr": "GR-4091",
            "fulfillment_type": "HOME_DELIVERY",
            "payment_status": "PAID",
            "payment_method": "RAZORPAY",
            "status": "CONFIRMED",
            "items_count": 3,
            "total": "2400.00",
            "created_at": "2026-11-20T10:30:00Z",
            "can_pack": True,
            "blocked_reason": None,
            "blocked_message": None,
            "consignment_number": None,
            "dispatched_at": None,
        },
        {
            "id": "ord-2",
            "order_number": "ORD-2026-0892",
            "school_name": "DPS Pune",
            "school_code": "DPS-PNQ",
            "student_name": "Diya Patel",
            "student_gr": "GR-5120",
            "fulfillment_type": "HOME_DELIVERY",
            "payment_status": "PENDING",
            "payment_method": "RAZORPAY",
            "status": "CONFIRMED",
            "items_count": 2,
            "total": "1800.00",
            "created_at": "2026-11-20T11:15:00Z",
            "can_pack": False,
            "blocked_reason": "PAYMENT_NOT_VERIFIED",
            "blocked_message": "Payment not verified yet by webhook or gateway signature.",
            "consignment_number": None,
            "dispatched_at": None,
        },
    ],
}

ORDERS_TO_DISPATCH = {
    "next": None,
    "previous": None,
    "results": [
        {
            "id": "ord-3",
            "order_number": "ORD-2026-0885",
            "school_name": "DPS Pune",
            "school_code": "DPS-PNQ",
            "student_name": "Rohan Verma",
            "student_gr": "GR-3812",
            "fulfillment_type": "HOME_DELIVERY",
            "payment_status": "PAID",
            "payment_method": "RAZORPAY",
            "status": "PACKED",
            "items_count": 2,
            "total": "1650.00",
            "created_at": "2026-11-20T08:00:00Z",
            "can_pack": None,
            "blocked_reason": None,
            "blocked_message": None,
            "consignment_number": None,
            "dispatched_at": None,
        },
        {
            "id": "ord-4",
            "order_number": "ORD-2026-0886",
            "school_name": "DPS Pune",
            "school_code": "DPS-PNQ",
            "student_name": "Ananya Joshi",
            "student_gr": "GR-2904",
            "fulfillment_type": "SCHOOL_PICKUP",
            "payment_status": "PAID",
            "payment_method": "RAZORPAY",
            "status": "PACKED",
            "items_count": 1,
            "total": "800.00",
            "created_at": "2026-11-20T08:30:00Z",
            "can_pack": None,
            "blocked_reason": None,
            "blocked_message": None,
            "consignment_number": None,
            "dispatched_at": None,
        },
    ],
}

ORDERS_DISPATCHED = {
    "next": None,
    "previous": None,
    "results": [
        {
            "id": "ord-5",
            "order_number": "ORD-2026-0870",
            "school_name": "DPS Pune",
            "school_code": "DPS-PNQ",
            "student_name": "Kabir Mehta",
            "student_gr": "GR-4190",
            "fulfillment_type": "HOME_DELIVERY",
            "payment_status": "PAID",
            "payment_method": "RAZORPAY",
            "status": "DISPATCHED",
            "items_count": 3,
            "total": "2800.00",
            "created_at": "2026-11-19T14:00:00Z",
            "can_pack": None,
            "blocked_reason": None,
            "blocked_message": None,
            "consignment_number": "EE123456785IN",
            "dispatched_at": "2026-11-21T09:30:00Z",
        },
        {
            "id": "ord-6",
            "order_number": "ORD-2026-0871",
            "school_name": "DPS Pune",
            "school_code": "DPS-PNQ",
            "student_name": "Pooja Shah",
            "student_gr": "GR-1876",
            "fulfillment_type": "SCHOOL_PICKUP",
            "payment_status": "PAID",
            "payment_method": "RAZORPAY",
            "status": "DISPATCHED",
            "items_count": 1,
            "total": "750.00",
            "created_at": "2026-11-19T15:20:00Z",
            "can_pack": None,
            "blocked_reason": None,
            "blocked_message": None,
            "consignment_number": None,
            "dispatched_at": "2026-11-21T10:00:00Z",
        },
    ],
}


def run():
    # Start vite preview server
    proc = subprocess.Popen(
        ["npx", "vite", "preview", "--port", "4173"],
        cwd=str(BASE_DIR / "frontend"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    time.sleep(2)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            def setup_page(context_width, context_height):
                page = browser.new_page(
                    viewport={"width": context_width, "height": context_height}
                )

                # Set localStorage
                page.add_init_script(
                    """
                    localStorage.setItem('access', 'mock-jwt-token');
                    localStorage.setItem('refresh', 'mock-refresh-token');
                    """
                )

                # Route intercepts
                def route_handler(route):
                    url = route.request.url
                    if "/accounts/users/me/" in url or "/auth/me/" in url or "/users/me/" in url:
                        route.fulfill(
                            status=200,
                            content_type="application/json",
                            body=json.dumps(USER_MOCK),
                        )
                    elif "/schools/" in url:
                        route.fulfill(
                            status=200,
                            content_type="application/json",
                            body=json.dumps(SCHOOLS_MOCK),
                        )
                    elif "/fulfilment/queue/" in url:
                        if "stage=to_dispatch" in url:
                            route.fulfill(
                                status=200,
                                content_type="application/json",
                                body=json.dumps(ORDERS_TO_DISPATCH),
                            )
                        elif "stage=dispatched" in url:
                            route.fulfill(
                                status=200,
                                content_type="application/json",
                                body=json.dumps(ORDERS_DISPATCHED),
                            )
                        else:
                            route.fulfill(
                                status=200,
                                content_type="application/json",
                                body=json.dumps(ORDERS_TO_PACK),
                            )
                    elif "/panel/city-daily-sales/" in url:
                        route.fulfill(
                            status=200,
                            content_type="application/json",
                            body=json.dumps({"city": {"name": "Pune"}, "total_sales": "0"}),
                        )
                    else:
                        route.continue_()

                page.route("**/api/**", route_handler)
                return page

            # --- 1. Scenario 1: To pack with one blocked row ---
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                page = setup_page(w, h)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".fulfilment-queue")
                page.wait_for_timeout(500)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"to-pack-blocked-{name}.png"),
                    full_page=False,
                )
                page.close()

            # --- 2. Scenario 2: 503 notice ---
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                page = browser.new_page(viewport={"width": w, "height": h})
                page.add_init_script("localStorage.setItem('access', 'mock-token');")

                def route_503(route):
                    url = route.request.url
                    if "/me/" in url:
                        route.fulfill(status=200, content_type="application/json", body=json.dumps(USER_MOCK))
                    elif "/schools/" in url:
                        route.fulfill(status=200, content_type="application/json", body=json.dumps(SCHOOLS_MOCK))
                    elif "/fulfilment/queue/" in url:
                        route.fulfill(
                            status=503,
                            content_type="application/json",
                            body=json.dumps({
                                "code": "PACKING_RULE_NOT_WIRED",
                                "detail": "Packing is not available yet. Payment checks are not connected.",
                            }),
                        )
                    else:
                        route.continue_()

                page.route("**/api/**", route_503)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".notice")
                page.wait_for_timeout(500)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"503-notice-{name}.png"),
                    full_page=False,
                )
                page.close()

            # --- 3. Scenario 3: To dispatch with a consignment entered ---
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                page = setup_page(w, h)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".fulfilment-queue")
                page.click('button:has-text("To dispatch")')
                if name == "desktop":
                    target = page.locator(".fulfilment-table .consignment-input").first
                else:
                    target = page.locator(".fulfilment-cards .consignment-input").first
                target.wait_for(state="visible")
                target.fill("EE123456785IN")
                page.wait_for_timeout(500)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"to-dispatch-consignment-{name}.png"),
                    full_page=False,
                )
                page.close()

            # --- 4. Scenario 4: Sent ---
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                page = setup_page(w, h)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".fulfilment-queue")
                page.click('button:has-text("Sent")')
                if name == "desktop":
                    target = page.locator(".fulfilment-table .deliver-btn").first
                else:
                    target = page.locator(".fulfilment-cards .touch-btn").first
                target.wait_for(state="visible")
                page.wait_for_timeout(500)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"sent-{name}.png"),
                    full_page=False,
                )
                page.close()

            browser.close()
            print("All 8 screenshots captured successfully!")

    finally:
        proc.terminate()


if __name__ == "__main__":
    run()
