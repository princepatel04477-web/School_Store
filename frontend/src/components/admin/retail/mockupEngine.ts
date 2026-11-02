// The uniform mock-up engine, in the retailer's browser: no AI and no cost per picture.
//
// Each model student has a fixed photo and a garment mask (made once by engine-prototype/engine.py).
// The uniform is found in the retailer's photo (uniformDetect.ts); its cloth is tiled across the mask
// and lit by the old garment's own folds, and the top takes its colours. Only clothes pixels change, so a class's student is identical in every school's mock-up.

import type { UniformGender } from '../../../api';
import { detectUniform, type Detection, type Rgb } from './uniformDetect';

/** There is no Class 1 model student yet. */
export const FIRST_MODEL_CLASS = 2;

/** The photo is read at this size to find the uniform. */
const DETECT_SIDE = 420;
const SHIRT_DEPTH = 2.2;
/** Light in the cloth photo is measured over this many cells across: larger shapes count as shadow. */
const LIGHT_CELLS = 4;
/** Colour spread (0 to 255) under which cloth counts as plain: shine and folds stay below it, a pattern doesn't. */
const PLAIN_SPREAD = 26;
const LIGHT_MIN = 0.45;
const LIGHT_MAX = 1.3;
const WEBP_QUALITY = 0.9;
const JPEG_QUALITY = 0.92;

const luma = (data: Uint8ClampedArray, i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/**
 * Writes the cloth into `model` through `mask` (all RGBA, same size). The mask's red channel is the
 * coverage. The light comes from `reference`, the untouched photo: its brightness relative to the
 * masked garment's median, deepened by `depth` because a white shirt's folds are faint on colour.
 */
export function compose(model: Uint8ClampedArray, reference: Uint8ClampedArray, mask: Uint8ClampedArray, cloth: Uint8ClampedArray, depth = 1): void {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < reference.length; i += 4) if (mask[i] > 127) histogram[Math.round(luma(reference, i))] += 1;
  const half = histogram.reduce((sum, n) => sum + n, 0) / 2;
  let median = 0;
  for (let seen = histogram[0]; seen < half && median < 255; seen += histogram[median]) median += 1;
  const base = median || 1;
  for (let i = 0; i < model.length; i += 4) {
    if (mask[i] === 0) continue;
    const coverage = mask[i] / 255;
    const light = Math.min(LIGHT_MAX, Math.max(LIGHT_MIN, 1 + (luma(reference, i) / base - 1) * depth));
    for (let c = 0; c < 3; c += 1) model[i + c] += (cloth[i + c] * light - model[i + c]) * coverage;
  }
}

/**
 * Takes the photo's own light out of the cloth, keeping its colour and pattern. Tiled, a shadow in
 * the photo would otherwise repeat as bands across the garment; the model's folds give the light.
 */
export function flattenLight(cloth: Uint8ClampedArray, light: Uint8ClampedArray): void {
  const mean = [0, 0, 0];
  for (let i = 0; i < light.length; i += 4) for (let c = 0; c < 3; c += 1) mean[c] += light[i + c];
  const pixels = light.length / 4;
  for (let i = 0; i < cloth.length; i += 4) {
    for (let c = 0; c < 3; c += 1) cloth[i + c] = (cloth[i + c] * (mean[c] / pixels)) / (light[i + c] || 1);
  }
}

/**
 * Cloth with no real pattern becomes one even colour, so a crease in the photo can't repeat across
 * the garment. Patterned cloth is left as it is.
 */
export function makePlainIfEven(cloth: Uint8ClampedArray): void {
  const pixels = cloth.length / 4;
  const mean = [0, 0, 0];
  const square = [0, 0, 0];
  for (let i = 0; i < cloth.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      mean[c] += cloth[i + c] / pixels;
      square[c] += (cloth[i + c] * cloth[i + c]) / pixels;
    }
  }
  if (mean.some((m, c) => Math.sqrt(Math.max(0, square[c] - m * m)) > PLAIN_SPREAD)) return;
  for (let i = 0; i < cloth.length; i += 4) for (let c = 0; c < 3; c += 1) cloth[i + c] = mean[c];
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

