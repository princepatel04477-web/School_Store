"""Uniform mock-up engine: fixed model templates, only the clothes pixels change (no AI).

  engine.py build MODEL_DIR TEMPLATE_DIR           make a garment mask for every model photo
  engine.py render MODEL_PHOTO MASK SWATCH OUT     fill that model's garment with a fabric swatch
  engine.py sheet MODEL_DIR TEMPLATE_DIR SWATCH OUT   render every model onto one review sheet
"""
import glob
import os
import sys

import cv2
import numpy as np

BACKDROP_DISTANCE = 14      # Lab distance that separates the student from the backdrop
EDGE_COLUMNS = 90           # columns at each side that are always backdrop
RECLAIM_DISTANCE = 20       # Lab distance from the backdrop that is certainly the student
WAIST_ROWS = 60             # how far below the shirt a pant's or shorts' waist corners are reclaimed
GAP_DISTANCE = 10           # Lab distance within which a pixel between the legs is backdrop
REPEAT_SCALE = 1 / 1400     # fabric scale relative to the student's height, so patterns match across ages


def student_map(img):
    """Distance of each pixel from the backdrop colour of its own row."""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    edges = np.concatenate([lab[:, :EDGE_COLUMNS], lab[:, -EDGE_COLUMNS:]], axis=1)
    backdrop = np.median(edges, axis=1, keepdims=True)
    return np.linalg.norm(lab - backdrop, axis=2)


