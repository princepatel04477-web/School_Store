import { describe, expect, it } from 'vitest';
import { shopSection, sectionPhoto } from './shopSections';
import { uniformSizeGuide } from './sizes';

describe('uniform shopping sections', () => {
  it('separates PT shirts and track pants from daily uniforms and shoes', () => {
    for (const name of ['KV Blue House PT T-Shirt', 'KV Navy PT Track Pants']) {
      expect(shopSection({ category: 'Uniform', name })).toBe('PT Uniform');
    }
    expect(shopSection({ category: 'Uniform', name: 'KV Summer Shirt' })).toBe('Uniform');
    expect(shopSection({ category: 'School Shoes', name: 'PT Sports Shoes' })).toBe('School Shoes');
  });
  it('uses the selected portrait for both thumbnail and full size', () => {
    for (const suffix of ['.webp', '-400.webp?version=1']) {
      const base = '/products/kv-house-tshirt-red';
      expect(sectionPhoto(base + suffix, 'girl')).toBe(base + '-girl' + suffix);
      expect(sectionPhoto(base + suffix, 'boy')).toBe(base + suffix);
    }
  });
  it('retains the class default and smaller choices even when inventory is incomplete', () => {
    const variants = [{ id: 'v28', size: '28', inStock: true }];
    for (const [i, label] of ['24','26','28','30','32','34','34','34','34','34','34','34'].entries()) {
      const guide = uniformSizeGuide('Uniform', variants, 'Class ' + (i + 1))!;
      expect(guide.label).toBe(label);
      expect(guide.availableId).toBe(label === '28' ? 'v28' : undefined);
      if (i >= 2 && i <= 4) expect(guide.choices.map(s => s.size)).toEqual(expect.arrayContaining(['24','26','28']));
      expect(guide.choices.filter(s => s.inStock)).toEqual(variants);
    }
    expect(uniformSizeGuide('School Shoes', variants, 'Class 4')).toBeUndefined();
  });
});
