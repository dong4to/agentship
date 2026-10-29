import { store } from './store.js';

export function addItem(cartId, sku, qty, price) {
  const cart = store.get('carts', cartId) ?? { items: [] };
  cart.items.push({ sku, qty, price });
  store.set('carts', cartId, cart);
  return cart;
}

export function cartTotal(cartId) {
  const cart = store.get('carts', cartId) ?? { items: [] };
  return cart.items.reduce((sum, i) => sum + i.qty * i.price, 0);
}

// Known bug (SMALL task): pct outside 0..100 is not clamped.
export function applyDiscount(total, pct) {
  return total - (total * pct) / 100;
}
