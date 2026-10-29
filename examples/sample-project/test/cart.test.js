import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, cartTotal, applyDiscount } from '../src/cart.js';
import { store } from '../src/store.js';

beforeEach(() => store.clear());

test('cart total sums items', () => {
  addItem('c1', 'a', 2, 5);
  addItem('c1', 'b', 1, 10);
  assert.equal(cartTotal('c1'), 20);
});

test('discount applies a percentage', () => {
  assert.equal(applyDiscount(200, 25), 150);
});
