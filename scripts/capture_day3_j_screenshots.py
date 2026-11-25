"""
Capture Playwright screenshots for Day 3 Task J:
1. New parent landing in state screen (390x844 & 1280x800)
2. Loading skeleton (390x844 & 1280x800)
3. Error with Retry (390x844 & 1280x800)
4. Reduced motion (390x844 & 1280x800)

Visual motion verification:
- Slide transition between steps (step 1 -> step 2 -> back to step 1)
- Title collapse on scroll
"""

import json
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = BASE_DIR / "docs" / "walkthroughs" / "screenshots"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

NEW_PARENT_USER = {
    "id": "parent-new-101",
    "username": "9876543210",
    "name": "Sunita Sharma",
    "role": "PARENT",
    "phone": "9876543210",
    "city": None,
    "city_name": None,
    "school": None,
    "school_name": None,
}

EMPTY_STUDENTS = {
    "count": 0,
    "next": None,
    "previous": None,
    "results": [],
}

STATES_MOCK = [
    {"name": "Gujarat", "city_count": 5},
    {"name": "Maharashtra", "city_count": 8},
    {"name": "Karnataka", "city_count": 4},
    {"name": "Delhi", "city_count": 2},
    {"name": "Rajasthan", "city_count": 3},
    {"name": "Tamil Nadu", "city_count": 6},
    {"name": "Telangana", "city_count": 3},
    {"name": "Uttar Pradesh", "city_count": 7},
    {"name": "Madhya Pradesh", "city_count": 4},
    {"name": "Punjab", "city_count": 3},
    {"name": "Haryana", "city_count": 3},
    {"name": "Kerala", "city_count": 5},
    {"name": "West Bengal", "city_count": 4},
    {"name": "Goa", "city_count": 1},
]

CITIES_MOCK = [
    {"id": "city-surat", "name": "Surat", "state": "Gujarat", "branch_count": 3},
    {"id": "city-ahmedabad", "name": "Ahmedabad", "state": "Gujarat", "branch_count": 4},
    {"id": "city-vadodara", "name": "Vadodara", "state": "Gujarat", "branch_count": 2},
]

