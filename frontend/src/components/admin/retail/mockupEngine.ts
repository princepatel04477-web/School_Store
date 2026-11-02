// The uniform mock-up engine, in the retailer's browser: no AI and no cost per picture.
//
// Each model student has a fixed photo and a garment mask (made once by engine-prototype/engine.py).
// The cloth is tiled across the mask and lit by the old garment's own folds. Only clothes pixels
// change, so a class's student is identical in every school's mock-up.

import type { UniformGender } from '../../../api';

/** There is no Class 1 model student yet. */
export const FIRST_MODEL_CLASS = 2;

/** The photographed cloth (about an A4 sheet) spans this many pixels of a model photo. */
const CLOTH_PIXELS = 260;
const LIGHT_MIN = 0.45;
const LIGHT_MAX = 1.3;
const WEBP_QUALITY = 0.9;
const JPEG_QUALITY = 0.92;

const luma = (data: Uint8ClampedArray, i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/**
 * Writes the cloth into `model` through `mask` (all RGBA, same size). The mask's red channel is the
 * coverage; the model's brightness relative to the garment's median becomes the cloth's light.
 */
export function compose(model: Uint8ClampedArray, mask: Uint8ClampedArray, cloth: Uint8ClampedArray): void {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < model.length; i += 4) if (mask[i] > 127) histogram[Math.round(luma(model, i))] += 1;
  const half = histogram.reduce((sum, n) => sum + n, 0) / 2;
  let median = 0;
  for (let seen = histogram[0]; seen < half && median < 255; seen += histogram[median]) median += 1;
  const base = median || 1;
  for (let i = 0; i < model.length; i += 4) {
    if (mask[i] === 0) continue;
    const coverage = mask[i] / 255;
    const light = Math.min(LIGHT_MAX, Math.max(LIGHT_MIN, luma(model, i) / base));
    for (let c = 0; c < 3; c += 1) model[i + c] += (cloth[i + c] * light - model[i + c]) * coverage;
  }
}

/** Left and right edge of the mask's middle, where the cloth's mirror line should fall. */
function maskCentre(mask: Uint8ClampedArray, width: number): number {
  let left = width;
  let right = 0;
  for (let i = 0; i < mask.length; i += 4) {
    if (mask[i] < 128) continue;
    const x = (i / 4) % width;
    if (x < left) left = x;
    if (x > right) right = x;
  }
  return Math.round((left + right) / 2);
}

export function loadPicture(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw pictures.');
  return [canvas, ctx];
}

/** The cloth mirrored into a block that repeats without seams. */
function clothBlock(cloth: HTMLImageElement): HTMLCanvasElement {
  const scale = CLOTH_PIXELS / Math.max(cloth.naturalWidth, cloth.naturalHeight);
  const w = Math.max(1, Math.round(cloth.naturalWidth * scale));
  const h = Math.max(1, Math.round(cloth.naturalHeight * scale));
  const [block, ctx] = canvasOf(w * 2, h * 2);
  ctx.imageSmoothingQuality = 'high';
  for (const [flipX, flipY] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    ctx.setTransform(flipX, 0, 0, flipY, w, h);
    ctx.drawImage(cloth, 0, 0, w, h);
  }
  return block;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** One finished mock-up. */
export async function renderMockup(classNo: number, gender: UniformGender, cloth: HTMLImageElement): Promise<Blob> {
  const name = `std${String(classNo).padStart(2, '0')}-${gender === 'GIRL' ? 'girl' : 'boy'}`;
  const [photo, maskPicture] = await Promise.all([loadPicture(`/models/${name}.webp`), loadPicture(`/models/masks/${name}-garment.png`)]);
  const { naturalWidth: width, naturalHeight: height } = photo;

  const [canvas, ctx] = canvasOf(width, height);
  ctx.drawImage(photo, 0, 0);
  const model = ctx.getImageData(0, 0, width, height);

  const [, maskCtx] = canvasOf(width, height);
  maskCtx.drawImage(maskPicture, 0, 0);
  const mask = maskCtx.getImageData(0, 0, width, height).data;

  const [, clothCtx] = canvasOf(width, height);
  const pattern = clothCtx.createPattern(clothBlock(cloth), 'repeat');
  if (!pattern) throw new Error('This browser cannot draw pictures.');
  pattern.setTransform(new DOMMatrix().translate(maskCentre(mask, width), 0));
  clothCtx.fillStyle = pattern;
  clothCtx.fillRect(0, 0, width, height);

  compose(model.data, mask, clothCtx.getImageData(0, 0, width, height).data);
  ctx.putImageData(model, 0, 0);

  // Safari can't write WebP and quietly returns a large PNG: use JPEG there.
  const webp = await toBlob(canvas, 'image/webp', WEBP_QUALITY);
  const picture = webp?.type === 'image/webp' ? webp : await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  if (!picture) throw new Error('Could not save the picture.');
  return picture;
}
