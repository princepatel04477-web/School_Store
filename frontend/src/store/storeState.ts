import { useState, useEffect, type ReactNode } from 'react';
import type { Fit } from '../data/fit';
import { removeSaved } from './persist';

export interface CartItem {
  id: string; // product id + variant id
  productId: string;
  variantId: string;
  name: string;
  category: string;
  pricePaise: number;
  size: string;
  quantity: number;
  image?: string;
  schoolName?: string;
  className?: string;
  customisationData?: Record<string, any>;
  /** The child's measurement this line was sized from (shirts and trousers). */
  measurement?: Fit;
}

export interface StoredSelection {
  schoolId: string;
  schoolName: string;
  schoolCode?: string;
  cityId?: string;
  cityName?: string;
  stateName?: string;
  /** The campus picked in the shop (state, then city, then branch). */
  branchId?: string;
  branchName?: string;
  gradeId?: string;
  gradeName?: string;
  gender?: 'boy' | 'girl' | null;
}

const CART_STORAGE_KEY = 'schoolstore_cart';

// Start every full app load with an empty bag. Cart state remains available while the app
// is open, but stale items from an earlier visit must not be restored on refresh.
function loadStoredCart(): CartItem[] {
  removeSaved(CART_STORAGE_KEY);
  return [];
}

// Simple pub/sub store for Cart & Selection state across components.
// The chosen school, class and boy/girl are never written to disk: they live in memory only.
type Listener = () => void;
let cartState: CartItem[] = loadStoredCart();
let selectionState: StoredSelection | null = null;
let lastRemovedItem: { item: CartItem; index: number } | null = null;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export const storeState = {
  getCart: () => cartState,
  getSelection: () => selectionState,
  getLastRemoved: () => lastRemovedItem,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  setSelection: (sel: StoredSelection | null) => {
    selectionState = sel;
    notify();
  },

  addItem: (newItem: Omit<CartItem, 'id'>) => {
    // Every line says which child it is for, however it was added, so the bag can group them.
    const item = {
      schoolName: selectionState?.schoolName,
      className: selectionState?.gradeName,
      ...newItem,
    };
    const id = `${item.productId}_${item.variantId}_${JSON.stringify(item.customisationData || {})}`;
    const existingIndex = cartState.findIndex((c) => c.id === id);
    if (existingIndex > -1) {
      cartState = cartState.map((c, i) =>
        i === existingIndex ? { ...c, quantity: c.quantity + item.quantity } : c
      );
    } else {
      cartState = [...cartState, { ...item, id }];
    }
    notify();
  },

  updateQuantity: (id: string, qty: number) => {
    if (qty <= 0) {
      storeState.removeItem(id);
      return;
    }
    cartState = cartState.map((c) => (c.id === id ? { ...c, quantity: qty } : c));
    notify();
  },

  removeItem: (id: string) => {
    const idx = cartState.findIndex((c) => c.id === id);
    if (idx > -1) {
      lastRemovedItem = { item: cartState[idx], index: idx };
      cartState = cartState.filter((c) => c.id !== id);
      notify();
    }
  },

  undoRemove: () => {
    if (lastRemovedItem) {
      const { item, index } = lastRemovedItem;
      const copy = [...cartState];
      copy.splice(index, 0, item);
      cartState = copy;
      lastRemovedItem = null;
      notify();
    }
  },

  clearCart: () => {
    cartState = [];
    removeSaved(CART_STORAGE_KEY);
    notify();
  },

  mergeOnSignIn: (user?: { school?: { name: string } | string | null; school_name?: string | null; school_code?: string | null; city_name?: string | null }) => {
    if (!user) return;
    // If guest had no school selected, adopt user's school if present on account
    if (!selectionState && (user.school || user.school_name)) {
      const sName = typeof user.school === 'object' && user.school ? user.school.name : (user.school_name || String(user.school || ''));
      if (sName) {
        storeState.setSelection({
          schoolId: (typeof user.school === 'string' ? user.school : user.school_name) || 'account-school',
          schoolName: sName,
          schoolCode: user.school_code || undefined,
          cityName: user.city_name || undefined,
        });
      }
    }
    notify();
  },
};

export function useStoreState() {
  const [, setTick] = useState(0);

  useEffect(() => {
    return storeState.subscribe(() => setTick((t) => t + 1));
  }, []);

  const cart = storeState.getCart();
  const selection = storeState.getSelection();
  const lastRemoved = storeState.getLastRemoved();
  const totalCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const subtotalPaise = cart.reduce((acc, item) => acc + item.pricePaise * item.quantity, 0);

  return {
    cart,
    selection,
    lastRemoved,
    totalCount,
    subtotalPaise,
    setSelection: storeState.setSelection,
    addItem: storeState.addItem,
    updateQuantity: storeState.updateQuantity,
    removeItem: storeState.removeItem,
    undoRemove: storeState.undoRemove,
    clearCart: storeState.clearCart,
  };
}