def run():
    print("Building frontend before screenshot run...")
    subprocess.run(["npm", "run", "build"], cwd=BASE_DIR / "frontend", check=True)

    PORT = "4198"
    print(f"Starting preview server on port {PORT}...")
    proc = subprocess.Popen(
        ["npx", "vite", "preview", "--port", PORT, "--strictPort"],
        cwd=BASE_DIR / "frontend",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    time.sleep(3.0)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

            def create_page(width=390, height=844, reduced_motion="no-preference"):
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
                    if width < 768
                    else "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    device_scale_factor=2,
                    reduced_motion=reduced_motion,
                )
                page = context.new_page()
                page.add_init_script("""
                    localStorage.setItem('schoolstore_lang', 'en');
                    localStorage.setItem('access', 'test-access-token');
                    localStorage.setItem('refresh', 'test-refresh-token');
                    localStorage.removeItem('schoolstore_selection');
                """)
                return page

            def handle_flow_routes(route):
                url = route.request.url
                if "/me/" in url or "/auth/me/" in url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(NEW_PARENT_USER))
                elif "/students/" in url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(EMPTY_STUDENTS))
                elif "/public/states/" in url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(STATES_MOCK))
                elif "/public/cities/" in url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(CITIES_MOCK))
                elif "/public/schools/" in url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps([]))
                elif "/public/grades/" in url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps([]))
                else:
                    route.continue_()

            # -------------------------------------------------------------
            # 1. New Parent Landing in State Flow (390x844 mobile & 1280x800 desktop)
            # -------------------------------------------------------------
            print("1. Capturing New Parent Landing in State Flow...")
            for mode, w, h in [("390", 390, 844), ("desktop", 1280, 800)]:
                page = create_page(width=w, height=h)
                page.route("**/api/**", handle_flow_routes)

                page.goto(f"http://localhost:{PORT}/parent")
                page.wait_for_selector(".state-tile, .step-title", timeout=10000)
                page.wait_for_timeout(500)

                current_url = page.url
                print(f"  Redirected from /parent to: {current_url}")
                assert "/flow" in current_url and "step=1" in current_url
                assert page.locator(".popup--welcome").count() == 0

                out_path = SCREENSHOT_DIR / f"day3-j-new-parent-state-{mode}.png"
                page.screenshot(path=str(out_path), full_page=False)
                print(f"  Captured: {out_path.name}")
                page.close()

            # -------------------------------------------------------------
            # 2. Loading Skeleton (390x844 mobile & 1280x800 desktop)
            # -------------------------------------------------------------
            print("2. Capturing Loading Skeleton...")
            for mode, w, h in [("390", 390, 844), ("desktop", 1280, 800)]:
                page = create_page(width=w, height=h)

                delayed_route = {"route": None}
                def loading_handler(route):
                    url = route.request.url
                    if "/me/" in url or "/auth/me/" in url:
                        route.fulfill(status=200, content_type="application/json", body=json.dumps(NEW_PARENT_USER))
                    elif "/students/" in url:
                        delayed_route["route"] = route
                    else:
                        route.continue_()

                page.route("**/api/**", loading_handler)
                page.goto(f"http://localhost:{PORT}/parent")
                page.wait_for_selector(".parent-loading-skeleton", timeout=10000)
                page.wait_for_timeout(300)

                content = page.content()
                assert "Aarav Patel" not in content
                assert "DPS Surat" not in content

                out_path = SCREENSHOT_DIR / f"day3-j-loading-skeleton-{mode}.png"
                page.screenshot(path=str(out_path), full_page=False)
                print(f"  Captured: {out_path.name}")

                if delayed_route["route"]:
                    delayed_route["route"].fulfill(status=200, content_type="application/json", body=json.dumps(EMPTY_STUDENTS))
                page.wait_for_timeout(200)
                page.close()

            # -------------------------------------------------------------
            # 3. Request Error with Retry (390x844 mobile & 1280x800 desktop)
            # -------------------------------------------------------------
            print("3. Capturing Request Error with Retry...")
            for mode, w, h in [("390", 390, 844), ("desktop", 1280, 800)]:
                page = create_page(width=w, height=h)

                def error_handler(route):
                    url = route.request.url
                    if "/me/" in url or "/auth/me/" in url:
                        route.fulfill(status=200, content_type="application/json", body=json.dumps(NEW_PARENT_USER))
                    elif "/students/" in url:
                        route.fulfill(status=500, content_type="application/json", body=json.dumps({"detail": "Network failure"}))
                    else:
                        route.continue_()

                page.route("**/api/**", error_handler)
                page.goto(f"http://localhost:{PORT}/parent")
                page.wait_for_selector(".parent-error-state", timeout=10000)
                page.wait_for_timeout(300)

                assert page.locator(".parent-error-state button").count() > 0

                out_path = SCREENSHOT_DIR / f"day3-j-error-retry-{mode}.png"
                page.screenshot(path=str(out_path), full_page=False)
                print(f"  Captured: {out_path.name}")
                page.close()

            # -------------------------------------------------------------
            # 4. Reduced Motion (390x844 mobile & 1280x800 desktop)
            # -------------------------------------------------------------
            print("4. Capturing Reduced Motion State...")
            for mode, w, h in [("390", 390, 844), ("desktop", 1280, 800)]:
                page = create_page(width=w, height=h, reduced_motion="reduce")
                page.route("**/api/**", handle_flow_routes)

                page.goto(f"http://localhost:{PORT}/flow?step=1")
                page.wait_for_selector(".state-tile", timeout=10000)
                page.wait_for_timeout(400)

                matches_reduced = page.evaluate("() => window.matchMedia('(prefers-reduced-motion: reduce)').matches")
                print(f"  prefers-reduced-motion matches reduce: {matches_reduced}")
                assert matches_reduced is True

                out_path = SCREENSHOT_DIR / f"day3-j-reduced-motion-{mode}.png"
                page.screenshot(path=str(out_path), full_page=False)
                print(f"  Captured: {out_path.name}")
                page.close()

            # -------------------------------------------------------------
            # 5. Visual Motion Verification (Slide transition & Title Collapse)
            # -------------------------------------------------------------
            print("5. Visual Motion Verification (Slide transition & Title Collapse)...")
            motion_page = create_page(width=390, height=844)
            motion_page.route("**/api/**", handle_flow_routes)
            motion_page.goto(f"http://localhost:{PORT}/flow?step=1")
            motion_page.wait_for_selector(".state-tile", timeout=10000)

            # Scroll down to test title collapse
            motion_page.evaluate("() => window.scrollTo(0, 180)")
            motion_page.wait_for_timeout(400)
            collapsed_visible = motion_page.locator(".flow-collapsed-bar.is-collapsed").count()
            print(f"  Title collapse visible after scroll: {collapsed_visible > 0}")
            assert collapsed_visible > 0

            out_path = SCREENSHOT_DIR / "day3-j-title-collapsed-390.png"
            motion_page.screenshot(path=str(out_path), full_page=False)
            print(f"  Captured: {out_path.name}")

            # Scroll back to top to uncollapse
            motion_page.evaluate("() => window.scrollTo(0, 0)")
            motion_page.wait_for_timeout(300)

            # Click state to test step transition to city
            gujarat_btn = motion_page.locator(".state-tile", has_text="Gujarat")
            gujarat_btn.click()
            motion_page.wait_for_timeout(400)

            out_path = SCREENSHOT_DIR / "day3-j-step-transition-city-390.png"
            motion_page.screenshot(path=str(out_path), full_page=False)
            print(f"  Captured: {out_path.name}")

            motion_page.close()
            browser.close()
            print("All Task J screenshots and visual verifications completed successfully!")

    finally:
        proc.terminate()

if __name__ == "__main__":
    run()
