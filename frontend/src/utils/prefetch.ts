/**
 * Prefetching utilities to boost perceived speed.
 * Triggers lazy bundles & query cache warmups on pointer hover.
 */

export const prefetchFlowPage = () => {
  import('../pages/SelectionFlowPage');
};

export const prefetchCheckoutPage = () => {
  import('../pages/CheckoutPage');
};

export const prefetchBagDrawer = () => {
  import('../components/cart/BagDrawer');
};

export const prefetchSchoolData = (_schoolId: string) => {
  // Preloads the seed / products chunk
  import('../data/seedData');
};
