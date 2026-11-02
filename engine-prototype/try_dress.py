"""Replace the Class 12 girl's shirt and skirt with a one-piece plaid dress (no AI).

Usage: try_dress.py UNIFORM_PHOTO MODEL_DIR OUT_FILE
Cloth is sampled below the photo's school logo, so the logo is not carried over.
Landmarks are hand-placed for this photo and this model.
"""
import sys

import cv2
import numpy as np

from try_on import MODELS, old_garment, old_shading, over, polygon, ribbon

SHIRT_OUTLINE = [(462, 236), (433, 278), (355, 308), (290, 450), (388, 484), (388, 572), (612, 572), (618, 484), (713, 450), (650, 308), (578, 278), (545, 236)]
TORSO_ROWS = [(305, 397, 85, 240, 500, 135), (450, 395, 85, 570, 500, 118)]
SKIRT_ROWS = [(450, 395, 85, 570, 500, 118), (770, 405, 150, 1010, 500, 218)]
SLEEVE_ROWS = {
    'left': [(320, 345, 42, 300, 340, 70), (410, 330, 42, 490, 340, 70)],
    'right': [(320, 450, 42, 300, 660, 70), (410, 465, 42, 490, 660, 70)],
}
COLLAR = [[(465, 238), (432, 324), (503, 336), (474, 280)], [(548, 238), (579, 326), (505, 336), (538, 280)]]
COLLAR_SAMPLE = (160, 200, 390, 440)
CLOTH_GAIN = 1.3
TRIMS = [((300, 432), (388, 464)), ((703, 432), (618, 464))]


def shirt_mask(img):
    """White against a blue backdrop: GrabCut refines a rough outline into a clean edge."""
    rough = polygon(img.shape, SHIRT_OUTLINE).astype(np.uint8)
    labels = np.where(cv2.dilate(rough, np.ones((31, 31), np.uint8)) > 0, cv2.GC_PR_FGD, cv2.GC_BGD).astype(np.uint8)
    labels[cv2.erode(rough, np.ones((21, 21), np.uint8)) > 0] = cv2.GC_FGD
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    labels[(hsv[..., 0] < 25) & (hsv[..., 1] > 45)] = cv2.GC_BGD
    labels[(hsv[..., 1] > 55) & (hsv[..., 0] >= 100) & (hsv[..., 0] < 125)] = cv2.GC_BGD
    cv2.grabCut(img, labels, None, np.zeros((1, 65)), np.zeros((1, 65)), 5, cv2.GC_INIT_WITH_MASK)
    mask = np.isin(labels, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)
    return cv2.medianBlur(mask * 255, 9).astype(np.float32) / 255


def shirt_light(img, mask):
    """The shirt's broad folds only: its buttons and pocket lines must not show on the dress."""
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    soft = cv2.GaussianBlur(grey, (0, 0), 7)
    return np.clip(1 + (soft / np.median(grey[mask > 0]) - 1) * 1.5, 0.84, 1.2)


def main():
    photo_path, model_dir, out_path = sys.argv[1:4]
    photo = cv2.imread(photo_path)
    img = cv2.imread(f'{model_dir}/std12-girl.webp')
    h, w, _ = img.shape
    shape = (h, w)
    full = np.ones(photo.shape[:2], np.float32)
    part = lambda rows: ribbon(photo, full, rows, shape)[0].astype(np.float32)

    cols = np.arange(w)[None, :]
    rows = np.arange(h)[:, None]
    cloth = np.where((rows < 570)[..., None], part(TORSO_ROWS), part(SKIRT_ROWS))
    cloth = np.where(((cols < 388) & (rows < 495))[..., None], part(SLEEVE_ROWS['left']), cloth)
    cloth = np.where(((cols > 612) & (rows < 495))[..., None], part(SLEEVE_ROWS['right']), cloth)

    top = shirt_mask(img)
    skirt = old_garment(img, MODELS['girl'])
    light = np.where(rows < 572, shirt_light(img, top), old_shading(img, skirt))
    dress = np.maximum(top, skirt)
    out = over(img.astype(np.float32), cloth * CLOTH_GAIN * light[..., None], cv2.GaussianBlur(dress, (0, 0), 0.8))

    y0, y1, x0, x1 = COLLAR_SAMPLE
    blue = np.median(photo[y0:y1, x0:x1].reshape(-1, 3), axis=0).astype(np.float32)
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    trim = np.zeros(shape, np.float32)
    for a, b in TRIMS:
        cv2.line(trim, a, b, 1.0, 5, cv2.LINE_AA)
    out = over(out, blue * np.clip(grey / 215, 0.6, 1.08)[..., None], cv2.GaussianBlur(trim * top, (0, 0), 0.7))
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    skin_free = (~((hsv[..., 0] < 25) & (hsv[..., 1] > 48))).astype(np.float32)
    collar = np.zeros(shape, np.float32)
    for flap in COLLAR:
        collar = np.maximum(collar, polygon(img.shape, flap))
    out = over(out, blue * np.clip(grey / 215, 0.6, 1.08)[..., None], cv2.GaussianBlur(collar * skin_free, (0, 0), 0.8))
    cv2.imwrite(out_path, np.clip(out, 0, 255).astype(np.uint8))


if __name__ == '__main__':
    main()
