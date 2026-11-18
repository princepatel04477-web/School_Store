// Which product categories parents can shop right now.
// Notebooks (Stationery) and ID cards are paused for launch: their tiles, tabs, links
// and the "buy stationery?" question are hidden everywhere parents shop. The products,
// photos and ID card screens are all still in the code and the database.
// To bring one back, delete it from this list. Nothing else needs to change.
export const PAUSED_CATEGORIES: readonly string[] = ['Stationery', 'ID Cards'];

export const ALL_CATEGORIES = ['Uniform', 'School Shoes', 'Uniform Accessories', 'Stationery', 'ID Cards'] as const;

export type ShopCategory = (typeof ALL_CATEGORIES)[number];

export function isCategoryLive(category: string): boolean {
  return !PAUSED_CATEGORIES.includes(category);
}

export const LIVE_CATEGORIES: readonly ShopCategory[] = ALL_CATEGORIES.filter(isCategoryLive);
