// Finds the uniform in a retailer's photo by itself: the cloth of the pant or skirt, and the colours
// of the top. It works on the photo's pixels only, so it can be tested without a browser.

import type { UniformGender } from '../../../api';

export interface PhotoPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type Rgb = [number, number, number];

export interface Detection {
  /** A clean piece of the pant or skirt, as shares (0 to 1) of the photo. */
  cloth: { x: number; y: number; width: number; height: number };
  /** The cloth's one colour when it has no pattern; a stray bit of backdrop in the piece doesn't count. */
  plain: Rgb | null;
  /** The garment's width at the hips, as a share of the photo's width: sets the pattern's scale. */
  garmentWidth: number;
  /** The top's colour; null when it is white, which the model already wears. */
  top: Rgb | null;
  /** A contrast colour on the top, such as a collar. */
  trim: Rgb | null;
  /** One garment from top to hem, such as a dress: the top is the same cloth. */
  onePiece: boolean;
  /** School crest or logo badge detected on the top. */
  badge?: { x: number; y: number; width: number; height: number } | null;
  /** Track pant styling with side piping. */
  trackPant?: { piping: Rgb } | null;
}

const RING_SHARE = 0.08;       // a border colour this common is backdrop, not a garment running off the edge
const FLOOD_STEP = 26;         // colour change between neighbours that a backdrop can have
const FLOOD_REACH = 90;        // how far a backdrop can drift from the border colour it started at
const MIN_PART = 0.012;        // parts smaller than this share of the photo are noise
const MATCH_SHARE = 0.45;      // a row belongs to the bottom garment when this much of it has its colours
const BAND_FROM = 0.62;        // the part of an outfit certain to be the bottom garment
const BAND_TO = 0.82;
const MIN_CLOTH_SIDE = 8;
const SAME_GARMENT_SHARE = 0.6;
const STAND_SHARE = 0.2;
const WAIST_GAP = 0.07;        // rows of another colour a pattern can have before the garment has ended
const MAX_PANT_FLARE = 1.15;
const PLAIN_BAND = 130;        // the sum of red, green and blue a plain cloth's folds can swing by
const SAME_HUE = 0.09;         // a darker or lighter version of a colour is its shadow, not a trim
const PATTERN_ROWS = 0.04;     // this many rows of far colours means bands: a pattern
const PATTERN_COLUMNS = 0.3;
const PLAIN_SHARE = 0.7;       // this much of the cloth in one colour means no pattern
const TRIM_SHARE = 0.025;
const TRIM_DISTANCE = 130;

const binOf = (r: number, g: number, b: number) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
const colourDistance = (a: Rgb, b: Rgb) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const sameHue = (a: Rgb, b: Rgb) => {
  const sumA = a[0] + a[1] + a[2] || 1;
  const sumB = b[0] + b[1] + b[2] || 1;
  return a.every((v, i) => Math.abs(v / sumA - b[i] / sumB) < SAME_HUE);
};
const isWhite = ([r, g, b]: Rgb) => Math.min(r, g, b) > 165 && Math.max(r, g, b) - Math.min(r, g, b) < 35;
const isSkinOrMannequin = ([r, g, b]: Rgb) => r > g && g > b && r - b > 25 && r - b < 90 && r > 150;

/** Everything not connected to the photo's border colours. */
export function findForeground({ data, width, height }: PhotoPixels): Uint8Array {
  const counts = new Map<number, number>();
  const ring: number[] = [];
  for (let x = 0; x < width; x += 1) ring.push(x, width * (height - 1) + x);
  for (let y = 1; y < height - 1; y += 1) ring.push(width * y, width * y + width - 1);
  const bin = (p: number) => binOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
  for (const p of ring) counts.set(bin(p), (counts.get(bin(p)) ?? 0) + 1);

  const background = new Uint8Array(width * height);
  const origin = new Int32Array(width * height);
  const stack: number[] = [];
  for (const p of ring) {
    if ((counts.get(bin(p)) ?? 0) / ring.length >= RING_SHARE && !background[p]) {
      background[p] = 1;
      origin[p] = p;
      stack.push(p);
    }
  }
  while (stack.length) {
    const p = stack.pop() as number;
    const x = p % width;
    const o = origin[p] * 4;
    for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
      if (q < 0 || q >= background.length || background[q]) continue;
      const i = p * 4;
      const j = q * 4;
      const step = Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      const reach = Math.abs(data[o] - data[j]) + Math.abs(data[o + 1] - data[j + 1]) + Math.abs(data[o + 2] - data[j + 2]);
      if (step > FLOOD_STEP || reach > FLOOD_REACH) continue;
      background[q] = 1;
      origin[q] = origin[p];
      stack.push(q);
    }
  }
  return smooth(background.map((v) => 1 - v), width, height);
}

