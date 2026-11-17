import { api } from '../api';
import type { CartItem } from '../store/storeState';

export interface PriceChange {
  item: CartItem;
  oldPricePaise: number;
  newPricePaise: number;
}

export interface StockChange {
  item: CartItem;
  requestedQty: number;
  availableQty: number;
}

export interface CartValidationResult {
  hasChanges: boolean;
  priceChanges: PriceChange[];
  stockChanges: StockChange[];
}

/**
 * Re-validates cart items against fresh server data before payment.
 * Returns any price changes or stock shortages detected.
 */
export async function revalidateCart(cart: CartItem[]): Promise<CartValidationResult> {
  const result: CartValidationResult = {
    hasChanges: false,
    priceChanges: [],
    stockChanges: [],
  };

  if (!cart || cart.length === 0) {
    return result;
  }

  try {
    // Fetch fresh product variants or products from public catalogue
    const res = await api<{ results?: any[]; items?: any[] }>('/public/products/').catch(() => null);
    const products = res?.results || res?.items || (Array.isArray(res) ? res : []);

    const variantMap = new Map<string, { pricePaise: number; inStock: boolean }>();

    for (const p of products) {
      if (Array.isArray(p.variants)) {
        for (const v of p.variants) {
          const sellingPaise = Math.round(parseFloat(v.selling_price || p.selling_price || '0') * 100);
          variantMap.set(v.id, {
            pricePaise: sellingPaise,
            inStock: v.in_stock !== false,
          });
        }
      }
    }

    for (const item of cart) {
      const serverVariant = variantMap.get(item.variantId);
      if (serverVariant) {
        // Price change detection
        if (serverVariant.pricePaise > 0 && serverVariant.pricePaise !== item.pricePaise) {
          result.priceChanges.push({
            item,
            oldPricePaise: item.pricePaise,
            newPricePaise: serverVariant.pricePaise,
          });
          result.hasChanges = true;
        }

        // Out of stock detection
        if (!serverVariant.inStock) {
          result.stockChanges.push({
            item,
            requestedQty: item.quantity,
            availableQty: 0,
          });
          result.hasChanges = true;
        }
      }
    }
  } catch (err) {
    console.warn('Cart re-validation skipped or failed:', err);
  }

  return result;
}
