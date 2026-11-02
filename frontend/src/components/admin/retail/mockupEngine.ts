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
function blurLumaGarment(
  reference: Uint8ClampedArray,
  garment: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 7
): Float32Array {
  let y0 = height;
  let y1 = 0;
  for (let i = 0; i < garment.length; i += 4) {
    if (garment[i] > 127) {
      const y = Math.floor(i / 4 / width);
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  y0 = Math.max(0, y0 - 10);
  y1 = Math.min(height - 1, y1 + 10);

  const lumaMap = new Float32Array(width * height);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      lumaMap[y * width + x] = 0.299 * reference[i] + 0.587 * reference[i + 1] + 0.114 * reference[i + 2];
    }
  }

  const temp = new Float32Array(width * height);
  const out = new Float32Array(width * height);

  for (let y = y0; y <= y1; y += 1) {
    const rowOffset = y * width;
    let sum = 0;
    for (let i = 0; i <= radius && i < width; i += 1) sum += lumaMap[rowOffset + i];
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      if (x > 0) {
        sum +=
          (x + radius < width ? lumaMap[rowOffset + x + radius] : lumaMap[rowOffset + width - 1]) -
          (x - radius - 1 >= 0 ? lumaMap[rowOffset + x - radius - 1] : lumaMap[rowOffset]);
      }
      temp[rowOffset + x] = sum / (right - left + 1);
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let i = y0; i <= Math.min(y1, y0 + radius); i += 1) sum += temp[i * width + x];
    for (let y = y0; y <= y1; y += 1) {
      const top = Math.max(y0, y - radius);
      const bottom = Math.min(y1, y + radius);
      if (y > y0) {
        sum +=
          (y + radius <= y1 ? temp[(y + radius) * width + x] : temp[y1 * width + x]) -
          (y - radius - 1 >= y0 ? temp[(y - radius - 1) * width + x] : temp[y0 * width + x]);
      }
      out[y * width + x] = sum / (bottom - top + 1);
    }
  }

  return out;
}

/**
 * Writes cloth onto model through garment mask, using softened lighting to eliminate formal trouser creases
 * while keeping 3D body volume, giving the appearance of soft knit track pants.
 */
