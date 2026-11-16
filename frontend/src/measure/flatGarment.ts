/**
 * Pure 2D projective geometry and on-phone rectangle detection for measuring a
 * flat shirt or trouser laid beside a standard card (ISO ID-1) or an A4 sheet.
 *
 * Because the reference rectangle and the flat cloth sit on the same plane, a
 * 4-corner homography removes camera distance, focal length, and tilt error.
 */

export type ReferenceKind = 'card' | 'a4';

export interface Point2D {
  x: number;
  y: number;
}

/** Four corners in clockwise image order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point2D, Point2D, Point2D, Point2D];

/** Row-major 3x3 homography mapping image pixels (x, y) to plane centimetres (X, Y). */
export type Homography = [number, number, number, number, number, number, number, number, number];

export interface GarmentPins {
  shoulder: [Point2D, Point2D];
  chest: [Point2D, Point2D];
  length: [Point2D, Point2D];
}

export interface GarmentMeasureResult {
  /** Seam-to-seam shoulder width (or waist width on trousers), in cm. */
  shoulder_cm: number;
  /** Pit-to-pit flat half-chest width, in cm. */
  chest_flat_cm: number;
  /** Full garment chest circumference (2 x pit-to-pit), in cm. */
  chest_around_cm: number;
  /** Collar seam to bottom hem length, in cm. */
  length_cm: number;
  reference: ReferenceKind;
}

/** Exact ISO standard dimensions in centimetres (long side, short side). */
export const REFERENCE_CM: Record<ReferenceKind, { longCm: number; shortCm: number }> = {
  // ISO/IEC 7810 ID-1: ATM, Debit, Credit, PVC Aadhaar, PAN, Driving Licence, Metro card.
  card: { longCm: 8.56, shortCm: 5.398 },
  // ISO 216 A4 printer sheet.
  a4: { longCm: 29.7, shortCm: 21.0 },
};

export function dist2D(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Orders any 4 points clockwise starting from top-left in image coordinates (y down). */
export function orderQuadClockwise(points: [Point2D, Point2D, Point2D, Point2D]): Quad {
  const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
  const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // Rotate so index 0 has the smallest (x + y), i.e. top-left.
  let start = 0;
  let bestSum = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const s = sorted[i].x + sorted[i].y;
    if (s < bestSum) {
      bestSum = s;
      start = i;
    }
  }
  return [
    sorted[start],
    sorted[(start + 1) % 4],
    sorted[(start + 2) % 4],
    sorted[(start + 3) % 4],
  ];
}

/** Signed polygon area (> 0 for clockwise in y-down screen coordinates). */
export function quadArea(q: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Checks that the 4 corners form a non-degenerate convex quadrilateral big enough to calibrate from. */
export function isValidQuad(q: Quad, minEdgePx = 12): boolean {
  for (let i = 0; i < 4; i += 1) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
    if (dist2D(a, b) < minEdgePx) return false;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    // Strict clockwise convexity in screen coordinates (y down -> cross > 0).
    if (cross <= 1) return false;
  }
  const horiz = (dist2D(q[0], q[1]) + dist2D(q[3], q[2])) / 2;
  const vert = (dist2D(q[0], q[3]) + dist2D(q[1], q[2])) / 2;
  const ratio = Math.max(horiz, vert) / Math.max(1e-6, Math.min(horiz, vert));
  // Reject extreme sliver shapes (> 4:1) caused by dragging two corners almost onto a line.
  return ratio <= 4;
}

/** Solves an n x n linear system A x = b by Gaussian elimination with partial pivoting. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row) => [...row]);
  const b = [...rhs];
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-11) return null;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    const diag = a[col][col];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r][col] / diag;
      if (factor === 0) continue;
      for (let c = col; c < n; c += 1) a[r][c] -= factor * a[col][c];
      b[r] -= factor * b[col];
    }
  }
  return b.map((val, i) => val / a[i][i]);
}

function matMul3(a: Homography, b: Homography): Homography {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out as Homography;
}

/**
 * Computes the 3x3 homography mapping image pixels on the cloth plane into
 * rectified centimetres, automatically matching landscape vs portrait card/A4 orientation.
 */
