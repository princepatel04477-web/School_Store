"""Generate Google Play Store feature graphic and marketing screenshots."""

import os
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "play-store")
SCREENSHOTS_DIR = os.path.join(OUTPUT_DIR, "screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

BRAND_EMERALD = (47, 93, 80)       # #2F5D50
BRAND_DARK = (30, 60, 50)          # #1E3C32
BRAND_LIGHT_BG = (248, 249, 250)   # #F8F9FA
ACCENT_GREEN = (72, 187, 120)      # #48BB78
CARD_BG = (255, 255, 255)
TEXT_DARK = (30, 41, 59)
TEXT_MUTED = (100, 116, 139)
WHITE = (255, 255, 255)

def draw_s_logo(draw, cx, cy, size, color=WHITE):
    """Draw a stylized white 'S' emblem on the canvas."""
    half = size / 2
    # Simple clean stylized 'S' polyline or segments
    w = size * 0.18
    # Top bar
    draw.rectangle([cx - half * 0.7, cy - half, cx + half * 0.7, cy - half + w], fill=color)
    # Top left vertical
    draw.rectangle([cx - half * 0.7, cy - half, cx - half * 0.7 + w, cy - half * 0.1], fill=color)
    # Middle bar
    draw.rectangle([cx - half * 0.7, cy - half * 0.15, cx + half * 0.7, cy + half * 0.15], fill=color)
    # Bottom right vertical
    draw.rectangle([cx + half * 0.7 - w, cy + half * 0.1, cx + half * 0.7, cy + half], fill=color)
    # Bottom bar
    draw.rectangle([cx - half * 0.7, cy + half - w, cx + half * 0.7, cy + half], fill=color)


def generate_feature_graphic():
    img = Image.new("RGBA", (1024, 500), BRAND_EMERALD)
    draw = ImageDraw.Draw(img)

    # Decorative background circles
    draw.ellipse([800, -100, 1200, 300], fill=(58, 114, 98))
    draw.ellipse([-100, 300, 300, 700], fill=(38, 76, 65))

    # Center Logo Crest
    crest_x, crest_y = 220, 250
    draw.ellipse([crest_x - 90, crest_y - 90, crest_x + 90, crest_y + 90], fill=(35, 70, 60))
    draw_s_logo(draw, crest_x, crest_y, 90, WHITE)

    # Titles (using default font if custom font not available)
    try:
        font_title = ImageFont.truetype("arialbd.ttf", 52)
        font_sub = ImageFont.truetype("arial.ttf", 26)
        font_tag = ImageFont.truetype("arialbd.ttf", 20)
    except Exception:
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        font_tag = ImageFont.load_default()

    draw.text((360, 170), "Colorbenz School Store", font=font_title, fill=WHITE)
    draw.text((365, 240), "Smart School Uniforms & Instant AI Sizing", font=font_sub, fill=(210, 235, 225))
    
    # Feature pill badges
    pills = ["⚡ Perfect Fit in Seconds", "🏫 Official School Uniforms", "🔒 100% On-Device Privacy"]
    px = 365
    for pill in pills:
        draw.rectangle([px, 300, px + 185, 335], fill=(35, 70, 60), outline=(80, 150, 130), width=1)
        draw.text((px + 10, 308), pill, font=font_tag, fill=WHITE)
        px += 195

    out_path = os.path.join(OUTPUT_DIR, "feature-graphic.png")
    img.save(out_path, "PNG")
    print(f"Saved feature graphic: {out_path}")


def generate_mock_screenshot(filename, title, subtitle, content_fn):
    width, height = 1080, 1920
    img = Image.new("RGBA", (width, height), BRAND_LIGHT_BG)
    draw = ImageDraw.Draw(img)

    try:
        font_banner_title = ImageFont.truetype("arialbd.ttf", 52)
        font_banner_sub = ImageFont.truetype("arial.ttf", 30)
        font_phone_header = ImageFont.truetype("arialbd.ttf", 36)
        font_body = ImageFont.truetype("arial.ttf", 28)
        font_body_bold = ImageFont.truetype("arialbd.ttf", 30)
    except Exception:
        font_banner_title = font_banner_sub = font_phone_header = font_body = font_body_bold = ImageFont.load_default()

    # Top header marketing banner
    draw.rectangle([0, 0, width, 320], fill=BRAND_EMERALD)
    draw.text((60, 90), title, font=font_banner_title, fill=WHITE)
    draw.text((60, 175), subtitle, font=font_banner_sub, fill=(210, 235, 225))

    # Phone mockup container
    phone_x, phone_y = 120, 370
    phone_w, phone_h = 840, 1480
    draw.rectangle([phone_x, phone_y, phone_x + phone_w, phone_y + phone_h], fill=CARD_BG, outline=(200, 205, 210), width=4)

    # Phone status bar
    draw.rectangle([phone_x, phone_y, phone_x + phone_w, phone_y + 60], fill=(240, 243, 245))
    draw.text((phone_x + 30, phone_y + 18), "9:41", font=font_body_bold, fill=TEXT_DARK)
    draw.text((phone_x + phone_w - 140, phone_y + 18), "100% 🔋", font=font_body, fill=TEXT_DARK)

    # Content inside phone screen
    content_fn(draw, phone_x, phone_y + 60, phone_w, phone_h - 60, font_phone_header, font_body, font_body_bold)

    out_path = os.path.join(SCREENSHOTS_DIR, filename)
    img.save(out_path, "PNG")
    print(f"Saved screenshot: {out_path}")


def draw_content_home(draw, px, py, pw, ph, f_h, f_b, f_bold):
    draw.text((px + 40, py + 40), "Delhi Public School", font=f_h, fill=BRAND_EMERALD)
    draw.text((px + 40, py + 90), "Class 4 • Gandhi House", font=f_b, fill=TEXT_MUTED)

    # Uniform Card 1
    cy = py + 160
    draw.rectangle([px + 40, cy, px + pw - 40, cy + 300], fill=(245, 247, 250), outline=(220, 225, 230), width=2)
    draw.rectangle([px + 60, cy + 20, px + 280, cy + 280], fill=(230, 235, 240))
    draw_s_logo(draw, px + 170, cy + 150, 60, BRAND_EMERALD)
    draw.text((px + 310, cy + 40), "Regular Unisex Polo", font=f_bold, fill=TEXT_DARK)
    draw.text((px + 310, cy + 90), "100% Combed Cotton • Bio-washed", font=f_b, fill=TEXT_MUTED)
    draw.text((px + 310, cy + 150), "₹ 650", font=f_bold, fill=BRAND_EMERALD)
    draw.rectangle([px + 310, cy + 210, px + 480, cy + 265], fill=BRAND_EMERALD)
    draw.text((px + 340, cy + 225), "View Sizes", font=f_b, fill=WHITE)

    # Uniform Card 2
    cy = py + 500
    draw.rectangle([px + 40, cy, px + pw - 40, cy + 300], fill=(245, 247, 250), outline=(220, 225, 230), width=2)
    draw.rectangle([px + 60, cy + 20, px + 280, cy + 280], fill=(230, 235, 240))
    draw_s_logo(draw, px + 170, cy + 150, 60, BRAND_EMERALD)
    draw.text((px + 310, cy + 40), "Navy Formal Trousers", font=f_bold, fill=TEXT_DARK)
    draw.text((px + 310, cy + 90), "Wrinkle-resistant Poly-Viscose", font=f_b, fill=TEXT_MUTED)
    draw.text((px + 310, cy + 150), "₹ 850", font=f_bold, fill=BRAND_EMERALD)
    draw.rectangle([px + 310, cy + 210, px + 480, cy + 265], fill=BRAND_EMERALD)
    draw.text((px + 340, cy + 225), "View Sizes", font=f_b, fill=WHITE)


def draw_content_sizing(draw, px, py, pw, ph, f_h, f_b, f_bold):
    draw.text((px + 40, py + 40), "Instant AI Size Finder", font=f_h, fill=BRAND_EMERALD)
    draw.text((px + 40, py + 90), "No tape measure needed. Accurate in seconds.", font=f_b, fill=TEXT_MUTED)

    # Input Box Height
    draw.rectangle([px + 40, py + 160, px + pw - 40, py + 260], fill=(245, 247, 250), outline=(210, 215, 220), width=2)
    draw.text((px + 60, py + 180), "Child's Height", font=f_b, fill=TEXT_MUTED)
    draw.text((px + 60, py + 215), "135 cm (4 ft 5 in)", font=f_bold, fill=TEXT_DARK)

    # Input Box Weight
    draw.rectangle([px + 40, py + 280, px + pw - 40, py + 380], fill=(245, 247, 250), outline=(210, 215, 220), width=2)
    draw.text((px + 60, py + 300), "Child's Weight", font=f_b, fill=TEXT_MUTED)
    draw.text((px + 60, py + 335), "32 kg", font=f_bold, fill=TEXT_DARK)

    # Recommendation Box
    rec_y = py + 420
    draw.rectangle([px + 40, rec_y, px + pw - 40, rec_y + 400], fill=(236, 247, 243), outline=BRAND_EMERALD, width=3)
    draw.rectangle([px + 60, rec_y + 30, px + 280, rec_y + 80], fill=BRAND_EMERALD)
    draw.text((px + 80, rec_y + 42), "RECOMMENDED", font=f_bold, fill=WHITE)
    draw.text((px + 60, rec_y + 110), "Size 30 (Medium)", font=f_h, fill=BRAND_DARK)
    draw.text((px + 60, rec_y + 170), "Estimated Shoulder: 33.5 cm (± 1.4 cm)", font=f_b, fill=TEXT_DARK)
    draw.text((px + 60, rec_y + 210), "Chest: 76-80 cm • Length: 56 cm", font=f_b, fill=TEXT_MUTED)
    draw.text((px + 60, rec_y + 260), "Confidence: High (94%)", font=f_bold, fill=BRAND_EMERALD)
    draw.text((px + 60, rec_y + 310), "Room for natural growth accounted for.", font=f_b, fill=TEXT_MUTED)


def draw_content_cart(draw, px, py, pw, ph, f_h, f_b, f_bold):
    draw.text((px + 40, py + 40), "Your Uniform Cart", font=f_h, fill=BRAND_EMERALD)
    draw.text((px + 40, py + 90), "2 items • Ready for quick checkout", font=f_b, fill=TEXT_MUTED)

    # Cart item 1
    draw.rectangle([px + 40, py + 160, px + pw - 40, py + 320], fill=(250, 252, 254), outline=(220, 225, 230), width=2)
    draw.text((px + 60, py + 190), "Regular Unisex Polo - Size 30", font=f_bold, fill=TEXT_DARK)
    draw.text((px + 60, py + 235), "Qty: 2 • ₹ 650 each", font=f_b, fill=TEXT_MUTED)
    draw.text((px + pw - 200, py + 235), "₹ 1,300", font=f_bold, fill=TEXT_DARK)

    # Cart item 2
    draw.rectangle([px + 40, py + 340, px + pw - 40, py + 500], fill=(250, 252, 254), outline=(220, 225, 230), width=2)
    draw.text((px + 60, py + 370), "Navy Formal Trousers - Size 30", font=f_bold, fill=TEXT_DARK)
    draw.text((px + 60, py + 415), "Qty: 1 • ₹ 850", font=f_b, fill=TEXT_MUTED)
    draw.text((px + pw - 200, py + 415), "₹ 850", font=f_bold, fill=TEXT_DARK)

    # Total & Checkout Button
    draw.rectangle([px + 40, py + 550, px + pw - 40, py + 720], fill=(245, 247, 250))
    draw.text((px + 60, py + 580), "Total Payable:", font=f_b, fill=TEXT_MUTED)
    draw.text((px + pw - 220, py + 580), "₹ 2,150", font=f_h, fill=BRAND_EMERALD)
    draw.rectangle([px + 60, py + 630, px + pw - 60, py + 700], fill=BRAND_EMERALD)
    draw.text((px + 220, py + 650), "Pay via UPI / Card (Razorpay)", font=f_bold, fill=WHITE)


def draw_content_orders(draw, px, py, pw, ph, f_h, f_b, f_bold):
    draw.text((px + 40, py + 40), "Track Order #ORD-84920", font=f_h, fill=BRAND_EMERALD)
    draw.text((px + 40, py + 90), "Estimated Delivery: Tomorrow by 2 PM", font=f_b, fill=TEXT_MUTED)

    # Milestone Steps
    steps = [
        ("Order Confirmed", "Nov 15, 10:30 AM", True),
        ("Tailoring & Quality Check", "Nov 16, 04:15 PM", True),
        ("Dispatched via Bluedart", "Nov 17, 09:00 AM", True),
        ("Out for Delivery", "Pending", False),
    ]

    sy = py + 180
    for title, time_str, done in steps:
        color = BRAND_EMERALD if done else (190, 195, 200)
        draw.ellipse([px + 60, sy, px + 95, sy + 35], fill=color)
        draw.text((px + 120, sy + 2), title, font=f_bold, fill=TEXT_DARK if done else TEXT_MUTED)
        draw.text((px + 120, sy + 38), time_str, font=f_b, fill=TEXT_MUTED)
        if sy < py + 450:
            draw.line([px + 77, sy + 35, px + 77, sy + 100], fill=color, width=4)
        sy += 100

    # Fit feedback banner
    draw.rectangle([px + 40, py + 620, px + pw - 40, py + 780], fill=(236, 247, 243), outline=BRAND_EMERALD, width=2)
    draw.text((px + 60, py + 645), "How did the uniform fit?", font=f_bold, fill=BRAND_DARK)
    draw.text((px + 60, py + 685), "Too Tight   •   Fits Well   •   Too Loose", font=f_b, fill=BRAND_EMERALD)
    draw.text((px + 60, py + 725), "Instant 1-tap feedback helps refine future sizes.", font=f_b, fill=TEXT_MUTED)


if __name__ == "__main__":
    generate_feature_graphic()
    generate_mock_screenshot("01_home_catalogue.png", "Official School Catalogues", "Directly approved by your child's school.", draw_content_home)
    generate_mock_screenshot("02_instant_sizing.png", "AI Size Recommendations", "Just height & weight. 100% private.", draw_content_sizing)
    generate_mock_screenshot("03_cart_checkout.png", "Instant Secure Checkout", "UPI, Cards, and NetBanking with Razorpay.", draw_content_cart)
    generate_mock_screenshot("04_order_tracking.png", "Live Milestones & Easy Fit", "Track your parcel from stitch to doorstep.", draw_content_orders)
    print("All Play Store assets generated successfully!")
