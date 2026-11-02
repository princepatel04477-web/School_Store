"""Fit a real invisible-mannequin garment photo onto a fixed model photo (no AI).

Usage: fit_garment.py GARMENT.png MODEL.webp OUT.png
Landmarks below are for the suit photo and the Class 12 boy; a real engine would store them per photo.
"""
import sys

import cv2
import numpy as np

KNOT_G, HEM_G, CROTCH_G, CX_G = 112, 1158, 680, 373   # garment photo: tie knot row, hem row, crotch row, centre
KNOT_M, HEM_M, CX_M = 308, 1320, 498                  # model photo: the same points
LEG_SPREAD = 1.31                                     # the model stands with feet apart; the photo's legs are closer
BOX = (220, 780, 225, 1325)                           # model area where the old clothes are removed
COLLAR_TOP = 38                                       # garment rows above this would rise over the chin

# Each sleeve: its centre line in the garment photo (elbow, cuff), the model's wrist centre, how far the
# cuff drops to overlap the hand, and the outline that separates the sleeve from the jacket body.
ELBOW_G, CUFF_G = 350, 578
CUFF_WIDTH_M = 60
SLEEVES = (
    {'axis': (205, 191), 'wrist': 301, 'width': 73, 'drop': 16, 'outline': [(0, 170), (240, 170), (229, 610), (0, 610)]},
    {'axis': (533, 559), 'wrist': 697, 'width': 67, 'drop': 2, 'outline': [(749, 170), (505, 170), (523, 610), (749, 610)]},
)


def fill_holes(mask):
    m = mask.astype(np.uint8)
    out = m.copy()
    cv2.floodFill(out, np.zeros((m.shape[0] + 2, m.shape[1] + 2), np.uint8), (0, 0), 1)
    return m | (1 - out)


def garment_alpha(g):
    """Dark cloth plus all it encloses, plus the white collar and cuffs, which match the white backdrop."""
    dark = (g.max(axis=2) < 80).astype(np.uint8)
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    white = [
        [(330, COLLAR_TOP), (412, COLLAR_TOP), (432, 62), (432, 125), (312, 125), (312, 62)],
        [(154, 556), (228, 556), (227, 578), (154, 577)],
        [(526, 566), (590, 563), (593, 588), (530, 595)],
    ]
    for poly in white:
        cv2.fillPoly(dark, [np.array(poly, np.int32)], 1)
    return fill_holes(dark).astype(np.float32)


def body_map(shape):
    """Same scale as the model top to bottom; only the legs spread out to meet the shoes."""
    h, w = shape
    scale = (HEM_M - KNOT_M) / (HEM_G - KNOT_G)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    gy = KNOT_G + (yy - KNOT_M) / scale
    spread = 1 + (LEG_SPREAD - 1) * np.clip((gy - CROTCH_G) / (HEM_G - CROTCH_G), 0, 1)
    gx = CX_G + (xx - CX_M) / (scale * spread)
    return gx, gy


def sleeve_map(shape, sleeve):
    """From the elbow down, the sleeve narrows and moves onto the model's wrist, and the cuff meets the hand."""
    h, w = shape
    scale = (HEM_M - KNOT_M) / (HEM_G - KNOT_G)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    gy = KNOT_G + (yy - KNOT_M) / scale
    t = np.clip((gy - ELBOW_G) / (CUFF_G - ELBOW_G), 0, 1.3)
    gy = gy - sleeve['drop'] / scale * np.clip(t, 0, 1)
    top, bottom = sleeve['axis']
    axis = top + (bottom - top) * t
    start = CX_M + (axis - CX_G) * scale
    end = start + (sleeve['wrist'] - (CX_M + (bottom - CX_G) * scale)) * np.clip(t, 0, 1)
    narrow = 1 - (1 - CUFF_WIDTH_M / (sleeve['width'] * scale)) * np.clip(t, 0, 1)
    gx = axis + (xx - end) / (scale * narrow)
    return gx, gy, (gx - axis) / (sleeve['width'] / 2)


def fitted(cloth_g, alpha_g, shape):
    """Body first, then each sleeve laid over it, rounded across like an arm inside it."""
    gx, gy = body_map(shape)
    cloth = cv2.remap(cloth_g, gx, gy, cv2.INTER_CUBIC)
    alpha = np.clip(cv2.remap(alpha_g, gx, gy, cv2.INTER_LINEAR), 0, 1)
    region = np.ones(alpha_g.shape, np.uint8)
    for sleeve in SLEEVES:
        cv2.fillPoly(region, [np.array(sleeve['outline'], np.int32)], 0)
    alpha = alpha * cv2.remap(region.astype(np.float32), gx, gy, cv2.INTER_LINEAR)
    for sleeve in SLEEVES:
        part = np.zeros(alpha_g.shape, np.uint8)
        cv2.fillPoly(part, [np.array(sleeve['outline'], np.int32)], 1)
        sx, sy, across = sleeve_map(shape, sleeve)
        a = np.clip(cv2.remap(alpha_g * part, sx, sy, cv2.INTER_LINEAR), 0, 1)[..., None]
        round_light = 1 - 0.16 * np.clip(across, -1, 1)[..., None] ** 2
        layer = cv2.remap(cloth_g, sx, sy, cv2.INTER_CUBIC) * round_light
        cloth = cloth * (1 - a) + layer * a
        alpha = alpha + a[..., 0] * (1 - alpha)
    # where a sleeve leaves the body: close hairline seams, drop thin slivers of cloth
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    # any strip narrower than a sleeve in the gap under the arm is a leftover of the photo's seam
    alpha[480:680] = cv2.morphologyEx(alpha[480:680], cv2.MORPH_OPEN, np.ones((1, 21), np.uint8))
    return cloth, cv2.GaussianBlur(np.clip(alpha, 0, 1), (0, 0), 0.7)


