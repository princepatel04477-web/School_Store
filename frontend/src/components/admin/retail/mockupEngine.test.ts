import { describe, expect, it } from 'vitest';
import { compose } from './mockupEngine';

const pixels = (...rows: number[][]) => new Uint8ClampedArray(rows.flat());

describe('compose', () => {
  it('leaves everything outside the mask untouched', () => {
    const model = pixels([200, 180, 160, 255], [100, 100, 100, 255]);
    compose(model, pixels([0, 0, 0, 255], [255, 255, 255, 255]), pixels([10, 20, 30, 255], [10, 20, 30, 255]));
    expect(Array.from(model.slice(0, 4))).toEqual([200, 180, 160, 255]);
  });

  it('lights the cloth by the old garment relative to its median', () => {
    const model = pixels([100, 100, 100, 255], [100, 100, 100, 255], [50, 50, 50, 255]);
    const mask = pixels([255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]);
    const cloth = pixels([80, 80, 80, 255], [80, 80, 80, 255], [80, 80, 80, 255]);
    compose(model, mask, cloth);
    expect(model[0]).toBe(80); // at the median: the cloth's own colour
    expect(model[8]).toBe(40); // a fold half as bright
  });

  it('blends soft mask edges', () => {
    const model = pixels([200, 200, 200, 255], [200, 200, 200, 255], [200, 200, 200, 255]);
    const mask = pixels([255, 255, 255, 255], [255, 255, 255, 255], [128, 128, 128, 255]);
    compose(model, mask, pixels([0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]));
    expect(model[8]).toBeGreaterThan(90);
    expect(model[8]).toBeLessThan(110);
  });
});
