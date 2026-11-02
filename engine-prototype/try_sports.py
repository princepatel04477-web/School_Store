"""Recolour a T-shirt model into a sports uniform: coloured T-shirt with neck and sleeve trim, track pants with side piping (no AI).

Usage: try_sports.py UNIFORM_PHOTO MODEL_PHOTO PANT_MASK OUT_FILE
Colours are sampled from the photo. Trim and piping follow the model's own edges, so no landmarks are needed.
"""
import sys

import cv2
import numpy as np

from engine import student_map

SHIRT_PATCH = (130, 170, 80, 130)
PANT_PATCH = (300, 420, 70, 95)
SHIRT_TONE = np.array([0.9, 0.88, 0.97], np.float32)  # BGR: fabric, not the photo's flash-lit yellow
PANT_GAIN = 1.25
SHIRT_DEPTH = 2.2        # a white T-shirt's folds are faint: deepen them on colour
TRACK_SOFTNESS = 7       # blur on the pant's light: removes formal creases, keeps the body's shape
NECK_TRIM = 13
SLEEVE_TRIM = 13
BACKDROP_CLEAR = 16
HEM_OVERLAP = 40         # the T-shirt's hem can hang below where the pant's cut-out starts
WAIST_ROWS = 34
PIPING_INSET = 7
PIPING_WIDTH = 4
PIPING = np.array([240, 240, 240], np.float32)


def median_colour(photo, patch):
    y0, y1, x0, x1 = patch
    return np.median(photo[y0:y1, x0:x1].reshape(-1, 3), axis=0).astype(np.float32)


def largest(mask):
    _, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    return (labels == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])).astype(np.uint8)


def shirt_mask(img, pant):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    top = int(np.flatnonzero(pant.max(axis=1) > 0.5)[0])
    # the backdrop on some models is a pale grey too: the T-shirt must also stand clear of it
    white = ((hsv[..., 1] < 40) & (hsv[..., 2] > 175) & (student_map(img) > BACKDROP_CLEAR)).astype(np.uint8)
    white[top + HEM_OVERLAP:] = 0
    white[:img.shape[0] // 8] = 0
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return largest(cv2.morphologyEx(white, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)))


def trims(img, shirt):
    """The rims of the T-shirt that touch skin: the neck above the chest, the sleeve ends beside it."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    skin = ((hsv[..., 0] < 25) & (hsv[..., 1] > 45)).astype(np.uint8)
    rows = np.flatnonzero(shirt.max(axis=1))
    top, height = rows[0], rows[-1] - rows[0]
    xs = np.flatnonzero(shirt[top + height // 2])
    cx = (xs[0] + xs[-1]) // 2
    neck_skin = skin.copy()
    neck_skin[top + height // 4:] = 0
    neck_skin[:, :cx - 90] = 0
    neck_skin[:, cx + 90:] = 0
    arm_skin = skin.copy()
    arm_skin[:top + height // 5] = 0
    arm_skin[top + height * 45 // 100:] = 0  # below the sleeve ends an arm only passes the body
    neck = cv2.dilate(neck_skin, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (NECK_TRIM * 2, NECK_TRIM * 2))) & shirt
    sleeves = cv2.dilate(arm_skin, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (SLEEVE_TRIM * 2, SLEEVE_TRIM * 2))) & shirt
    # only sleeve ends, not the sides where an arm passes the body
    sleeves[:, cx - (xs[-1] - xs[0]) // 2 + 4:cx + (xs[-1] - xs[0]) // 2 - 4] = 0
    return neck.astype(np.float32), sleeves.astype(np.float32)


def piping(pant):
    """A thin line just inside each leg's outer edge, below the waist."""
    out = np.zeros(pant.shape, np.float32)
    rows = np.flatnonzero(pant.max(axis=1) > 0.5)
    for y in range(rows[0] + 40, rows[-1]):
        xs = np.flatnonzero(pant[y] > 0.5)
        out[y, xs[0] + PIPING_INSET:xs[0] + PIPING_INSET + PIPING_WIDTH] = 1
        out[y, xs[-1] - PIPING_INSET - PIPING_WIDTH:xs[-1] - PIPING_INSET] = 1
    return cv2.GaussianBlur(out, (0, 0), 0.8)


def with_waist_corners(img, pant, shirt):
    """The waistband's grey corners, beside the T-shirt's hem, are pant too."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    top = int(np.flatnonzero(pant.max(axis=1) > 0.5)[0])
    xs = np.flatnonzero(pant[top + WAIST_ROWS] > 0.5)
    corners = (student_map(img) > BACKDROP_CLEAR) & (shirt == 0) & ~((hsv[..., 0] < 25) & (hsv[..., 1] > 45))
    corners[:top - 12] = False
    corners[top + WAIST_ROWS:] = False
    corners[:, :xs[0]] = False
    corners[:, xs[-1] + 1:] = False
    return np.maximum(pant, corners.astype(np.float32))


def over(canvas, colour, light, alpha):
    a = cv2.GaussianBlur(alpha, (0, 0), 0.8)[..., None]
    return canvas * (1 - a) + colour * light[..., None] * a


def main():
    photo_path, model_path, pant_path, out_path = sys.argv[1:5]
    photo = cv2.imread(photo_path)[..., :3]
    img = cv2.imread(model_path)
    pant = cv2.imread(pant_path, 0).astype(np.float32) / 255
    shirt = shirt_mask(img, pant)
    pant = with_waist_corners(img, pant, shirt)
    yellow = median_colour(photo, SHIRT_PATCH) * SHIRT_TONE
    navy = median_colour(photo, PANT_PATCH)

    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    base = np.median(grey[shirt > 0])
    shirt_light = np.clip(1 + (cv2.GaussianBlur(grey, (0, 0), 1.5) / base - 1) * SHIRT_DEPTH, 0.55, 1.08)
    pant_base = np.median(grey[pant > 0.5])
    pant_light = np.clip(cv2.GaussianBlur(grey, (0, 0), TRACK_SOFTNESS) / pant_base, 0.7, 1.2)

    out = over(img.astype(np.float32), navy * PANT_GAIN, pant_light, pant)
    out = over(out, PIPING, pant_light, piping(pant))
    out = over(out, yellow, shirt_light, shirt.astype(np.float32))
    neck, sleeves = trims(img, shirt)
    out = over(out, navy * 1.15, shirt_light, neck)
    out = over(out, navy * 1.15, shirt_light, sleeves)
    cv2.imwrite(out_path, np.clip(out, 0, 255).astype(np.uint8))


if __name__ == '__main__':
    main()
