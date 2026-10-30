import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRun } from '../src/invariants/check.ts';
import type { RunRecord } from '../src/traffic/scenarios.ts';

const cap = (id: string) => ({ id, status: 'COMPLETED' as const, amount: '1.00' as const });

function record(over: Partial<Pick<RunRecord, 'paypal' | 'shop'>>): RunRecord {
  return {
    scenario: 'A1', variant: 'test', seed: 0, params: {}, log: [], outcomes: [],
    paypal: { orders: [{ id: 'ORD-1', status: 'COMPLETED', amount: '1.00', captures: [cap('CAP-1')] }], events: [] },
    shop: {
      orders: [{ id: 1, paypal_order_id: 'ORD-1', sku: 'SKU-1', status: 'PAID' }],
      grants: [{ id: 1, paypal_order_id: 'ORD-1', sku: 'SKU-1', capture_id: 'CAP-1' }],
    },
    ...over,
  };
}

const verdict = (r: RunRecord, id: string) => checkRun(r).find((v) => v.id === id)!.result;

test('a clean run passes all four invariants', () => {
  assert.deepEqual(checkRun(record({})).map((v) => [v.id, v.result]), [['I1', 'PASS'], ['I2', 'PASS'], ['I3', 'PASS'], ['I4', 'PASS']]);
});

test('I1 fails when a grant has no COMPLETED capture behind it', () => {
  const r = record({ shop: { orders: [{ id: 1, paypal_order_id: 'ORD-1', sku: 'SKU-1', status: 'PAID' }], grants: [{ id: 1, paypal_order_id: 'ORD-1', sku: 'SKU-1', capture_id: 'CAP-9' }] } });
  assert.equal(verdict(r, 'I1'), 'FAIL');
});

test('I1 is UNKNOWN, never PASS, when PayPal facts are missing', () => {
  assert.equal(verdict(record({ paypal: { orders: [], events: [] } }), 'I1'), 'UNKNOWN');
});

test('I2 fails on two grants for one PayPal order and SKU', () => {
  const g = { paypal_order_id: 'ORD-1', sku: 'SKU-1', capture_id: 'CAP-1' };
  const r = record({ shop: { orders: [{ id: 1, paypal_order_id: 'ORD-1', sku: 'SKU-1', status: 'PAID' }], grants: [{ id: 1, ...g }, { id: 2, ...g }] } });
  assert.equal(verdict(r, 'I2'), 'FAIL');
});

test('I3 fails on duplicate shop orders and on a paid PayPal order with no shop order', () => {
  const dup = record({ shop: { orders: [1, 2].map((id) => ({ id, paypal_order_id: 'ORD-1', sku: 'SKU-1', status: 'PAID' as const })), grants: [] } });
  assert.equal(verdict(dup, 'I3'), 'FAIL');
  assert.equal(verdict(record({ shop: { orders: [], grants: [] } }), 'I3'), 'FAIL');
});

test('I4 fails when the shop says FAILED but PayPal captured', () => {
  const r = record({ shop: { orders: [{ id: 1, paypal_order_id: 'ORD-1', sku: 'SKU-1', status: 'FAILED' }], grants: [] } });
  assert.equal(verdict(r, 'I4'), 'FAIL');
});

test('I4 fails on two captures for one order and is UNKNOWN for an order PayPal does not report', () => {
  const two = record({ paypal: { orders: [{ id: 'ORD-1', status: 'COMPLETED', amount: '1.00', captures: [cap('CAP-1'), cap('CAP-2')] }], events: [] } });
  assert.equal(verdict(two, 'I4'), 'FAIL');
  assert.equal(verdict(record({ paypal: { orders: [], events: [] } }), 'I4'), 'UNKNOWN');
});