/** The cloth at this size with its photo's light and shadows taken out. */
function evenCloth(cloth: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const [canvas, ctx] = canvasOf(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cloth, 0, 0, w, h);
  const [small, smallCtx] = canvasOf(LIGHT_CELLS, LIGHT_CELLS);
  smallCtx.imageSmoothingQuality = 'high';
  smallCtx.drawImage(canvas, 0, 0, LIGHT_CELLS, LIGHT_CELLS);
  const [, lightCtx] = canvasOf(w, h);
  lightCtx.imageSmoothingQuality = 'high';
  lightCtx.drawImage(small, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  flattenLight(image.data, lightCtx.getImageData(0, 0, w, h).data);
  makePlainIfEven(image.data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** The cloth mirrored into a block that repeats without seams. */
function clothBlock(cloth: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(cloth.width * scale));
  const h = Math.max(1, Math.round(cloth.height * scale));
  const flat = evenCloth(cloth, w, h);
  const [block, ctx] = canvasOf(w * 2, h * 2);
  ctx.imageSmoothingQuality = 'high';
  for (const [flipX, flipY] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    ctx.setTransform(flipX, 0, 0, flipY, w, h);
    ctx.drawImage(flat, 0, 0, w, h);
  }
  return block;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** A retailer's photo, read and with its uniform found. */
export interface PreparedPhoto {
  photo: HTMLImageElement;
  detection: Detection;
}

/** Reads the photo and finds the uniform in it; null when none can be found. */
export async function preparePhoto(url: string, gender: UniformGender): Promise<PreparedPhoto | null> {
  const photo = await loadPicture(url);
  const scale = Math.min(1, DETECT_SIDE / Math.max(photo.naturalWidth, photo.naturalHeight));
  const width = Math.max(1, Math.round(photo.naturalWidth * scale));
  const height = Math.max(1, Math.round(photo.naturalHeight * scale));
  const [, ctx] = canvasOf(width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo, 0, 0, width, height);
  const detection = detectUniform({ data: ctx.getImageData(0, 0, width, height).data, width, height }, gender);
  return detection && { photo, detection };
}

/** The found piece of cloth, cut from the full-size photo. */
function cutCloth({ photo, detection }: PreparedPhoto): HTMLCanvasElement {
  const { x, y, width, height } = detection.cloth;
  const [canvas, ctx] = canvasOf(Math.max(1, Math.round(width * photo.naturalWidth)), Math.max(1, Math.round(height * photo.naturalHeight)));
  ctx.drawImage(photo, x * photo.naturalWidth, y * photo.naturalHeight, width * photo.naturalWidth, height * photo.naturalHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function maskPixels(name: string, part: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const picture = await loadPicture(`/models/masks/${name}-${part}.png`);
  const [, ctx] = canvasOf(width, height);
  ctx.drawImage(picture, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}

/** The model's width at the hips, in pixels. */
function maskHipWidth(mask: Uint8ClampedArray, width: number, height: number): number {
  let first = 0;
  for (let i = 0; i < mask.length; i += 4) {
    if (mask[i] > 127) {
      first = Math.floor(i / 4 / width);
      break;
    }
  }
  const row = Math.min(height - 1, first + 90);
  let count = 0;
  for (let x = 0; x < width; x += 1) if (mask[(row * width + x) * 4] > 127) count += 1;
  return count;
}

function solid(colour: Rgb, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = colour[0];
    out[i + 1] = colour[1];
    out[i + 2] = colour[2];
  }
  return out;
}

/** The found cloth repeated over the whole photo. It keeps its size against the garment: the photo's hips span the model's hips. */
function patternPixels(prepared: PreparedPhoto, garment: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const cut = cutCloth(prepared);
  const garmentPixels = prepared.detection.garmentWidth * prepared.photo.naturalWidth;
  const scale = garmentPixels > 0 ? maskHipWidth(garment, width, height) / garmentPixels : 1;
  const [, clothCtx] = canvasOf(width, height);
  const pattern = clothCtx.createPattern(clothBlock(cut, scale), 'repeat');
  if (!pattern) throw new Error('This browser cannot draw pictures.');
  pattern.setTransform(new DOMMatrix().translate(maskCentre(garment, width), 0));
  clothCtx.fillStyle = pattern;
  clothCtx.fillRect(0, 0, width, height);
  return clothCtx.getImageData(0, 0, width, height).data;
}

/** One finished mock-up. */
export async function renderMockup(classNo: number, gender: UniformGender, prepared: PreparedPhoto): Promise<Blob> {
  const name = `std${String(classNo).padStart(2, '0')}-${gender === 'GIRL' ? 'girl' : 'boy'}`;
  const photo = await loadPicture(`/models/${name}.webp`);
  const { naturalWidth: width, naturalHeight: height } = photo;
  const [canvas, ctx] = canvasOf(width, height);
  ctx.drawImage(photo, 0, 0);
  const model = ctx.getImageData(0, 0, width, height);
  const reference = model.data.slice();
  const [garment, shirt, trim] = await Promise.all(['garment', 'shirt', 'trim'].map((part) => maskPixels(name, part, width, height)));

  const cloth = prepared.detection.plain ? solid(prepared.detection.plain, width, height) : patternPixels(prepared, garment, width, height);

  compose(model.data, reference, garment, cloth);
  const { top, trim: trimColour, onePiece } = prepared.detection;
  if (onePiece) compose(model.data, reference, shirt, cloth, SHIRT_DEPTH);
  else if (top) compose(model.data, reference, shirt, solid(top, width, height), SHIRT_DEPTH);
  if (top && trimColour) compose(model.data, reference, trim, solid(trimColour, width, height));
  ctx.putImageData(model, 0, 0);

  // Safari can't write WebP and quietly returns a large PNG: use JPEG there.
  const webp = await toBlob(canvas, 'image/webp', WEBP_QUALITY);
  const picture = webp?.type === 'image/webp' ? webp : await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  if (!picture) throw new Error('Could not save the picture.');
  return picture;
}
