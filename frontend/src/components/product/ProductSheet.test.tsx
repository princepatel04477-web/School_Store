// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ProductSheet } from './ProductSheet';
import type { CardProduct } from './ProductCard';

afterEach(cleanup);

const shirt = (gallery?: CardProduct['gallery']): CardProduct => ({
  id: 'shirt',
  name: 'KV Boys Summer Shirt (Class 1-5)',
  category: 'Uniform',
  categorySlug: 'uniform',
  descriptor: '',
  description: 'Check shirt',
  pricePaise: 1000,
  gender: 'boy',
  sizes: [{ id: 's22', size: '22', inStock: true }],
  imageUrl: '/products/plain/kv-boys-1-5-shirt-summer-400.webp',
  heroUrl: '/products/plain/kv-boys-1-5-shirt-summer.webp',
  gallery,
} as unknown as CardProduct);

describe('ProductSheet photos', () => {
  it('opens on the plain shot and swipes to the child wearing it', () => {
    const { container, getByLabelText } = render(
      <ProductSheet
        isOpen
        onClose={() => {}}
        product={shirt([
          { src: '/products/plain/kv-boys-1-5-shirt-summer.webp' },
          { src: '/products/kv-boys-1-5-shirt-summer.webp' },
        ])}
      />
    );
    const slides = [...container.querySelectorAll('.sheet-photos-slide img')].map((img) => img.getAttribute('src'));
    expect(slides).toEqual(['/products/plain/kv-boys-1-5-shirt-summer.webp', '/products/kv-boys-1-5-shirt-summer.webp']);
    expect(getByLabelText('Photo 1 of 2').getAttribute('aria-current')).toBe('true');
    fireEvent.click(getByLabelText('Photo 2 of 2'));
    expect(getByLabelText('Photo 2 of 2').getAttribute('aria-current')).toBe('true');
  });

  it('keeps one photo without dots when the item has one', () => {
    const { container } = render(
      <ProductSheet isOpen onClose={() => {}} product={shirt([{ src: '/products/kv-coatie-grey.webp' }])} />
    );
    expect(container.querySelector('.sheet-photos')).toBeNull();
    expect(container.querySelectorAll('.sheet-gallery-col img').length).toBeGreaterThan(0);
  });
});