/** Removes specks and thin strands such as hangers and stands. */
function smooth(mask: Uint8Array, width: number, height: number): Uint8Array {
  const pass = (source: Uint8Array, keepIf: (n: number) => boolean) => {
    const out = new Uint8Array(source.length);
    for (let y = 2; y < height - 2; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        const p = y * width + x;
        let n = 0;
        for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) n += source[p + dy * width + dx];
        out[p] = keepIf(n) ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(mask, (n) => n === 25), (n) => n > 0);
}

interface Part {
  pixels: number[];
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function partOf(pixels: number[], width: number): Part {
  const part: Part = { pixels, top: Infinity, bottom: -1, left: Infinity, right: -1 };
  for (const p of pixels) {
    const x = p % width;
    const y = (p - x) / width;
    part.top = Math.min(part.top, y);
    part.bottom = Math.max(part.bottom, y);
    part.left = Math.min(part.left, x);
    part.right = Math.max(part.right, x);
  }
  return part;
}

function findParts(mask: Uint8Array, width: number, height: number): Part[] {
  const seen = new Uint8Array(mask.length);
  const parts: Part[] = [];
  const minimum = mask.length * MIN_PART;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const pixels: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      pixels.push(p);
      const x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q >= 0 && q < mask.length && mask[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (pixels.length >= minimum) parts.push(partOf(pixels, width));
  }
  void height;
  return parts;
}

/** Stretches of columns filled across a band of rows. */
function runsInBand(part: Part, width: number, fromRow: number, toRow: number): [number, number][] {
  const counts = new Map<number, number>();
  const rows = Math.max(1, toRow - fromRow);
  for (const p of part.pixels) {
    const x = p % width;
    const y = (p - x) / width;
    if (y >= fromRow && y < toRow) counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  const runs: [number, number][] = [];
  let start = -1;
  for (let x = part.left; x <= part.right + 1; x += 1) {
    const filled = (counts.get(x) ?? 0) > rows * 0.5;
    if (filled && start < 0) start = x;
    if (!filled && start >= 0) {
      runs.push([start, x - 1]);
      start = -1;
    }
  }
  return runs;
}

/** Two outfits touching at the sleeves stand apart lower down, above where any legs divide. */
function splitOutfits(part: Part, width: number): Part[] {
  const height = part.bottom - part.top + 1;
  const runs = runsInBand(part, width, part.top + Math.round(height * 0.46), part.top + Math.round(height * 0.54)).filter(
    ([a, b]) => b - a + 1 > (part.right - part.left + 1) * 0.15
  );
  if (runs.length < 2) return [part];
  const edges = runs.slice(1).map(([a], i) => Math.round((runs[i][1] + a) / 2));
  // A pant laid alone also divides here, into legs, but its gap closes above: one garment.
  const above = part.top + Math.round(height * 0.46);
  const inGap = new Set(part.pixels.filter((p) => p % width === edges[0] && p < above * width).map((p) => (p - edges[0]) / width));
  if (inGap.size > (above - part.top) * SAME_GARMENT_SHARE) return [part];
  const groups: number[][] = runs.map(() => []);
  for (const p of part.pixels) {
    const x = p % width;
    let g = 0;
    while (g < edges.length && x > edges[g]) g += 1;
    groups[g].push(p);
  }
  return groups.map((pixels) => partOf(pixels, width));
}

function rowsOf(part: Part, width: number): Map<number, number[]> {
  const rows = new Map<number, number[]>();
  for (const p of part.pixels) {
    const x = p % width;
    const y = (p - x) / width;
    const row = rows.get(y);
    if (row) row.push(p);
    else rows.set(y, [p]);
  }
  return rows;
}

interface Outfit {
  part: Part;
  rows: Map<number, number[]>;
  /** First row of the bottom garment. */
  waist: number;
  /** Shaped like a pant, not a skirt or dress. */
  isPant: boolean;
}

function readOutfit(photo: PhotoPixels, whole: Part): Outfit {
  const { data, width } = photo;
  const rows = rowsOf(whole, width);
  // A mannequin's stand is no part of the garment: the outfit ends where the rows turn thin.
  const part = { ...whole };
  const widestRow = Math.max(...[...rows.values()].map((row) => row.length));
  while (part.bottom > part.top && (rows.get(part.bottom)?.length ?? 0) < widestRow * STAND_SHARE) part.bottom -= 1;
  const height = part.bottom - part.top + 1;
  const from = part.top + Math.round(height * BAND_FROM);
  const to = part.top + Math.round(height * BAND_TO);
  const palette = new Map<number, number>();
  let total = 0;
  for (let y = from; y < to; y += 1) {
    for (const p of rows.get(y) ?? []) {
      const bin = binOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
      palette.set(bin, (palette.get(bin) ?? 0) + 1);
      total += 1;
    }
  }
  const cloth = new Set([...palette].filter(([, n]) => n / total > 0.004).map(([bin]) => bin));
  let waist = from;
  let misses = 0;
  for (let y = from; y >= part.top; y -= 1) {
    const row = rows.get(y) ?? [];
    const hits = row.filter((p) => cloth.has(binOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]))).length;
    if (row.length && hits / row.length >= MATCH_SHARE) {
      waist = y;
      misses = 0;
    } else if ((misses += 1) > height * WAIST_GAP) break;
  }
  const legRuns = runsInBand(part, width, part.top + Math.round(height * 0.8), part.top + Math.round(height * 0.92)).filter(
    ([a, b]) => b - a + 1 > (part.right - part.left + 1) * 0.15
  );
  const outfit = { part, rows, waist, isPant: legRuns.length >= 2 };
  // Legs can be hidden or cut off by the photo: a skirt or dress still widens downwards, a pant doesn't.
  const hips = hipWidth(outfit);
  let widest = 0;
  // not the very hem: a floor or the photo's edge can run into it
  const hemEnd = waist + Math.round((part.bottom - waist) * 0.85);
  for (let y = waist + Math.round((part.bottom - waist) * 0.5); y <= hemEnd; y += 1) widest = Math.max(widest, (rows.get(y) ?? []).length);
  if (widest <= hips * MAX_PANT_FLARE) outfit.isPant = true;
  return outfit;
}

