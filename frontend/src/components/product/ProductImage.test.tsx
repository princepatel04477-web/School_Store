// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ProductImage, frameForImage } from './ProductImage';

afterEach(cleanup);

function loadImage(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
  fireEvent.load(img);
}

describe('ProductImage', () => {
  it('shimmers until the photo has loaded', () => {
    const { container } = render(
      <ProductImage id="p1" name="Belt" category="Uniform Accessories" imageUrl="/products/belt.webp" />
    );
    expect(container.querySelector('.skeleton-box')).not.toBeNull();
    loadImage(container.querySelector('img')!, 800, 800);
    expect(container.querySelector('.skeleton-box')).toBeNull();
  });

  it('shows a square close-up whole inside a tall list frame', () => {
    const { container } = render(
      <ProductImage id="p2" name="Belt" category="Uniform Accessories" imageUrl="/products/belt.webp" frame="portrait" />
    );
    const box = container.querySelector('.product-image-container') as HTMLElement;
    const img = container.querySelector('img')!;
    expect(box.style.aspectRatio).toBe('2 / 3');
    loadImage(img, 800, 800);
    expect(img.style.objectFit).toBe('contain');
  });

  it('fills the frame when the photo already has its shape', () => {
    const { container } = render(
      <ProductImage id="p3" name="Shirt" category="Uniform" imageUrl="/products/kv-shirt.webp" frame="portrait" />
    );
    const img = container.querySelector('img')!;
    loadImage(img, 400, 600);
    expect(img.style.objectFit).toBe('cover');
  });

  it('treats KV child portraits as tall and everything else as square', () => {
    expect(frameForImage('/products/kv-belt-knitted-400.webp')).toBe('portrait');
    expect(frameForImage('/products/belt-elastic-standard.webp')).toBe('square');
    expect(frameForImage(undefined)).toBe('square');
  });
});
