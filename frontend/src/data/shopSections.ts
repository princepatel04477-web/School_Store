import { isCategoryLive } from './liveCategories';

export function isShopProductVisible(product: { category: string; name: string }): boolean {
  if (!isCategoryLive(shopSection(product))) return false;
  return product.category !== 'Uniform Accessories' || !/\byellow\b/i.test(product.name);
}

export function shopSection(product: { category: string; name: string }): string {
  if (product.category === 'Uniform' && /\b(pt|p\.?e\.?|sports(?:wear)?|house (?:polo|t-shirt)|track pants?)\b/i.test(product.name)) return 'PT Uniform';
  return product.category;
}

// Each unisex KV garment has a second portrait for the other section.
const alternatePortraits: Record<string, 'boy' | 'girl'> = {
  'belt-knitted': 'girl', 'house-tshirt-red': 'girl', 'house-tshirt-blue': 'boy',
  'house-tshirt-green': 'girl', 'house-tshirt-yellow': 'boy', 'socks-grey': 'boy',
  'socks-navy': 'girl', 'hooded-jacket-full': 'boy', 'hooded-jacket-half': 'girl',
  'track-pant-navy': 'girl', 'coatie-grey': 'boy', 'sweater-v-neck': 'girl',
};

export function sectionPhoto(url?: string | null, gender?: 'boy' | 'girl' | null): string | undefined {
  if (!url || !gender) return url || undefined;
  return url.replace(/(\/products\/kv-)([\w-]+?)(-400)?\.webp(?=[?#]|$)/, (original, prefix, item, thumb) =>
    alternatePortraits[item] === gender ? `${prefix}${item}-${gender}${thumb || ''}.webp` : original);
}