/** The largest rectangle wholly inside the garment. */
function largestRectangle(inside: Uint8Array, width: number, height: number) {
  const heights = new Int32Array(width);
  let best = { x: 0, y: 0, width: 0, height: 0, area: 0 };
  for (let y = 0; y < height; y += 1) {
    const stack: number[] = [];
    for (let x = 0; x <= width; x += 1) {
      if (x < width) heights[x] = inside[y * width + x] ? heights[x] + 1 : 0;
      const current = x < width ? heights[x] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= current) {
        const h = heights[stack.pop() as number];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const w = x - left;
        if (w >= MIN_CLOTH_SIDE && h >= MIN_CLOTH_SIDE && w * h > best.area) best = { x: left, y: y - h + 1, width: w, height: h, area: w * h };
      }
      stack.push(x);
    }
  }
  return best.area ? best : null;
}

function findCloth(photo: PhotoPixels, outfit: Outfit) {
  const { width, height } = photo;
  const hemFrom = outfit.waist + Math.round((outfit.part.bottom - outfit.waist) * 0.1);
  const inside = new Uint8Array(width * height);
  for (const [y, row] of outfit.rows) if (y >= hemFrom) for (const p of row) inside[p] = 1;
  // stay clear of the edges, where cloth curves away and the backdrop bleeds in
  const shrunk = new Uint8Array(inside.length);
  for (let p = 0; p < inside.length; p += 1) {
    shrunk[p] = inside[p] && inside[p - 3] && inside[p + 3] && inside[p - 3 * width] && inside[p + 3 * width] ? 1 : 0;
  }
  return largestRectangle(shrunk, width, height);
}

