import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addItem } from '../src/cart.js';
import { placeOrder, listOrders } from '../src/orders.js';
import { store } from '../src/store.js';

beforeEach(() => store.clear());

test('placing an order records the cart total', () => {
  addItem('c1', 'a', 3, 4);
  assert.equal(placeOrder('o1', 'c1', 'u1').total, 12);
  assert.equal(listOrders().length, 1);
});
