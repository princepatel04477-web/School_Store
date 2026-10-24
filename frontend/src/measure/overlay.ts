import { MASK_BODY_MIN } from './config';
import type { Mask, ShoulderCorners } from './measureBody';

/**
 * Points along the edge of the body outline, every `step` pixels of the mask:
 * a body pixel with a non-body pixel `step` away on any side. Every other one
 * is kept, so the line reads as dotted.
 */
export function outlineDots(mask: Mask, step: number): [number, number][] {
  const { width, height, data } = mask;
  const body = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] >= MASK_BODY_MIN;
  const dots: [number, number][] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!body(x, y)) continue;
      const edge = !body(x - step, y) || !body(x + step, y) || !body(x, y - step) || !body(x, y + step);
      if (edge && ((x + y) / step) % 2 === 0) dots.push([x, y]);
    }
  }
  return dots;
}

export interface OverlayColours {
  /** A thin dark rim around each dot, so the line shows on light walls too. */
  rim: string;
  line: string;
  ready: string;
  marker: string;
}

/**
 * Draws the live dotted outline around the person and, when found, the two
 * shoulder points with the line between them: what the reading is taken from.
 * The canvas is sized to the mask and stretched over the video by CSS.
 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  mask: Mask | null,
  corners: ShoulderCorners | null,
  ready: boolean,
  colours: OverlayColours,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (!mask) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (canvas.width !== mask.width || canvas.height !== mask.height) {
    canvas.width = mask.width;
    canvas.height = mask.height;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const step = Math.max(2, Math.round(mask.width / 160));
  const dot = Math.max(2, Math.round(mask.width / 200));
  const dots = outlineDots(mask, step);
  ctx.fillStyle = colours.rim;
  for (const [x, y] of dots) ctx.fillRect(x - dot / 2 - 1, y - dot / 2 - 1, dot + 2, dot + 2);
  ctx.fillStyle = ready ? colours.ready : colours.line;
  for (const [x, y] of dots) ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);

  if (!corners) return;
  const lx = corners.left.x * mask.width;
  const ly = corners.left.y * mask.height;
  const rx = corners.right.x * mask.width;
  const ry = corners.right.y * mask.height;
  ctx.strokeStyle = colours.rim;
  ctx.lineWidth = Math.max(4, mask.width / 150);
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.stroke();
  ctx.strokeStyle = colours.marker;
  ctx.lineWidth = Math.max(2, mask.width / 300);
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.stroke();
  const r = Math.max(4, mask.width / 90);
  for (const [x, y] of [
    [lx, ly],
    [rx, ry],
  ]) {
    ctx.fillStyle = colours.rim;
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colours.marker;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
