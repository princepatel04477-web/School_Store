"""Fit the plaid skirt and pant from one retailer photo onto the Class 12 models (no AI).

Usage: try_on.py UNIFORM_PHOTO MODEL_DIR OUT_DIR
Each garment part is a "ribbon": matching rows (photo row, photo centre, photo half width, model row, model
centre, model half width). Landmarks are hand-placed for this photo and these two models.
"""
import sys

import cv2
import numpy as np


MODELS = {
    'girl': {
        'hem': 1010,
        'waist': 560,
        'outline': [(395, 563), (605, 563), (710, 968), (560, 1008), (360, 1008), (290, 965)],
        'lower': [('skirt', [(528, 190, 92, 562, 500, 118), (700, 190, 120, 790, 500, 172), (872, 188, 145, 1010, 500, 222)])],
    },
    'boy': {
        'hem': 1326,
        'waist': 590,
        'outline': [(385, 592), (612, 592), (648, 800), (655, 1320), (568, 1320), (503, 800), (438, 1322), (355, 1320), (358, 800)],
        'lower': [
            ('left', [(530, 483, 50, 592, 442, 66), (665, 472, 60, 792, 428, 84), (1075, 425, 45, 1330, 396, 62)]),
            ('right', [(530, 583, 47, 592, 555, 66), (665, 597, 60, 792, 570, 84), (1075, 629, 38, 1330, 612, 62)]),
        ],
    },
}


def polygon(shape, points):
    mask = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(mask, [np.array(points, np.int32)], 1)
    return mask.astype(np.float32)


def ribbon(photo, alpha, rows, shape):
    """Warp one garment part row by row between its matched rows on the photo and the model."""
    h, w = shape
    rows = np.array(sorted(rows, key=lambda row: row[3]), np.float32)
    my = np.arange(h, dtype=np.float32)
    gy, gc, gh, mc, mh = (np.interp(my, rows[:, 3], rows[:, i]) for i in (0, 1, 2, 4, 5))
    xx = np.arange(w, dtype=np.float32)[None, :]
    map_x = (gc[:, None] + (xx - mc[:, None]) * gh[:, None] / mh[:, None]).astype(np.float32)
    map_y = np.repeat(gy[:, None], w, axis=1).astype(np.float32)
    outside = (my < rows[0, 3]) | (my > rows[-1, 3])
    a = cv2.remap(alpha, map_x, map_y, cv2.INTER_LINEAR, borderValue=0)
    a[outside] = 0
    return cv2.remap(photo, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT), np.clip(a, 0, 1)


def over(canvas, layer, alpha):
    return canvas * (1 - alpha[..., None]) + layer * alpha[..., None]


def old_garment(img, config):
    """The exact shape of the model's grey garment. Its colour is close to the backdrop, so GrabCut refines
    a rough outline; skin is never part of it."""
    rough = polygon(img.shape, config['outline']).astype(np.uint8)
    near = cv2.dilate(rough, np.ones((25, 25), np.uint8))
    core = cv2.erode(rough, np.ones((25, 25), np.uint8))
    labels = np.where(near > 0, cv2.GC_PR_FGD, cv2.GC_BGD).astype(np.uint8)
    labels[core > 0] = cv2.GC_FGD
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    labels[(hsv[..., 0] < 25) & (hsv[..., 1] > 45)] = cv2.GC_BGD
    labels[(hsv[..., 1] < 25) & (hsv[..., 2] > 205)] = cv2.GC_BGD
    labels[:config['waist']] = cv2.GC_BGD
    labels[config['hem']:] = cv2.GC_BGD
    cv2.grabCut(img, labels, None, np.zeros((1, 65)), np.zeros((1, 65)), 6, cv2.GC_INIT_WITH_MASK)
    mask = np.isin(labels, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(np.float32)


def old_shading(img, mask):
    """The grey garment's own light, folds, pleats and loops, as a multiplier for the new cloth."""
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    return np.clip(cv2.GaussianBlur(grey, (0, 0), 0.8) / np.median(grey[mask > 0]), 0.45, 1.3)


def build(photo, img, config):
    """Nothing is pasted over the student: the new cloth only replaces the grey garment, pixel for pixel."""
    h, w, _ = img.shape
    shape = (h, w)
    full = np.ones(photo.shape[:2], np.float32)
    parts = dict((name, ribbon(photo, full, rows, shape)[0]) for name, rows in config['lower'])
    if 'skirt' in parts:
        cloth = parts['skirt']
    else:
        cols = np.arange(w)[None, :]
        cloth = np.where((cols < 499)[..., None], parts['left'], parts['right'])

    mask = old_garment(img, config)
    soft = cv2.GaussianBlur(mask, (0, 0), 0.8)
    lit = cloth.astype(np.float32) * old_shading(img, mask)[..., None]
    out = over(img.astype(np.float32), lit, soft)

    grain = np.random.default_rng(5).standard_normal((h, w, 1)).astype(np.float32)
    return np.clip(out + grain * soft[..., None], 0, 255).astype(np.uint8)


def main():
    photo_path, model_dir, out_dir = sys.argv[1:4]
    photo = cv2.imread(photo_path)
    for name, config in MODELS.items():
        img = cv2.imread(f'{model_dir}/std12-{name}.webp')
        cv2.imwrite(f'{out_dir}/plaid-{name}12.png', build(photo, img, config))


if __name__ == '__main__':
    main()