def excluded(img):
    """Skin, white shirt and socks, and dark shoes and hair are never the garment."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    skin = (hsv[..., 0] < 25) & (hsv[..., 1] > 45)
    white = (hsv[..., 1] < 40) & (hsv[..., 2] > 205)
    dark = hsv[..., 2] < 62
    return skin | white | dark


def fill_holes(mask, keep_out):
    """Patches the cut-out missed inside the garment are cloth too, unless they are a hand."""
    outside = mask.copy()
    cv2.floodFill(outside, np.zeros((mask.shape[0] + 2, mask.shape[1] + 2), np.uint8), (0, 0), 1)
    return ((mask | (1 - outside)) & ~keep_out).astype(np.uint8)


def garment_mask(img, style):
    """Start from the body: cloth directly under the shirt's hem is certainly the garment, and everything
    outside the hands, or above the hem, or below the shoes' top, is certainly not. GrabCut decides the rest."""
    h, w, _ = img.shape
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    never = excluded(img)
    shirt = (hsv[..., 1] < 40) & (hsv[..., 2] > 205)
    shirt[:h // 8] = False
    shirt[h * 2 // 3:] = False
    cx = int(np.median(np.flatnonzero(shirt.sum(axis=0) > 60)))
    hem = int(np.flatnonzero(shirt[:, cx - 40:cx + 40].mean(axis=1) > 0.5)[-1])
    skin = (hsv[..., 0] < 25) & (hsv[..., 1] > 45)
    columns = np.flatnonzero(skin[hem:h * 2 // 3].sum(axis=0) > 5)
    left, right = columns[0], columns[-1]
    shoes = (hsv[..., 2] < 62)
    shoes[:h * 3 // 4] = False
    bottom = int(np.flatnonzero(shoes.sum(axis=1) > 20)[0])

    # below the hem only true white (socks) is excluded: Class 2-3 shorts are a very light grey
    never[hem:] = skin[hem:] | ((hsv[hem:, :, 1] < 22) & (hsv[hem:, :, 2] > 238)) | ((hsv[hem:, :, 2] < 62) & (np.arange(hem, h)[:, None] > bottom - 10))

    labels = np.full((h, w), cv2.GC_BGD, np.uint8)
    labels[hem:bottom, left:right] = cv2.GC_PR_BGD
    labels[hem:bottom, cx - 120:cx + 120] = cv2.GC_PR_FGD
    labels[hem + 12:hem + 90, cx - 45:cx + 45] = cv2.GC_FGD
    labels[never] = cv2.GC_BGD
    cv2.grabCut(img, labels, None, np.zeros((1, 65)), np.zeros((1, 65)), 6, cv2.GC_INIT_WITH_MASK)
    mask = np.isin(labels, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)
    # pleat shadows and waistband corners GrabCut leaves out: anything clearly not backdrop, between the hands
    distance = student_map(img)
    sure = (distance > RECLAIM_DISTANCE) & ~never
    sure[:hem] = False
    sure[bottom if style == 'skirt' else hem + WAIST_ROWS:] = False
    # the waistband just above where the shirt seems to end, and clearly greyer than it
    band = (distance > RECLAIM_DISTANCE) & (hsv[..., 2] < 225) & ~skin
    band[:hem - 25] = False
    band[hem:] = False
    sure |= band
    sure[:, :left] = False
    sure[:, right:] = False
    mask = mask | sure.astype(np.uint8)
    if style == 'pant':
        # the backdrop showing between the legs, and socks showing above the shoes, are not cloth
        rows, cols = np.mgrid[0:h, 0:w]
        gap = (distance < GAP_DISTANCE) & (rows > hem + (bottom - hem) * 0.35) & (np.abs(cols - cx) < 45)
        socks = (hsv[..., 1] < 25) & (hsv[..., 2] > 170) & (rows > bottom - 60)
        mask[gap | socks] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    mask = (labels == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
    return cv2.medianBlur(fill_holes(mask, skin) * 255, 5)


def student_height(img):
    rows = np.flatnonzero((student_map(img) > BACKDROP_DISTANCE * 2).sum(axis=1) > 20)
    return rows[-1] - rows[0]


def tiled(swatch, shape, scale, centre_x):
    """Mirror-tile the swatch so it repeats without seams, centred on the student."""
    sw = cv2.resize(swatch, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    block = np.vstack([np.hstack([sw, sw[:, ::-1]]), np.hstack([sw[::-1], sw[::-1, ::-1]])])
    h, w = shape
    reps = (h // block.shape[0] + 2, 2 * w // block.shape[1] + 2, 1)
    big = np.tile(block, reps)
    x0 = (big.shape[1] // 2 - centre_x)
    return big[:h, x0:x0 + w].astype(np.float32)


def render(img, mask, swatch):
    alpha = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 0.8)
    xs = np.flatnonzero(mask.max(axis=0))
    cloth = tiled(swatch, img.shape[:2], student_height(img) * REPEAT_SCALE, (xs[0] + xs[-1]) // 2)
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    light = np.clip(cv2.GaussianBlur(grey, (0, 0), 0.8) / np.median(grey[mask > 127]), 0.45, 1.3)
    out = img.astype(np.float32) * (1 - alpha[..., None]) + cloth * light[..., None] * alpha[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def garment_style(name):
    """What each base photo wears: stdNN-boy or stdNN-girl."""
    class_no, gender = int(name[3:5]), name[6:]
    if class_no <= 4:
        return 'shorts'
    return 'skirt' if gender == 'girl' else 'pant'


def photos(model_dir):
    return sorted(glob.glob(f'{model_dir}/std*-*.webp'))


def build(model_dir, template_dir):
    os.makedirs(template_dir, exist_ok=True)
    for path in photos(model_dir):
        name = os.path.basename(path)[:-5]
        cv2.imwrite(f'{template_dir}/{name}-garment.png', garment_mask(cv2.imread(path), garment_style(name)))


def sheet(model_dir, template_dir, swatch_path, out_path):
    swatch = cv2.imread(swatch_path)
    cells = []
    for path in photos(model_dir):
        name = os.path.basename(path)[:-5]
        mask = cv2.imread(f'{template_dir}/{name}-garment.png', 0)
        cell = cv2.resize(render(cv2.imread(path), mask, swatch), (256, 384), interpolation=cv2.INTER_AREA)
        cv2.putText(cell, name[3:], (4, 22), 0, 0.6, (0, 0, 255), 2)
        cells.append(cell)
    while len(cells) % 6:
        cells.append(np.zeros_like(cells[0]))
    cv2.imwrite(out_path, np.vstack([np.hstack(cells[i:i + 6]) for i in range(0, len(cells), 6)]))


def main():
    command, *args = sys.argv[1:]
    if command == 'build':
        build(*args)
    elif command == 'sheet':
        sheet(*args)
    elif command == 'render':
        model, mask, swatch, out = args
        cv2.imwrite(out, render(cv2.imread(model), cv2.imread(mask, 0), cv2.imread(swatch)))


if __name__ == '__main__':
    main()
