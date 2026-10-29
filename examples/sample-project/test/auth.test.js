import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdmin, canRefund } from '../src/auth.js';

test('admin role is admin', () => assert.equal(isAdmin({ role: 'admin' }), true));
test('customer is not admin', () => assert.equal(isAdmin({ role: 'customer' }), false));
test('missing user is not admin', () => assert.equal(isAdmin(null), false));
test('customer can refund own order', () => assert.equal(canRefund({ id: 'u1', role: 'customer' }, { customer: 'u1' }), true));
test('customer cannot refund others', () => assert.equal(canRefund({ id: 'u2', role: 'customer' }, { customer: 'u1' }), false));