def empty_backdrop(img):
    """The backdrop with the student gone. Filled from the real backdrop around them at low resolution
    (a backdrop has no detail to lose), then feathered in so no seam shows."""
    h, w, _ = img.shape
    x0, x1, y0, y1 = BOX
    gone = np.zeros((h, w), np.uint8)
    gone[y0:y1, x0:x1] = 1
    gone[:y0, 390:620] = 1          # head: not a source for the fill
    gone[y1:1460, 300:700] = 1      # shoes and socks: nor these
    small = cv2.resize(img, None, fx=1 / 8, fy=1 / 8, interpolation=cv2.INTER_AREA)
    small_gone = cv2.resize(gone, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    small_gone = cv2.dilate(small_gone, np.ones((3, 3), np.uint8))
    filled = cv2.inpaint(small, small_gone, 7, cv2.INPAINT_TELEA)
    filled = cv2.GaussianBlur(cv2.resize(filled, (w, h), interpolation=cv2.INTER_CUBIC).astype(np.float32), (0, 0), 14)
    soft = np.zeros((h, w), np.float32)
    soft[y0:y1, x0:x1] = 1
    soft = cv2.GaussianBlur(soft, (0, 0), 10)[..., None]
    soft = np.clip(soft * 2, 0, 1)
    return img.astype(np.float32) * (1 - soft) + filled * soft


def keep_mask(img, garment):
    """Neck and hands stay from the real photo, in front of the collar opening and below the cuffs."""
    h, w, _ = img.shape
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    skin = ((hsv[..., 0] < 25) & (hsv[..., 1] > 45) & (hsv[..., 2] > 60)).astype(np.uint8)
    rows = np.arange(h)[:, None]
    neck = cv2.dilate(skin, np.ones((3, 3), np.uint8)).astype(bool) & (rows < KNOT_M + 2)
    # the V of the collar front stays over the neck
    cols = np.arange(w)[None, :]
    neck &= rows < KNOT_M - np.abs(cols - CX_M) * 0.8
    hands = cv2.morphologyEx(skin, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8)).astype(bool) & (rows > 745) & (rows < 960)
    hands &= garment < 0.5
    # socks and shoes below the hem: white or dark, unlike the bluish floor
    sat, val = hsv[..., 1], hsv[..., 2]
    feet = ((sat < 25) & (val > 170) | (val < 80)) & (rows > HEM_M - 6) & (cols > 320) & (cols < 700) & (garment < 0.5)
    keep = (neck | hands | feet).astype(np.float32)
    return cv2.GaussianBlur(keep, (0, 0), 0.9)


def in_scene_light(g, img):
    """Studio white has a cool tint and studio black is never pure: bring the garment photo into that light."""
    x0, x1 = 400, 600
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    region = img[320:580, x0:x1][hsv[320:580, x0:x1][..., 1] < 38]
    white = np.percentile(region, 92, axis=0).astype(np.float32)
    lifted = 16 + g.astype(np.float32) * (white - 16) / 255
    lifted[..., 0] += 3 * (1 - g[..., 0].astype(np.float32) / 255)  # shadows lean to the blue of the room
    return lifted


def main():
    g_path, m_path, out_path = sys.argv[1:4]
    g = cv2.imread(g_path)[..., :3]
    img = cv2.imread(m_path)
    h, w, _ = img.shape

    cloth, alpha = fitted(in_scene_light(g, img), cv2.GaussianBlur(garment_alpha(g), (0, 0), 0.8), (h, w))

    plate = empty_backdrop(img)
    shadow = cv2.GaussianBlur(np.roll(alpha, 10, axis=1), (0, 0), 18)
    out = plate * (1 - 0.22 * shadow)[..., None]
    out = out * (1 - alpha[..., None]) + cloth * alpha[..., None]

    keep = keep_mask(img, alpha)[..., None]
    # the cuff shades the hand just under it
    under = cv2.GaussianBlur(np.roll(alpha, 5, axis=0), (0, 0), 5) * (np.arange(h)[:, None] > 745) * (np.arange(h)[:, None] < 960)
    hand = img.astype(np.float32) * (1 - 0.5 * under * (1 - alpha))[..., None]
    out = out * (1 - keep) + hand * keep
    grain = np.random.default_rng(5).standard_normal((h, w, 1)).astype(np.float32) * 1.0
    out = out + grain * alpha[..., None]
    cv2.imwrite(out_path, np.clip(out, 0, 255).astype(np.uint8))


if __name__ == '__main__':
    main()
