"""Recolour the Class 12 boy into a yellow polo with navy collar, placket and sleeve trim, and navy pants (no AI).

Usage: try_polo.py UNIFORM_PHOTO MODEL_PHOTO PANT_MASK OUT_FILE
Colours are sampled from the photo. Landmarks are hand-placed for this model.
"""
import sys

import cv2
import numpy as np

SHIRT_OUTLINE = [(450, 236), (420, 278), (340, 310), (276, 455), (384, 494), (384, 606), (618, 606), (620, 494), (718, 462), (662, 310), (575, 278), (548, 236)]
COLLAR = [[(450, 238), (420, 320), (499, 332), (462, 278)], [(549, 238), (576, 320), (499, 332), (538, 278)]]
PLACKET = [(490, 328), (513, 328), (513, 408), (490, 408)]
TRIMS = [((279, 447), (385, 484)), ((715, 454), (619, 484))]
TRIM_WIDTH = 18
YELLOW_PATCH = (130, 170, 80, 130)
NAVY_PATCH = (300, 420, 70, 95)
SHIRT_DEPTH = 3.2        # a white shirt's folds are faint: deepen them on colour
PANT_GAIN = 1.25
SHIRT_TONE = np.array([0.9, 0.88, 0.97], np.float32)  # BGR: fabric, not the photo's flash-lit yellow


def median_colour(photo, patch):
    y0, y1, x0, x1 = patch
    return np.median(photo[y0:y1, x0:x1].reshape(-1, 3), axis=0).astype(np.float32)


def shirt_mask(img):
    rough = np.zeros(img.shape[:2], np.uint8)
    cv2.fillPoly(rough, [np.array(SHIRT_OUTLINE, np.int32)], 1)
    labels = np.where(cv2.dilate(rough, np.ones((31, 31), np.uint8)) > 0, cv2.GC_PR_FGD, cv2.GC_BGD).astype(np.uint8)
    labels[cv2.erode(rough, np.ones((21, 21), np.uint8)) > 0] = cv2.GC_FGD
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    labels[(hsv[..., 0] < 25) & (hsv[..., 1] > 45)] = cv2.GC_BGD
    labels[(hsv[..., 1] > 55) & (hsv[..., 0] >= 100) & (hsv[..., 0] < 125)] = cv2.GC_BGD
    cv2.grabCut(img, labels, None, np.zeros((1, 65)), np.zeros((1, 65)), 5, cv2.GC_INIT_WITH_MASK)
    mask = np.isin(labels, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)
    return cv2.medianBlur(mask * 255, 9).astype(np.float32) / 255


def over(canvas, colour, light, alpha):
    a = cv2.GaussianBlur(alpha, (0, 0), 0.8)[..., None]
    return canvas * (1 - a) + colour * light[..., None] * a


def main():
    photo_path, model_path, pant_path, out_path = sys.argv[1:5]
    photo = cv2.imread(photo_path)[..., :3]
    img = cv2.imread(model_path)
    shirt = shirt_mask(img)
    pant = cv2.imread(pant_path, 0).astype(np.float32) / 255
    yellow = median_colour(photo, YELLOW_PATCH)
    navy = median_colour(photo, NAVY_PATCH)
    print('yellow', yellow, 'navy', navy)

    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    soft = cv2.GaussianBlur(grey, (0, 0), 4)
    shirt_light = np.clip(1 + (soft / np.median(grey[shirt > 0.5]) - 1) * SHIRT_DEPTH, 0.62, 1.06)
    crisp_light = np.clip(cv2.GaussianBlur(grey, (0, 0), 1) / np.median(grey[shirt > 0.5]), 0.5, 1.1)
    pant_light = np.clip(cv2.GaussianBlur(grey, (0, 0), 0.8) / np.median(grey[pant > 0.5]), 0.45, 1.3)

    out = over(img.astype(np.float32), navy * PANT_GAIN, pant_light, pant)
    out = over(out, yellow * SHIRT_TONE, shirt_light, shirt)
    placket = np.zeros(grey.shape, np.float32)
    cv2.fillPoly(placket, [np.array(PLACKET, np.int32)], 1.0)
    out = over(out, navy * 1.1, crisp_light, placket * shirt)
    white = np.array([235, 240, 240], np.float32)
    for a, b in TRIMS:
        band = np.zeros(grey.shape, np.float32)
        cv2.line(band, a, b, 1.0, TRIM_WIDTH, cv2.LINE_AA)
        out = over(out, navy * 1.1, crisp_light, band * shirt)
        stripe = np.zeros(grey.shape, np.float32)
        cv2.line(stripe, a, b, 1.0, 3, cv2.LINE_AA)
        out = over(out, white, crisp_light, stripe * shirt)
    collar = np.zeros(grey.shape, np.float32)
    for flap in COLLAR:
        cv2.fillPoly(collar, [np.array(flap, np.int32)], 1.0)
    out = over(out, navy * 1.1, crisp_light, collar * shirt)
    cv2.imwrite(out_path, np.clip(out, 0, 255).astype(np.uint8))


if __name__ == '__main__':
    main()
