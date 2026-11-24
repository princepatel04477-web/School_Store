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

// The shop shows one list in the order the client set, with no category bars:
// half sleeve shirt, full sleeve shirt, shorts or trousers, track pants, the PT
// T-shirts (blue, yellow, red, green), half sleeve sweater, full sleeve hoodie,
// tie, belt, shoes. Socks follow the shoes; anything else comes last.
const PT_HOUSE_COLOURS = ['blue', 'yellow', 'red', 'green'];
/** Tie, belt, shoes and socks rank from here on. */
export const ACCESSORY_RANK = 80;

export function shopOrderRank(product: { category: string; name: string }): number {
  const name = product.name.toLowerCase();
  if (product.category === 'School Shoes' || /\b(shoes?|oxfords?|sneakers?|footwear)\b/.test(name)) return 100;
  if (/\b(tie|necktie)\b/.test(name)) return ACCESSORY_RANK;
  if (/\bbelt\b/.test(name)) return 90;
  if (/\bsocks?\b/.test(name)) return 110;
  if (/\btrack\s*(pants?|suit)|\bjoggers?\b/.test(name)) return 40;
  if (/\bt-?shirt\b|\btee\b|\bpolo\b/.test(name)) return ptShirtRank(name);
  if (/\b(hood(ed|ie)?|jacket|sweaters?|cardigan|coatie|blazer|sweatshirt|pullover)\b/.test(name)) {
    const fullSleeve = /full[\s-]?sleeve/.test(name);
    if (/\bhood(ed|ie)?\b|\bjacket\b/.test(name)) return fullSleeve ? 70 : 60;
    if (/\bsweaters?\b|\bpullover\b/.test(name)) return fullSleeve ? 69 : 61;
    return /\bcoatie\b/.test(name) ? 62 : 63;
  }
  if (/\b(shirt|blouse|tunic|kurta|kameez|frock)\b/.test(name)) {
    return /\bwinter\b|full[\s-]?sleeve|long[\s-]?sleeve/.test(name) ? 20 : 10;
  }
  if (/\b(shorts|trousers?|pants?|skirt|pinafore|chinos?|salwar)\b/.test(name)) return 30;
  if (/\bleggings?\b/.test(name)) return 31;
  // The live store also names the house T-shirts "KV PT Uniform Blue" or "KV Uniform Yellow".
  if (/\bpt\b/.test(name) || houseIndex(name) >= 0) return ptShirtRank(name);
  return 200;
}

function houseIndex(name: string): number {
  return PT_HOUSE_COLOURS.findIndex((colour) => new RegExp(`\\b${colour}\\b`).test(name));
}

/** Blue, yellow, red, green; a PT shirt in another colour after them. */
function ptShirtRank(name: string): number {
  const house = houseIndex(name);
  return 50 + (house < 0 ? PT_HOUSE_COLOURS.length : house);
}

/** The shop's one list: a copy of the items in the fixed order above. */
export function inShopOrder<T extends { category: string; name: string }>(products: readonly T[]): T[] {
  return products
    .map((product, index) => ({ product, index, rank: shopOrderRank(product) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.product);
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
