/** Photos for the five shop categories, used by the home tiles and the shop's category tabs. */
export const CATEGORY_PHOTOS: Record<string, string> = {
  Uniform: '/products/cat-uniform.webp',
  'School Shoes': '/products/shoes-dps-oxford.webp',
  'Uniform Accessories': '/products/cat-accessories.webp',
  Stationery: '/products/cat-notebooks.webp',
  'ID Cards': '/products/idcard.webp',
};

/** A product photo to show if a category photo is missing. */
export const CATEGORY_FALLBACK_PHOTOS: Record<string, string> = {
  Uniform: '/products/uniform-dps-shirt.webp',
  'Uniform Accessories': '/products/tie-udgam-crest.webp',
  Stationery: '/products/notebook-photo.webp',
};
