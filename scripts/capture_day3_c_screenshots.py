"""
Capture Playwright screenshots for Day 3 Task C:
1. To pack with a blocked row (desktop 1280x800 & mobile 390x844)
2. Claimed row (desktop & mobile)
3. Packing screen with a quantity above one (desktop & mobile)
4. Handover step with receipt review checkbox (desktop & mobile)
5. Sent with article correction modal (desktop & mobile)
6. School pickup row in To dispatch (desktop & mobile)
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
            "id": "ord-claimable",
            "order_number": "ORD-2026-0901",
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
            "claimed_by_name": None,
            "claimed_by_me": False,
            "claimed_at": None,
            "packed_by_name": None,
            "packed_at": None,
            "issue_note": None,
            "consignment_number": None,
            "dispatched_at": None,
        },
        {
            "id": "ord-claimed",
            "order_number": "ORD-2026-0902",
            "school_name": "DPS Pune",
            "school_code": "DPS-PNQ",
            "student_name": "Rohan Verma",
            "student_gr": "GR-3812",
            "fulfillment_type": "HOME_DELIVERY",
            "payment_status": "PAID",
            "payment_method": "RAZORPAY",
            "status": "CONFIRMED",
            "items_count": 4,
            "total": "3200.00",
            "created_at": "2026-11-20T10:45:00Z",
            "can_pack": True,
            "blocked_reason": None,
            "blocked_message": None,
            "claimed_by_name": "admin_pune",
            "claimed_by_me": True,
            "claimed_at": "2026-11-21T09:15:00Z",
            "packed_by_name": None,
            "packed_at": None,
            "issue_note": None,
            "consignment_number": None,
            "dispatched_at": None,
        },
        {
            "id": "ord-blocked",
            "order_number": "ORD-2026-0903",
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
            "claimed_by_name": None,
            "claimed_by_me": False,
            "claimed_at": None,
            "packed_by_name": None,
            "packed_at": None,
            "issue_note": None,
            "consignment_number": None,
            "dispatched_at": None,
        },
    ],
}

PACKING_LIST_MOCK = {
    "order_id": "ord-claimed",
    "order_number": "ORD-2026-0902",
    "items": [
        {
            "id": "item-1",
            "product_name": "DPS Boys White Polo Shirt",
            "sku": "DPS-POLO-WHT-32",
            "size": "32",
            "quantity": 3,
            "multiple": True,
            "personalisation": "Embroidery: Rohan V.",
        },
        {
            "id": "item-2",
            "product_name": "DPS Navy Blue Trousers",
            "sku": "DPS-TR-NVY-30",
            "size": "30",
            "quantity": 1,
            "multiple": False,
            "personalisation": None,
        },
    ],
}

ORDERS_TO_DISPATCH = {
    "next": None,
    "previous": None,
    "results": [
        {
            "id": "ord-hd-packed",
            "order_number": "ORD-2026-0885",
            "school_name": "DPS Pune",
            "school_code": "DPS-PNQ",
            "student_name": "Aarav Sharma",
            "student_gr": "GR-4091",
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
            "claimed_by_name": "admin_pune",
            "claimed_by_me": True,
            "claimed_at": "2026-11-21T08:15:00Z",
            "packed_by_name": "admin_pune",
            "packed_at": "2026-11-21T08:45:00Z",
            "issue_note": None,
            "consignment_number": None,
            "dispatched_at": None,
        },
        {
            "id": "ord-pickup-packed",
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
            "claimed_by_name": "admin_pune",
            "claimed_by_me": True,
            "claimed_at": "2026-11-21T08:20:00Z",
            "packed_by_name": "admin_pune",
            "packed_at": "2026-11-21T08:50:00Z",
            "issue_note": None,
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
            "id": "ord-dispatched-1",
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
            "claimed_by_name": "admin_pune",
            "claimed_by_me": True,
            "claimed_at": "2026-11-20T10:00:00Z",
            "packed_by_name": "admin_pune",
            "packed_at": "2026-11-20T10:30:00Z",
            "issue_note": None,
            "consignment_number": "CP123456789IN",
            "dispatched_at": "2026-11-21T09:30:00Z",
        },
        {
            "id": "ord-dispatched-pickup",
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
            "claimed_by_name": "admin_pune",
            "claimed_by_me": True,
            "claimed_at": "2026-11-20T11:00:00Z",
            "packed_by_name": "admin_pune",
            "packed_at": "2026-11-20T11:20:00Z",
            "issue_note": None,
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
                page.add_init_script(
                    """
                    localStorage.setItem('access', 'mock-jwt-token');
                    localStorage.setItem('refresh', 'mock-refresh-token');
                    """
                )

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
                    elif "/packing-list/" in url:
                        route.fulfill(
                            status=200,
                            content_type="application/json",
                            body=json.dumps(PACKING_LIST_MOCK),
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

            # 1. To pack with blocked row
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                page = setup_page(w, h)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".fulfilment-queue")
                page.wait_for_timeout(600)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"day3c-to-pack-blocked-{name}.png"),
                    full_page=False,
                )
                page.close()

            # 2. Claimed row (in To pack view, showing claimed by me and action button)
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                page = setup_page(w, h)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".fulfilment-queue")
                page.wait_for_timeout(600)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"day3c-claimed-row-{name}.png"),
                    full_page=False,
                )
                page.close()

            # 3. Packing screen modal with a quantity above one
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                container_sel = ".fulfilment-table" if name == "desktop" else ".fulfilment-cards"
                page = setup_page(w, h)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".fulfilment-queue")
                page.wait_for_timeout(500)
                # Click Pack order button on the claimed order
                page.locator(f'{container_sel} button:has-text("Pack order")').first.click()
                page.wait_for_selector('.modal-panel')
                page.wait_for_timeout(500)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"day3c-packing-modal-qty-{name}.png"),
                    full_page=False,
                )
                page.close()

            # 4. Handover step with receipt review checkbox (in To dispatch)
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                container_sel = ".fulfilment-table" if name == "desktop" else ".fulfilment-cards"
                page = setup_page(w, h)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".fulfilment-queue")
                page.click('button:has-text("To dispatch")')
                page.wait_for_timeout(500)
                # Fill input with placeholder "Article number"
                inp = page.locator(f'{container_sel} input[placeholder="Article number"]').first
                inp.fill("EE123456789IN")
                page.locator(f'{container_sel} button:has-text("Review")').first.click()
                page.wait_for_selector(f"{container_sel} .handover-review-box")
                page.wait_for_timeout(400)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"day3c-handover-modal-{name}.png"),
                    full_page=False,
                )
                page.close()

            # 5. Sent with article correction modal (in Sent tab)
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                container_sel = ".fulfilment-table" if name == "desktop" else ".fulfilment-cards"
                page = setup_page(w, h)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".fulfilment-queue")
                page.click('button:has-text("Sent")')
                page.wait_for_timeout(500)
                # Click Correct number
                page.locator(f'{container_sel} button:has-text("Correct number")').first.click()
                page.wait_for_selector(".modal-panel")
                page.locator('.modal-panel input[type="text"]').first.fill("CP987654321IN")
                page.locator('.modal-panel input[type="text"]').nth(1).fill("Fixed typo on booking receipt")
                page.wait_for_timeout(400)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"day3c-sent-correction-modal-{name}.png"),
                    full_page=False,
                )
                page.close()

            # 6. School pickup row in To dispatch (showing school pickup badge & Ready for pickup button)
            for w, h, name in [(1280, 800, "desktop"), (390, 844, "390")]:
                page = setup_page(w, h)
                page.goto("http://localhost:4173/city/packing")
                page.wait_for_selector(".fulfilment-queue")
                page.click('button:has-text("To dispatch")')
                page.wait_for_timeout(500)
                page.screenshot(
                    path=str(SCREENSHOT_DIR / f"day3c-pickup-to-dispatch-{name}.png"),
                    full_page=False,
                )
                page.close()

            browser.close()
            print("All Day 3 Task C screenshots captured successfully!")

    finally:
        proc.terminate()


if __name__ == "__main__":
    run()
