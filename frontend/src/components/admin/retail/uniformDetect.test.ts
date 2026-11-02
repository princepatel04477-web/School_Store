import { describe, expect, it } from 'vitest';
import { detectUniform, type PhotoPixels } from './uniformDetect';

type Rect = [x: number, y: number, w: number, h: number, rgb: [number, number, number]];

const W = 300;
const H = 400;
const WHITE: [number, number, number] = [245, 245, 245];
const NAVY: [number, number, number] = [25, 35, 70];
const YELLOW: [number, number, number] = [235, 215, 40];
const MAROON: [number, number, number] = [110, 25, 40];

function photo(background: [number, number, number], rects: Rect[]): PhotoPixels {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p += 1) data.set([...background, 255], p * 4);
  for (const [x, y, w, h, rgb] of rects) {
    for (let r = y; r < y + h; r += 1) for (let c = x; c < x + w; c += 1) data.set([...rgb, 255], (r * W + c) * 4);
  }
  return { data, width: W, height: H };
}

const flare = (x: number, y: number, h: number, rgb: [number, number, number]): Rect[] =>
  Array.from({ length: h }, (_, i): Rect => [x - Math.round(i / 5), y + i, 70 + 2 * Math.round(i / 5), 1, rgb]);

/** The patch of the photo the detector took as cloth, as its centre pixel. */
function clothColour(p: PhotoPixels, cloth: { x: number; y: number; width: number; height: number }) {
  const x = Math.round((cloth.x + cloth.width / 2) * p.width);
  const y = Math.round((cloth.y + cloth.height / 2) * p.height);
  return Array.from(p.data.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 3));
}

describe('detectUniform', () => {
  const polo = photo(WHITE, [
    [90, 30, 120, 150, YELLOW],
    [90, 180, 50, 200, NAVY],
    [160, 180, 50, 200, NAVY],
    [140, 180, 20, 60, NAVY],
  ]);

  it('never takes the shirt as the cloth', () => {
    const found = detectUniform(polo, 'BOY');
    expect(found && clothColour(polo, found.cloth)).toEqual(NAVY);
    expect(found?.top?.[0]).toBeGreaterThan(200);
  });

  it('finds a top lying apart from the pant in a flat-lay', () => {
    const flat = photo(WHITE, [
      [90, 10, 120, 110, YELLOW],
      [90, 140, 50, 240, NAVY],
      [160, 140, 50, 240, NAVY],
      [140, 140, 20, 80, NAVY],
    ]);
    const found = detectUniform(flat, 'BOY');
    expect(found && clothColour(flat, found.cloth)).toEqual(NAVY);
    expect(found?.top?.[0]).toBeGreaterThan(200);
  });

  it('picks the garment for the set when a photo shows two outfits', () => {
    const two = photo(WHITE, [
      [20, 40, 100, 100, YELLOW],
      ...flare(35, 140, 180, MAROON),
      [175, 40, 100, 100, YELLOW],
      [175, 140, 45, 240, NAVY],
      [230, 140, 45, 240, NAVY],
      [220, 140, 10, 70, NAVY],
    ]);
    const boy = detectUniform(two, 'BOY');
    const girl = detectUniform(two, 'GIRL');
    expect(boy && clothColour(two, boy.cloth)).toEqual(NAVY);
    expect(girl && clothColour(two, girl.cloth)).toEqual(MAROON);
  });

  it('reads plain cloth as one colour even with backdrop between the legs', () => {
    const found = detectUniform(polo, 'BOY');
    expect(found?.plain?.[2]).toBeGreaterThan(50);
    expect(found?.plain?.[0]).toBeLessThan(60);
  });

  it('leaves a white top to the model', () => {
    const shirt = photo([120, 125, 135], [
      [90, 30, 120, 150, [240, 240, 240]],
      [90, 180, 50, 200, NAVY],
      [160, 180, 50, 200, NAVY],
      [140, 180, 20, 60, NAVY],
    ]);
    expect(detectUniform(shirt, 'BOY')?.top).toBeNull();
  });

  it('finds nothing in an empty photo', () => {
    expect(detectUniform(photo([200, 200, 200], []), 'BOY')).toBeNull();
  });
});
