"""Fit a navy pant from one retailer flat-lay onto the Class 12 boy (no AI).

Usage: try_vest.py UNIFORM_PHOTO MODEL_DIR OUT_FILE
The grey pant is replaced in place; the model's real shirt stays.
Landmarks are hand-placed for this photo and this model.
"""
import sys

import cv2
import numpy as np

from try_on import MODELS, old_garment, old_shading, over

PANT_PATCH = (700, 1100, 100, 200)
PANT_GAIN = np.array([1.45, 1.15, 1.0], np.float32)  # BGR


def main():
    photo_path, model_dir, out_path = sys.argv[1:4]
    photo = cv2.imread(photo_path)[..., :3]
    img = cv2.imread(f'{model_dir}/std12-boy.webp')
    h, w, _ = img.shape
    shape = (h, w)
    y0, y1, x0, x1 = PANT_PATCH
    navy = np.median(photo[y0:y1, x0:x1].reshape(-1, 3), axis=0).astype(np.float32)

    mask = old_garment(img, MODELS['boy'])
    out = over(img.astype(np.float32), navy * PANT_GAIN * old_shading(img, mask)[..., None], cv2.GaussianBlur(mask, (0, 0), 0.8))

    cv2.imwrite(out_path, np.clip(out, 0, 255).astype(np.uint8))


if __name__ == '__main__':
    main()