export function composeTrackPants(
  model: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  garment: Uint8ClampedArray,
  cloth: Uint8ClampedArray,
  width: number,
  height: number
): void {
  const blurred = blurLumaGarment(reference, garment, width, height, 12);
  const values: number[] = [];
  let yMin = height;
  let yMax = 0;
  for (let i = 0; i < garment.length; i += 4) {
    if (garment[i] > 127) {
      values.push(blurred[i / 4]);
      const y = Math.floor(i / 4 / width);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  values.sort((a, b) => a - b);
  const base = values[values.length >> 1] || 1;
  const wbH = Math.round((yMax - yMin) * 0.045);

  for (let i = 0; i < model.length; i += 4) {
    if (garment[i] === 0) continue;
    const p = i / 4;
    const x = p % width;
    const y = Math.floor(p / width);
    const coverage = garment[i] / 255;
    const tricot = 1 + 0.012 * Math.sin(x * 0.8 + y * 0.4);
    const isWb = y >= yMin && y < yMin + wbH;
    const wbWave = isWb ? 0.92 * (1 + 0.04 * Math.sin(x * 0.45)) : 1.0;
    const light = Math.min(1.22, Math.max(0.68, (blurred[p] / base) * tricot * wbWave));
    for (let c = 0; c < 3; c += 1) model[i + c] += (cloth[i + c] * light - model[i + c]) * coverage;
  }
}

/**
 * Draws vertical side piping along the outer seam of both pant legs.
 */
export function drawPiping(
  model: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  garment: Uint8ClampedArray,
  width: number,
  height: number,
  pipingColour: Rgb
): void {
  let yMin = height;
  let yMax = 0;
  for (let i = 0; i < garment.length; i += 4) {
    if (garment[i] > 127) {
      const y = Math.floor(i / 4 / width);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  const span = yMax - yMin;
  if (span < 40) return;

  const yStart = yMin + Math.round(span * 0.08);
  const yEnd = yMax - Math.round(span * 0.02);
  const inset = Math.round(width * 0.01);
  const pipeW = Math.max(2, Math.round(width * 0.007));

  for (let y = yStart; y < yEnd; y += 1) {
    let leftX = width;
    let rightX = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      if (garment[(rowOffset + x) * 4] > 127) {
        if (x < leftX) leftX = x;
        if (x > rightX) rightX = x;
      }
    }
    if (rightX - leftX < 30) continue;

    // Left leg outer boundary: crisp white piping
    const xLeft = leftX + inset;
    for (let w = 0; w < pipeW; w += 1) {
      const p = (y * width + (xLeft + w)) * 4;
      if (garment[p] > 80) {
        for (let c = 0; c < 3; c += 1) model[p + c] = pipingColour[c];
      }
    }

    // Right leg outer boundary: crisp white piping
    const xRight = rightX - inset - pipeW;
    for (let w = 0; w < pipeW; w += 1) {
      const p = (y * width + (xRight + w)) * 4;
      if (garment[p] > 80) {
        for (let c = 0; c < 3; c += 1) model[p + c] = pipingColour[c];
      }
    }

    // Pin-tuck vertical crease for left and right athletic legs
    const midX = Math.round((leftX + rightX) / 2);
    const leftLegCenter = Math.round((leftX + midX) / 2);
    const rightLegCenter = Math.round((midX + rightX) / 2);

    const pLeft = (y * width + leftLegCenter) * 4;
    if (garment[pLeft] > 100) {
      model[pLeft] = Math.min(255, Math.round(model[pLeft] * 1.2));
      model[pLeft + 1] = Math.min(255, Math.round(model[pLeft + 1] * 1.2));
      model[pLeft + 2] = Math.min(255, Math.round(model[pLeft + 2] * 1.2));
      const pLeftShade = pLeft + 4;
      model[pLeftShade] = Math.round(model[pLeftShade] * 0.8);
      model[pLeftShade + 1] = Math.round(model[pLeftShade + 1] * 0.8);
      model[pLeftShade + 2] = Math.round(model[pLeftShade + 2] * 0.8);
    }

    const pRight = (y * width + rightLegCenter) * 4;
    if (garment[pRight] > 100) {
      model[pRight] = Math.min(255, Math.round(model[pRight] * 1.2));
      model[pRight + 1] = Math.min(255, Math.round(model[pRight + 1] * 1.2));
      model[pRight + 2] = Math.min(255, Math.round(model[pRight + 2] * 1.2));
      const pRightShade = pRight + 4;
      model[pRightShade] = Math.round(model[pRightShade] * 0.8);
      model[pRightShade + 1] = Math.round(model[pRightShade + 1] * 0.8);
      model[pRightShade + 2] = Math.round(model[pRightShade + 2] * 0.8);
    }
  }
}

/**
 * Draws polo t-shirt details: vertical center chest button placket and sleeve cuff trims.
 */
export function renderPoloDetails(
  model: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  shirt: Uint8ClampedArray,
  width: number,
  height: number,
  trimColour: Rgb
): void {
  let sMinX = width;
  let sMaxX = 0;
  let sMinY = height;
  let sMaxY = 0;
  for (let i = 0; i < shirt.length; i += 4) {
    if (shirt[i] > 100) {
      const p = i / 4;
      const x = p % width;
      const y = (p - x) / width;
      if (x < sMinX) sMinX = x;
      if (x > sMaxX) sMaxX = x;
      if (y < sMinY) sMinY = y;
      if (y > sMaxY) sMaxY = y;
    }
  }
  const sW = sMaxX - sMinX;
  const sH = sMaxY - sMinY;
  if (sW < 50 || sH < 50) return;

  const cx = Math.round((sMinX + sMaxX) / 2);
  const placketW = Math.round(sW * 0.055);
  const placketH = Math.round(sH * 0.2);
  const placketTop = sMinY + Math.round(sH * 0.14);
  const placketLeft = cx - Math.round(placketW / 2);

  // Placket down the center chest with 3D stitch margins
  for (let y = placketTop; y < placketTop + placketH; y += 1) {
    for (let x = placketLeft; x < placketLeft + placketW; x += 1) {
      const i = (y * width + x) * 4;
      if (shirt[i] > 100) {
        const edge = (x === placketLeft || x === placketLeft + placketW - 1) ? 0.8 : 1.0;
        const bottomEdge = (y >= placketTop + placketH - 2) ? 0.75 : 1.0;
        const lumaVal = (0.299 * reference[i] + 0.587 * reference[i + 1] + 0.114 * reference[i + 2]) / 180;
        const light = Math.min(1.15, Math.max(0.65, lumaVal)) * edge * bottomEdge;
        for (let c = 0; c < 3; c += 1) model[i + c] = Math.round(trimColour[c] * light);
      }
    }
  }

  // 2 buttons on placket
  const btn1Y = placketTop + Math.round(placketH * 0.35);
  const btn2Y = placketTop + Math.round(placketH * 0.72);
  const btnR = Math.max(2, Math.round(placketW * 0.16));

  for (const by of [btn1Y, btn2Y]) {
    for (let dy = -btnR; dy <= btnR; dy += 1) {
      for (let dx = -btnR; dx <= btnR; dx += 1) {
        if (dx * dx + dy * dy <= btnR * btnR) {
          const idx = ((by + dy) * width + (cx + dx)) * 4;
          if (idx >= 0 && idx < model.length) {
            const btnLight = (dx === 0 && dy === 0) ? 50 : 210;
            model[idx] = btnLight;
            model[idx + 1] = btnLight;
            model[idx + 2] = Math.min(255, btnLight + 15);
          }
        }
      }
    }
  }

  // Ribbed sleeve cuffs with clean white tipping at sleeve hems
  const cuffHeight = 15;
  const pipingColour: Rgb = [250, 250, 255];
  for (let x = sMinX; x < cx - 60; x += 1) {
    let botY = -1;
    for (let y = sMaxY; y >= sMinY; y -= 1) {
      if (shirt[(y * width + x) * 4] > 120) {
        if (y < sMaxY - 30) {
          botY = y;
          break;
        }
      }
    }
    if (botY > 0) {
      for (let cy = botY - cuffHeight; cy <= botY; cy += 1) {
        const i = (cy * width + x) * 4;
        if (cy >= 0 && cy < height && shirt[i] > 80) {
          const lumaVal = (0.299 * reference[i] + 0.587 * reference[i + 1] + 0.114 * reference[i + 2]) / 180;
          const light = Math.min(1.15, Math.max(0.7, lumaVal));
          for (let c = 0; c < 3; c += 1) model[i + c] = Math.round(trimColour[c] * light);
          if (cy === botY - Math.floor(cuffHeight / 2) || cy === botY - Math.floor(cuffHeight / 2) + 1) {
            for (let c = 0; c < 3; c += 1) model[i + c] = pipingColour[c];
          }
        }
      }
    }
  }

  for (let x = cx + 60; x <= sMaxX; x += 1) {
    let botY = -1;
    for (let y = sMaxY; y >= sMinY; y -= 1) {
      if (shirt[(y * width + x) * 4] > 120) {
        if (y < sMaxY - 30) {
          botY = y;
          break;
        }
      }
    }
    if (botY > 0) {
      for (let cy = botY - cuffHeight; cy <= botY; cy += 1) {
        const i = (cy * width + x) * 4;
        if (cy >= 0 && cy < height && shirt[i] > 80) {
          const lumaVal = (0.299 * reference[i] + 0.587 * reference[i + 1] + 0.114 * reference[i + 2]) / 180;
          const light = Math.min(1.15, Math.max(0.7, lumaVal));
          for (let c = 0; c < 3; c += 1) model[i + c] = Math.round(trimColour[c] * light);
          if (cy === botY - Math.floor(cuffHeight / 2) || cy === botY - Math.floor(cuffHeight / 2) + 1) {
            for (let c = 0; c < 3; c += 1) model[i + c] = pipingColour[c];
          }
        }
      }
    }
  }
}

/**
 * Pastes the school crest / logo badge detected from the uniform onto the model's left chest.
 */
function drawBadgeOnCanvas(
  ctx: CanvasRenderingContext2D,
  prepared: PreparedPhoto,
  shirt: Uint8ClampedArray,
  width: number,
  height: number
): void {
  const badge = prepared.detection.badge;
  if (!badge) return;

  let sMinX = width;
  let sMaxX = 0;
  let sMinY = height;
  let sMaxY = 0;
  for (let i = 0; i < shirt.length; i += 4) {
    if (shirt[i] > 100) {
      const p = i / 4;
      const x = p % width;
      const y = (p - x) / width;
      if (x < sMinX) sMinX = x;
      if (x > sMaxX) sMaxX = x;
      if (y < sMinY) sMinY = y;
      if (y > sMaxY) sMaxY = y;
    }
  }
  const sW = sMaxX - sMinX;
  const sH = sMaxY - sMinY;
  if (sW < 50 || sH < 50) return;

  const cx = Math.round((sMinX + sMaxX) / 2);
  const badgeTargetW = Math.round(sW * 0.13);
  const badgeAspect = badge.height / (badge.width || 1);
  const badgeTargetH = Math.round(badgeTargetW * badgeAspect);

  const targetX = cx + Math.round(sW * 0.14);
  const targetY = sMinY + Math.round(sH * 0.22);

  const sx = badge.x * prepared.photo.naturalWidth;
  const sy = badge.y * prepared.photo.naturalHeight;
  const sw = badge.width * prepared.photo.naturalWidth;
  const sh = badge.height * prepared.photo.naturalHeight;

  ctx.save();
  if ('roundRect' in ctx) {
    ctx.beginPath();
    (ctx as any).roundRect(targetX, targetY, badgeTargetW, badgeTargetH, 3);
    ctx.clip();
  }
  ctx.drawImage(prepared.photo, sx, sy, sw, sh, targetX, targetY, badgeTargetW, badgeTargetH);
  ctx.restore();
}

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

/** Reads a close-up fabric photo. The whole image becomes the lower-garment swatch. */
export async function prepareFabricPhoto(url: string): Promise<PreparedPhoto | null> {
  const photo = await loadPicture(url);
  if (!photo.naturalWidth || !photo.naturalHeight) return null;
  return {
    photo,
    detection: {
      cloth: { x: 0, y: 0, width: 1, height: 1 },
      plain: null,
      garmentWidth: 1,
      top: null,
      trim: null,
      onePiece: false,
      badge: null,
      trackPant: null,
    },
  };
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

  const isTrack = Boolean(prepared.detection.trackPant);
  const pantClothRgb = prepared.detection.plain
    ? (isTrack ? (prepared.detection.plain.map((c) => Math.min(255, Math.round(c * 1.25))) as Rgb) : prepared.detection.plain)
    : null;
  const cloth = pantClothRgb ? solid(pantClothRgb, width, height) : patternPixels(prepared, garment, width, height);

  if (isTrack) {
    composeTrackPants(model.data, reference, garment, cloth, width, height);
    drawPiping(model.data, reference, garment, width, height, prepared.detection.trackPant?.piping ?? [242, 242, 242]);
  } else {
    compose(model.data, reference, garment, cloth);
  }
  const { top, trim: trimColour, onePiece, badge } = prepared.detection;
  if (onePiece) {
    compose(model.data, reference, shirt, cloth, SHIRT_DEPTH);
  } else if (top && isTrack) {
    // Soften shirt lighting to eliminate dress shirt pocket/button seams, and apply athletic pique knit texture
    const blurredShirt = blurLumaGarment(reference, shirt, width, height, 5);
    const sValues: number[] = [];
    for (let i = 0; i < shirt.length; i += 4) if (shirt[i] > 127) sValues.push(blurredShirt[i / 4]);
    sValues.sort((a, b) => a - b);
    const sBase = sValues[sValues.length >> 1] || 1;
    for (let i = 0; i < model.data.length; i += 4) {
      if (shirt[i] === 0) continue;
      const p = i / 4;
      const x = p % width;
      const y = Math.floor(p / width);
      const coverage = shirt[i] / 255;
      const pique = 1 + 0.025 * Math.sin(x * 1.4) * Math.cos(y * 1.4);
      const light = Math.min(1.25, Math.max(0.65, 1 + (blurredShirt[p] / sBase - 1) * 1.5)) * pique;
      for (let c = 0; c < 3; c += 1) model.data[i + c] += (top[c] * light - model.data[i + c]) * coverage;
    }
  } else if (top) {
    compose(model.data, reference, shirt, solid(top, width, height), SHIRT_DEPTH);
  }
  if (top && trimColour) {
    compose(model.data, reference, trim, solid(trimColour, width, height));
    renderPoloDetails(model.data, reference, shirt, width, height, trimColour);
  }
  ctx.putImageData(model, 0, 0);
  if (badge && top) {
    drawBadgeOnCanvas(ctx, prepared, shirt, width, height);
  }

  // Safari can't write WebP and quietly returns a large PNG: use JPEG there.
  const webp = await toBlob(canvas, 'image/webp', WEBP_QUALITY);
  const picture = webp?.type === 'image/webp' ? webp : await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  if (!picture) throw new Error('Could not save the picture.');
  return picture;
}