export function computeHomography(quad: Quad, kind: ReferenceKind): Homography | null {
  const ordered = orderQuadClockwise(quad);
  if (!isValidQuad(ordered)) return null;

  const { longCm, shortCm } = REFERENCE_CM[kind];
  const horizPx = (dist2D(ordered[0], ordered[1]) + dist2D(ordered[3], ordered[2])) / 2;
  const vertPx = (dist2D(ordered[0], ordered[3]) + dist2D(ordered[1], ordered[2])) / 2;
  const widthCm = horizPx >= vertPx ? longCm : shortCm;
  const heightCm = horizPx >= vertPx ? shortCm : longCm;

  // Hartley coordinate normalization for numerical stability across phone resolutions.
  const meanX = (ordered[0].x + ordered[1].x + ordered[2].x + ordered[3].x) / 4;
  const meanY = (ordered[0].y + ordered[1].y + ordered[2].y + ordered[3].y) / 4;
  const meanDist =
    ordered.reduce((sum, p) => sum + Math.hypot(p.x - meanX, p.y - meanY), 0) / 4;
  if (meanDist < 1e-6) return null;
  const s = Math.SQRT2 / meanDist;
  const normSrc = ordered.map((p) => ({ x: (p.x - meanX) * s, y: (p.y - meanY) * s }));
  const dst: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0, y: 0 },
    { x: widthCm, y: 0 },
    { x: widthCm, y: heightCm },
    { x: 0, y: heightCm },
  ];

  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = normSrc[i];
    const { x: u, y: v } = dst[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const hNorm = solveLinear(rows, rhs);
  if (!hNorm) return null;
  const Hn: Homography = [hNorm[0], hNorm[1], hNorm[2], hNorm[3], hNorm[4], hNorm[5], hNorm[6], hNorm[7], 1];
  const T: Homography = [s, 0, -s * meanX, 0, s, -s * meanY, 0, 0, 1];
  const H = matMul3(Hn, T);
  if (Math.abs(H[8]) < 1e-12) return null;
  return H.map((v) => v / H[8]) as Homography;
}

/** Projects an image pixel (x, y) onto the rectified centimetre plane. */
export function projectToCm(h: Homography, p: Point2D): Point2D | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-7) return null;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Exact perspective-rectified physical distance in cm between two points on the garment plane. */
export function measureSegmentCm(h: Homography, a: Point2D, b: Point2D): number | null {
  const pa = projectToCm(h, a);
  const pb = projectToCm(h, b);
  if (!pa || !pb) return null;
  const d = dist2D(pa, pb);
  return Number.isFinite(d) && d > 0 && d < 250 ? Math.round(d * 10) / 10 : null;
}

/** Computes all garment dimensions in cm from the confirmed card/A4 quad and seam pins. */
export function measureGarment(
  quad: Quad,
  kind: ReferenceKind,
  pins: GarmentPins,
): GarmentMeasureResult | null {
  const h = computeHomography(quad, kind);
  if (!h) return null;
  const shoulder = measureSegmentCm(h, pins.shoulder[0], pins.shoulder[1]);
  const chestFlat = measureSegmentCm(h, pins.chest[0], pins.chest[1]);
  const length = measureSegmentCm(h, pins.length[0], pins.length[1]);
  if (shoulder == null || chestFlat == null || length == null) return null;
  return {
    shoulder_cm: shoulder,
    chest_flat_cm: chestFlat,
    chest_around_cm: Math.round(chestFlat * 2 * 10) / 10,
    length_cm: length,
    reference: kind,
  };
}

