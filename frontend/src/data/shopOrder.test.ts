import { describe, expect, it } from 'vitest';
import { inShopOrder } from './shopSections';

const item = (name: string, category = 'Uniform') => ({ name, category });

describe('shop order', () => {
  it('puts the KV boys list in the client order', () => {
    const shuffled = [
      item('KV Navy Socks with Red Stripes (Pack of 2)', 'Uniform Accessories'),
      item('All-Weather Black Velcro School Shoes', 'School Shoes'),
      item('KV Green House PT T-Shirt (Class 1-5)'),
      item('KV Grey Hooded Jacket, Full Sleeve (Class 1-5)'),
      item('KV Knitted Belt with Monogram Buckle', 'Uniform Accessories'),
      item('KV Red House PT T-Shirt (Class 1-5)'),
      item('KV Boys Grey Shorts (Class 1-5)'),
      item('Standard Classic School Uniform Tie', 'Uniform Accessories'),
      item('KV Grey Hooded Jacket, Half Sleeve (Class 1-5)'),
      item('KV Yellow House PT T-Shirt (Class 1-5)'),
      item('KV Navy PT Track Pants (Class 1-5)'),
      item('KV Boys Winter Full-Sleeve Shirt (Class 1-12)'),
      item('KV Blue House PT T-Shirt (Class 1-5)'),
      item('KV Boys Summer Shirt (Class 1-5)'),
    ];
    expect(inShopOrder(shuffled).map((p) => p.name)).toEqual([
      'KV Boys Summer Shirt (Class 1-5)',
      'KV Boys Winter Full-Sleeve Shirt (Class 1-12)',
      'KV Boys Grey Shorts (Class 1-5)',
      'KV Navy PT Track Pants (Class 1-5)',
      'KV Blue House PT T-Shirt (Class 1-5)',
      'KV Yellow House PT T-Shirt (Class 1-5)',
      'KV Red House PT T-Shirt (Class 1-5)',
      'KV Green House PT T-Shirt (Class 1-5)',
      'KV Grey Hooded Jacket, Half Sleeve (Class 1-5)',
      'KV Grey Hooded Jacket, Full Sleeve (Class 1-5)',
      'Standard Classic School Uniform Tie',
      'KV Knitted Belt with Monogram Buckle',
      'All-Weather Black Velcro School Shoes',
      'KV Navy Socks with Red Stripes (Pack of 2)',
    ]);
  });

  it('places the live PT shirt names by house colour', () => {
    const order = inShopOrder([
      item('Standard Classic School Uniform Tie', 'Uniform Accessories'),
      item('KV PT Uniform Green'),
      item('KV Uniform Yellow'),
      item('KV Grey V-Neck Sweater (Class 1-12)'),
      item('KV PT Uniform Blue'),
      item('KV Navy PT Track Pants (Class 1-5)'),
    ]).map((p) => p.name);
    expect(order).toEqual([
      'KV Navy PT Track Pants (Class 1-5)',
      'KV PT Uniform Blue',
      'KV Uniform Yellow',
      'KV PT Uniform Green',
      'KV Grey V-Neck Sweater (Class 1-12)',
      'Standard Classic School Uniform Tie',
    ]);
  });

  it('keeps sweaters between the half and full sleeve hoodies, and girls tops first', () => {
    const order = inShopOrder([
      item('KV Grey Hooded Jacket, Full Sleeve (Class 6-12)'),
      item('KV Grey V-Neck Sweater (Class 1-12)'),
      item('KV Girls Grey Divided Skirt (Class 3-8)'),
      item('KV Girls Summer Shirt (Class 3-8)'),
      item('KV Grey Hooded Jacket, Half Sleeve (Class 6-12)'),
    ]).map((p) => p.name);
    expect(order).toEqual([
      'KV Girls Summer Shirt (Class 3-8)',
      'KV Girls Grey Divided Skirt (Class 3-8)',
      'KV Grey Hooded Jacket, Half Sleeve (Class 6-12)',
      'KV Grey V-Neck Sweater (Class 1-12)',
      'KV Grey Hooded Jacket, Full Sleeve (Class 6-12)',
    ]);
  });
});