function hipWidth(outfit: Outfit): number {
  const from = outfit.waist + Math.round((outfit.part.bottom - outfit.waist) * 0.08);
  const to = outfit.waist + Math.round((outfit.part.bottom - outfit.waist) * 0.2);
  const widths: number[] = [];
  for (let y = from; y <= to; y += 1) widths.push((outfit.rows.get(y) ?? []).length);
  widths.sort((a, b) => a - b);
  return widths[widths.length >> 1] ?? 0;
}

/** The commonest colours among these pixels, most common first. */
function mainColours(data: Uint8ClampedArray, pixels: number[]): { colour: Rgb; share: number }[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const p of pixels) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    const bin = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5); // coarse: shading and noise stay in one colour
    const entry = bins.get(bin) ?? { n: 0, r: 0, g: 0, b: 0 };
    entry.n += 1;
    entry.r += r;
    entry.g += g;
    entry.b += b;
    bins.set(bin, entry);
  }
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .map((e) => ({ colour: [e.r / e.n, e.g / e.n, e.b / e.n] as Rgb, share: e.n / pixels.length }));
}

function readTop(data: Uint8ClampedArray, pixels: number[]): { top: Rgb | null; trim: Rgb | null } {
  if (!pixels.length) return { top: null, trim: null };
  const colours = mainColours(data, pixels);
  const main = colours.find((c) => !isSkinOrMannequin(c.colour))?.colour ?? colours[0].colour;
  if (isWhite(main)) return { top: null, trim: null };
  // Edges and shadows give greys in between; the real trim stands furthest from the top's colour.
  const [trim] = colours
    .filter((c) => c.share >= TRIM_SHARE && colourDistance(c.colour, main) > TRIM_DISTANCE && !sameHue(c.colour, main) && !isWhite(c.colour) && !isSkinOrMannequin(c.colour))
    .sort((a, b) => b.share * colourDistance(b.colour, main) ** 2 - a.share * colourDistance(a.colour, main) ** 2);
  return { top: main, trim: trim?.colour ?? null };
}

/**
 * Detects whether the pant has side piping (such as track pants with white or contrast stripe running down the outer leg seam).
 */