/** Default initial reference rectangle matching the central camera guide box. */
export function defaultReferenceQuad(width: number, height: number, kind: ReferenceKind): Quad {
  const { longCm, shortCm } = REFERENCE_CM[kind];
  const aspect = longCm / shortCm;
  const boxW = width * (kind === 'card' ? 0.28 : 0.36);
  const boxH = boxW / aspect;
  const cx = width * 0.5;
  const cy = height * 0.52;
  return [
    { x: Math.round(cx - boxW / 2), y: Math.round(cy - boxH / 2) },
    { x: Math.round(cx + boxW / 2), y: Math.round(cy - boxH / 2) },
    { x: Math.round(cx + boxW / 2), y: Math.round(cy + boxH / 2) },
    { x: Math.round(cx - boxW / 2), y: Math.round(cy + boxH / 2) },
  ];
}

/** Sensible starting seam pins on a flat shirt framed around the middle of the picture. */
export function defaultGarmentPins(width: number, height: number): GarmentPins {
  return {
    shoulder: [
      { x: Math.round(width * 0.25), y: Math.round(height * 0.24) },
      { x: Math.round(width * 0.75), y: Math.round(height * 0.24) },
    ],
    chest: [
      { x: Math.round(width * 0.22), y: Math.round(height * 0.42) },
      { x: Math.round(width * 0.78), y: Math.round(height * 0.42) },
    ],
    length: [
      { x: Math.round(width * 0.5), y: Math.round(height * 0.16) },
      { x: Math.round(width * 0.5), y: Math.round(height * 0.84) },
    ],
  };
}

/**
 * Fast on-phone detector for a rectangular card or A4 sheet placed near the middle
 * of the garment. Tests light-on-dark and dark-on-light contrast blobs at downsampled
 * resolution, returning the 4 corners in full-image pixel coordinates when confident.
 */
