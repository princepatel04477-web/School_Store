import { classNumber } from './sizes';
import { isCategoryLive } from './liveCategories';

export function isShopProductVisible(product: { category: string; name: string }): boolean {
  if (!isCategoryLive(shopSection(product))) return false;
  return product.category !== 'Uniform Accessories' || !/\byellow\b/i.test(product.name);
}

export function shopSection(product: { category: string; name: string }): string {
  return product.category === 'PT Uniform' ? 'Uniform' : product.category;
}

export function isPtUniform(product: { category: string; name: string }): boolean {
  return product.category === 'PT Uniform' || (product.category === 'Uniform' && /\b(pt|p\.?e\.?|sports(?:wear)?|house (?:polo|t-shirt)|track pants?)\b/i.test(product.name));
}

// Each unisex KV garment has a second portrait for the other section.
const alternatePortraits: Record<string, 'boy' | 'girl'> = {
  'belt-knitted': 'girl', 'house-tshirt-red': 'girl', 'house-tshirt-blue': 'boy',
  'house-tshirt-green': 'girl', 'house-tshirt-yellow': 'boy', 'socks-grey': 'boy',
  'socks-navy': 'girl', 'hooded-jacket-full': 'boy', 'hooded-jacket-half': 'girl',
  'track-pant-navy': 'girl', 'coatie-grey': 'boy', 'sweater-v-neck': 'girl',
};

// Public catalog entries can also carry a class band in their product title.
export function matchesListedClass(name: string, className?: string): boolean {
  const band = /\(class(?:es)?\s+(\d+)(?:\s*[-–—]\s*(\d+))?\)/i.exec(name);
  if (!band) return true;
  const grade = classNumber(className);
  return grade !== null && grade >= Number(band[1]) && grade <= Number(band[2] || band[1]);
}

const sharedGradePortraits = new Set([
  'hooded-jacket-full', 'hooded-jacket-half', 'coatie-grey', 'sweater-v-neck',
  'belt-knitted', 'socks-grey', 'socks-navy', 'boys-shirt-winter',
  'boys-6-12-shirt-summer', 'boys-6-12-trousers',
]);
const middleGirlsPortraits = new Set([
  'girls-shirt-winter', 'girls-3-8-shirt-summer', 'girls-3-8-skirt', 'girls-leggings-grey',
]);

export function sectionPhoto(url?: string | null, gender?: 'boy' | 'girl' | null, className?: string): string | undefined {
  if (!url || !gender) return url || undefined;
  const grade = classNumber(className);
  return url.replace(/(\/products\/kv-)([\w-]+?)(-400)?\.webp(?=[?#]|$)/, (original, prefix, item, thumb) => {
    if (grade !== null && grade >= 6 && grade <= 12 &&
        (sharedGradePortraits.has(item) || (grade <= 8 && middleGirlsPortraits.has(item)))) {
      const band = grade <= 8 ? '6-8' : '9-12';
      return `${prefix}${item}-${gender}-${band}${thumb || ''}.webp`;
    }
    return alternatePortraits[item] === gender ? `${prefix}${item}-${gender}${thumb || ''}.webp` : original;
  });
}