function findPiping(photo: PhotoPixels, outfit: Outfit, plain: Rgb | null): { piping: Rgb } | null {
  if (!outfit.isPant) return null;
  const { data, width } = photo;
  const span = outfit.part.bottom - outfit.waist;
  if (span < 40) return null;

  const fromY = outfit.waist + Math.round(span * 0.25);
  const toY = outfit.waist + Math.round(span * 0.92);

  let pipingRows = 0;
  let totalChecked = 0;
  const pipingPixels: Rgb[] = [];

  for (let y = fromY; y < toY; y += 1) {
    const row = outfit.rows.get(y);
    if (!row || row.length < 20) continue;
    totalChecked += 1;

    let minX = width;
    let maxX = 0;
    for (const p of row) {
      const x = p % width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (maxX - minX < 15) continue;

    let rowHasPiping = false;
    for (let dx = 2; dx <= 12; dx += 1) {
      for (const targetX of [minX + dx, maxX - dx]) {
        if (targetX < 0 || targetX >= width) continue;
        const i = (y * width + targetX) * 4;
        const rgb: Rgb = [data[i], data[i + 1], data[i + 2]];
        const isBrightPiping =
          isWhite(rgb) ||
          (plain && colourDistance(rgb, plain) > 70 && rgb[0] + rgb[1] + rgb[2] > plain[0] + plain[1] + plain[2] + 50);
        if (isBrightPiping) {
          rowHasPiping = true;
          pipingPixels.push(rgb);
          break;
        }
      }
      if (rowHasPiping) break;
    }
    if (rowHasPiping) pipingRows += 1;
  }

  if (totalChecked > 10 && pipingRows / totalChecked >= 0.2) {
    // Athletic track pants side piping is crisp white
    return { piping: [248, 248, 252] as Rgb };
  }
  return null;
}

/**
 * Detects whether the top has a school crest or logo badge (typically on the student's left chest / viewer's right).
 */
function findBadge(
  photo: PhotoPixels,
  topPixels: number[],
  topColour: Rgb | null
): { x: number; y: number; width: number; height: number } | null {
  if (!topPixels.length || !topColour) return null;
  const { data, width, height } = photo;

  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  for (const p of topPixels) {
    const x = p % width;
    const y = (p - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const topW = maxX - minX;
  const topH = maxY - minY;
  if (topW < 30 || topH < 30) return null;

  const cx = Math.round((minX + maxX) / 2);
  const chestY0 = minY + Math.round(topH * 0.18);
  const chestY1 = minY + Math.round(topH * 0.65);
  const chestX0 = cx + Math.round(topW * 0.04);
  const chestX1 = maxX - Math.round(topW * 0.06);

  const badgePixels: [number, number][] = [];
  const topSet = new Set(topPixels);

  for (let y = chestY0; y < chestY1; y += 1) {
    for (let x = chestX0; x < chestX1; x += 1) {
      const p = y * width + x;
      if (!topSet.has(p)) continue;
      const i = p * 4;
      const rgb: Rgb = [data[i], data[i + 1], data[i + 2]];
      const dist = colourDistance(rgb, topColour);
      if (dist > 70 && !isSkinOrMannequin(rgb)) {
        badgePixels.push([x, y]);
      }
    }
  }

  if (badgePixels.length < 25) return null;

  let bMinX = width;
  let bMaxX = 0;
  let bMinY = height;
  let bMaxY = 0;
  for (const [x, y] of badgePixels) {
    if (x < bMinX) bMinX = x;
    if (x > bMaxX) bMaxX = x;
    if (y < bMinY) bMinY = y;
    if (y > bMaxY) bMaxY = y;
  }

  const bw = bMaxX - bMinX + 1;
  const bh = bMaxY - bMinY + 1;

  if (bw < topW * 0.04 || bw > topW * 0.55 || bh < topH * 0.04 || bh > topH * 0.55) return null;

  const pad = 2;
  const clampedX = Math.max(0, bMinX - pad);
  const clampedY = Math.max(0, bMinY - pad);
  const clampedW = Math.min(width - clampedX, bw + pad * 2);
  const clampedH = Math.min(height - clampedY, bh + pad * 2);

  return {
    x: clampedX / width,
    y: clampedY / height,
    width: clampedW / width,
    height: clampedH / height,
  };
}

/**
 * The cloth's one colour, when it has no pattern. Folds and shine stay close to its middle brightness
 * and a bit of backdrop is only a small part of the piece; a pattern's colours are far apart.
 */
function plainColour({ data, width }: PhotoPixels, cloth: { x: number; y: number; width: number; height: number }): Rgb | null {
  const pixels: Rgb[] = [];
  for (let y = cloth.y; y < cloth.y + cloth.height; y += 1) {
    for (let x = cloth.x; x < cloth.x + cloth.width; x += 1) {
      const i = (y * width + x) * 4;
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  const brightness = (c: Rgb) => c[0] + c[1] + c[2];
  const sorted = pixels.map(brightness).sort((a, b) => a - b);
  const middle = sorted[sorted.length >> 1];
  const isClose = (c: Rgb) => Math.abs(brightness(c) - middle) <= PLAIN_BAND;
  const close = pixels.filter(isClose);
  if (close.length < pixels.length * PLAIN_SHARE) return null;
  // A pattern's far colours run across the cloth in bands; the gap between two legs only runs up and down.
  let bandRows = 0;
  for (let row = 0; row < cloth.height; row += 1) {
    let far = 0;
    for (let col = 0; col < cloth.width; col += 1) if (!isClose(pixels[row * cloth.width + col])) far += 1;
    if (far > cloth.width * 0.5) bandRows += 1;
  }
  if (bandRows > cloth.height * PATTERN_ROWS) return null;
  let bandColumns = 0;
  for (let col = 0; col < cloth.width; col += 1) {
    let far = 0;
    for (let row = 0; row < cloth.height; row += 1) if (!isClose(pixels[row * cloth.width + col])) far += 1;
    if (far > cloth.height * 0.5) bandColumns += 1;
  }
  if (bandColumns > cloth.width * PATTERN_COLUMNS) return null;
  const sum = close.reduce<Rgb>((total, c) => [total[0] + c[0], total[1] + c[1], total[2] + c[2]], [0, 0, 0]);
  return [sum[0] / close.length, sum[1] / close.length, sum[2] / close.length];
}

/** The uniform in the photo, or null when no pant, skirt or dress can be told apart. */
export function detectUniform(photo: PhotoPixels, gender: UniformGender): Detection | null {
  const { data, width, height } = photo;
  const parts = findParts(findForeground(photo), width, height);
  const pieces = parts.flatMap((part) => splitOutfits(part, width)).filter((p) => p.pixels.length >= width * height * MIN_PART);
  // In a flat-lay the top lies above its bottom garment: a piece with a big piece under it isn't the bottom.
  const lowest = pieces.filter((p) => !pieces.some((q) => q !== p && q.top > p.bottom - (p.bottom - p.top) * 0.15 && q.left < p.right && q.right > p.left && q.pixels.length >= p.pixels.length * 0.25));
  const outfits = lowest.map((p) => readOutfit(photo, p));
  if (!outfits.length) return null;
  const wanted = gender === 'BOY';
  // A flat-lay's shoes and socks are small; among real garments, the kind this set is for comes first.
  const chosen = [...outfits]
    .map((outfit) => ({ outfit, score: outfit.part.pixels.length * (outfit.isPant === wanted ? 100 : 1) * (outfit.part.bottom - outfit.part.top > height * 0.3 ? 1 : 0.001) }))
    .sort((a, b) => b.score - a.score)[0].outfit;

  const cloth = findCloth(photo, chosen);
  if (!cloth) return null;

  const span = chosen.part.bottom - chosen.part.top;
  let topPixels: number[] = [];
  for (const [y, row] of chosen.rows) if (y < chosen.waist) topPixels = topPixels.concat(row);
  const garmentStartsAtTop = chosen.waist - chosen.part.top < span * 0.08;
  if (garmentStartsAtTop) {
    // A flat-lay: the top lies apart, above the bottom garment and in line with it.
    const centre = (chosen.part.left + chosen.part.right) / 2;
    const above = parts
      .filter((p) => p.bottom <= chosen.part.top + span * 0.2 && p.pixels.length >= chosen.part.pixels.length * 0.25)
      .sort((a, b) => Math.abs((a.left + a.right) / 2 - centre) - Math.abs((b.left + b.right) / 2 - centre))[0];
    topPixels = above?.pixels ?? [];
  }
  // No separate top, or a top of the same cloth: one garment such as a dress.
  const clothBins = new Set<number>();
  for (let y = cloth.y; y < cloth.y + cloth.height; y += 1) {
    for (let x = cloth.x; x < cloth.x + cloth.width; x += 1) {
      const i = (y * width + x) * 4;
      clothBins.add(binOf(data[i], data[i + 1], data[i + 2]));
    }
  }
  const sameCloth = topPixels.filter((p) => clothBins.has(binOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]))).length;
  const onePiece = !chosen.isPant && (!topPixels.length || sameCloth > topPixels.length * 0.35);
  const plain = plainColour(photo, cloth);
  const topDetails = readTop(data, topPixels);
  const badge = findBadge(photo, topPixels, topDetails.top);
  const trackPant = findPiping(photo, chosen, plain);
  return {
    plain,
    cloth: { x: cloth.x / width, y: cloth.y / height, width: cloth.width / width, height: cloth.height / height },
    garmentWidth: hipWidth(chosen) / width,
    ...topDetails,
    badge,
    trackPant,
    onePiece,
  };
}