export function detectReferenceQuad(
  rgba: Uint8ClampedArray | Uint8Array,
  imageWidth: number,
  imageHeight: number,
  kind: ReferenceKind,
): Quad | null {
  if (imageWidth < 40 || imageHeight < 40 || rgba.length < imageWidth * imageHeight * 4) return null;
  const maxSide = 240;
  const step = Math.max(1, Math.floor(Math.max(imageWidth, imageHeight) / maxSide));
  const w = Math.floor(imageWidth / step);
  const h = Math.floor(imageHeight / step);
  if (w < 30 || h < 30) return null;

  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const srcRow = y * step * imageWidth;
    for (let x = 0; x < w; x += 1) {
      const idx = (srcRow + x * step) * 4;
      gray[y * w + x] = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
    }
  }

  // Central search zone (where the card/sheet sits on the garment).
  const xMin = Math.floor(w * 0.1);
  const xMax = Math.ceil(w * 0.9);
  const yMin = Math.floor(h * 0.1);
  const yMax = Math.ceil(h * 0.9);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = yMin; y < yMax; y += 1) {
    for (let x = xMin; x < xMax; x += 1) {
      const v = gray[y * w + x];
      sum += v;
      sumSq += v * v;
      count += 1;
    }
  }
  const mean = sum / Math.max(1, count);
  const std = Math.sqrt(Math.max(0, sumSq / Math.max(1, count) - mean * mean));
  if (std < 6) return null;

  const targetRatio = REFERENCE_CM[kind].longCm / REFERENCE_CM[kind].shortCm;
  const totalPx = w * h;
  const minArea = totalPx * 0.008;
  const maxArea = totalPx * 0.42;

  const angles = [0, 12, -12, 24, -24].map((deg) => (deg * Math.PI) / 180);
  let bestQuad: Quad | null = null;
  let bestScore = 0;

  const candidates: { bright: boolean; threshold: number }[] = [
    { bright: true, threshold: mean + 0.75 * std },
    { bright: true, threshold: mean + 1.15 * std },
    { bright: false, threshold: mean - 0.75 * std },
    { bright: false, threshold: mean - 1.15 * std },
  ];

  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);

  for (const { bright, threshold } of candidates) {
    visited.fill(0);
    for (let sy = yMin; sy < yMax; sy += 1) {
      for (let sx = xMin; sx < xMax; sx += 1) {
        const start = sy * w + sx;
        if (visited[start]) continue;
        const val = gray[start];
        if (bright ? val < threshold : val > threshold) continue;

        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        visited[start] = 1;
        let touchesBorder = false;
        const pixels: number[] = [];

        while (head < tail) {
          const cur = queue[head++];
          pixels.push(cur);
          const cy = Math.floor(cur / w);
          const cx = cur - cy * w;
          if (cx <= 1 || cx >= w - 2 || cy <= 1 || cy >= h - 2) touchesBorder = true;
          const neighbors = [cur - 1, cur + 1, cur - w, cur + w];
          for (const nb of neighbors) {
            if (nb < 0 || nb >= w * h || visited[nb]) continue;
            const ny = Math.floor(nb / w);
            const nx = nb - ny * w;
            if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
            const nv = gray[nb];
            if (bright ? nv >= threshold : nv <= threshold) {
              visited[nb] = 1;
              queue[tail++] = nb;
            }
          }
        }

        if (touchesBorder || pixels.length < minArea || pixels.length > maxArea) continue;

        // Find the tightest 4-corner extremal hull across small rotation angles.
        for (const theta of angles) {
          const ct = Math.cos(theta);
          const st = Math.sin(theta);
          let minUPlusV = Infinity;
          let maxUPlusV = -Infinity;
          let minUMinusV = Infinity;
          let maxUMinusV = -Infinity;
          let pTL = pixels[0];
          let pBR = pixels[0];
          let pBL = pixels[0];
          let pTR = pixels[0];

          for (const idx of pixels) {
            const py = Math.floor(idx / w);
            const px = idx - py * w;
            const u = px * ct + py * st;
            const v = -px * st + py * ct;
            const s1 = u + v;
            const s2 = u - v;
            if (s1 < minUPlusV) {
              minUPlusV = s1;
              pTL = idx;
            }
            if (s1 > maxUPlusV) {
              maxUPlusV = s1;
              pBR = idx;
            }
            if (s2 < minUMinusV) {
              minUMinusV = s2;
              pBL = idx;
            }
            if (s2 > maxUMinusV) {
              maxUMinusV = s2;
              pTR = idx;
            }
          }

          const toPt = (idx: number): Point2D => ({
            x: (idx % w) + 0.5,
            y: Math.floor(idx / w) + 0.5,
          });
          const quad = orderQuadClockwise([toPt(pTL), toPt(pTR), toPt(pBR), toPt(pBL)]);
          if (!isValidQuad(quad, 6)) continue;
          const area = quadArea(quad);
          if (area <= 0) continue;
          const rectangularity = pixels.length / area;
          if (rectangularity < 0.76 || rectangularity > 1.15) continue;

          const topEdge = dist2D(quad[0], quad[1]);
          const botEdge = dist2D(quad[3], quad[2]);
          const leftEdge = dist2D(quad[0], quad[3]);
          const rightEdge = dist2D(quad[1], quad[2]);
          const symmetry =
            Math.min(topEdge, botEdge) / Math.max(topEdge, botEdge) *
            (Math.min(leftEdge, rightEdge) / Math.max(leftEdge, rightEdge));
          if (symmetry < 0.72) continue;

          const horiz = (topEdge + botEdge) / 2;
          const vert = (leftEdge + rightEdge) / 2;
          const aspect = Math.max(horiz, vert) / Math.max(1e-6, Math.min(horiz, vert));
          const ratioErr = Math.abs(aspect - targetRatio) / targetRatio;
          if (ratioErr > 0.22) continue;

          const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
          const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
          const centerBias = 1 - 0.5 * Math.hypot(cx / w - 0.5, cy / h - 0.5);
          const score = rectangularity * symmetry * (1 - ratioErr) * centerBias;

          if (score > bestScore) {
            bestScore = score;
            bestQuad = quad.map((p) => ({
              x: Math.round(p.x * step * 10) / 10,
              y: Math.round(p.y * step * 10) / 10,
            })) as Quad;
          }
        }
      }
    }
  }

  return bestScore >= 0.52 ? bestQuad : null;
}
