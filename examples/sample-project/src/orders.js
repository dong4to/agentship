import { store } from './store.js';
import { cartTotal } from './cart.js';

export function placeOrder(orderId, cartId, customer) {
  const order = { id: orderId, customer, total: cartTotal(cartId), createdAt: new Date(0).toISOString() };
  store.set('orders', orderId, order);
  return order;
}

export function listOrders() {
  return store.all('orders');
}
