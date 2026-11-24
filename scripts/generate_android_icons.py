import os
from PIL import Image, ImageDraw, ImageFont

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

BG_COLOR = (47, 93, 80, 255)  # #2F5D50
TEXT_COLOR = (255, 255, 255, 255)

RES_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../frontend/android/app/src/main/res")
)

def find_serif_font(size):
    # Try finding Georgia or Times or DejaVu
    candidates = [
        "georgiaz.ttf",  # Georgia Bold Italic
        "georgiab.ttf",  # Georgia Bold
        "georgia.ttf",   # Georgia Regular
        "timesbd.ttf",   # Times New Roman Bold
        "times.ttf",
        "arialbd.ttf",
    ]
    font_dirs = [
        "C:\\Windows\\Fonts",
        "/usr/share/fonts/truetype",
        "/System/Library/Fonts",
    ]
    for d in font_dirs:
        for c in candidates:
            p = os.path.join(d, c)
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    pass
    return ImageFont.load_default()

def render_icon(size, is_round=False):
    # Render at 4x for high quality antialiasing
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = int(canvas_size * 0.04)
    box = [margin, margin, canvas_size - margin, canvas_size - margin]

    if is_round:
        draw.ellipse(box, fill=BG_COLOR)
    else:
        radius = int(canvas_size * 0.22)
        draw.rounded_rectangle(box, radius=radius, fill=BG_COLOR)

    # Draw letter 'S'
    font_size = int(canvas_size * 0.62)
    font = find_serif_font(font_size)

    # Text bounding box
    bbox = draw.textbbox((0, 0), "S", font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]

    # Center horizontally and vertically
    x = (canvas_size - w) / 2.0 - bbox[0]
    y = (canvas_size - h) / 2.0 - bbox[1] - int(canvas_size * 0.02)

    draw.text((x, y), "S", font=font, fill=TEXT_COLOR)

    # Downsample with Lanczos
    res = img.resize((size, size), Image.Resampling.LANCZOS)
    return res

def main():
    for folder, size in DENSITIES.items():
        target_dir = os.path.join(RES_DIR, folder)
        os.makedirs(target_dir, exist_ok=True)

        # Standard launcher icon
        icon_square = render_icon(size, is_round=False)
        square_path = os.path.join(target_dir, "ic_launcher.png")
        icon_square.save(square_path, "PNG")

        # Round launcher icon
        icon_round = render_icon(size, is_round=True)
        round_path = os.path.join(target_dir, "ic_launcher_round.png")
        icon_round.save(round_path, "PNG")

        print(f"Generated {folder} icons at {size}x{size}px")

if __name__ == "__main__":
    main()
