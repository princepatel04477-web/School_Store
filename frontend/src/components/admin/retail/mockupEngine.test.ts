import { describe, expect, it } from 'vitest';
import { compose, flattenLight, makePlainIfEven } from './mockupEngine';

const pixels = (...rows: number[][]) => new Uint8ClampedArray(rows.flat());

describe('compose', () => {
  it('leaves everything outside the mask untouched', () => {
    const model = pixels([200, 180, 160, 255], [100, 100, 100, 255]);
    compose(model, model.slice(), pixels([0, 0, 0, 255], [255, 255, 255, 255]), pixels([10, 20, 30, 255], [10, 20, 30, 255]));
    expect(Array.from(model.slice(0, 4))).toEqual([200, 180, 160, 255]);
  });

  it('lights the cloth by the old garment relative to its median', () => {
    const model = pixels([100, 100, 100, 255], [100, 100, 100, 255], [50, 50, 50, 255]);
    const mask = pixels([255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]);
    const cloth = pixels([80, 80, 80, 255], [80, 80, 80, 255], [80, 80, 80, 255]);
    compose(model, model.slice(), mask, cloth);
    expect(model[0]).toBe(80); // at the median: the cloth's own colour
    expect(model[8]).toBe(40); // a fold half as bright
  });

  it('blends soft mask edges', () => {
    const model = pixels([200, 200, 200, 255], [200, 200, 200, 255], [200, 200, 200, 255]);
    const mask = pixels([255, 255, 255, 255], [255, 255, 255, 255], [128, 128, 128, 255]);
    compose(model, model.slice(), mask, pixels([0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]));
    expect(model[8]).toBeGreaterThan(90);
    expect(model[8]).toBeLessThan(110);
  });
});

describe('flattenLight', () => {
  it('evens out shadow and keeps the average colour', () => {
    const cloth = pixels([40, 40, 40, 255], [80, 80, 80, 255]);
    flattenLight(cloth, pixels([40, 40, 40, 255], [80, 80, 80, 255]));
    expect(cloth[0]).toBe(60);
    expect(cloth[4]).toBe(60);
  });

  it('keeps a pattern finer than the light', () => {
    const cloth = pixels([20, 20, 20, 255], [100, 100, 100, 255]);
    flattenLight(cloth, pixels([60, 60, 60, 255], [60, 60, 60, 255]));
    expect(cloth[0]).toBe(20);
    expect(cloth[4]).toBe(100);
  });
});

describe('makePlainIfEven', () => {
  it('turns a creased plain cloth into one colour', () => {
    const cloth = pixels([30, 30, 60, 255], [40, 40, 70, 255]);
    makePlainIfEven(cloth);
    expect(Array.from(cloth)).toEqual([35, 35, 65, 255, 35, 35, 65, 255]);
  });

  it('leaves a pattern alone', () => {
    const cloth = pixels([20, 30, 90, 255], [220, 220, 220, 255]);
    makePlainIfEven(cloth);
    expect(Array.from(cloth)).toEqual([20, 30, 90, 255, 220, 220, 220, 255]);
  });
});
