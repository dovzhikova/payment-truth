import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runA1, runA2, runA3 } from '../src/traffic/scenarios.ts';

test('same seed gives the same event log and the same final state', async () => {
  const a = await runA1('buggy', { seed: 3, n: 4, order: 'interleaved' });
  const b = await runA1('buggy', { seed: 3, n: 4, order: 'interleaved' });
  assert.deepEqual(a.log, b.log);
  assert.deepEqual(a.shop, b.shop);
  assert.deepEqual(a.paypal, b.paypal);
});

test('a run record carries PayPal facts, shop rows, params and outcomes', async () => {
  const r = await runA1('fixed', { seed: 1, n: 2, order: 'agent-first' });
  assert.equal(r.scenario, 'A1');
  assert.equal(r.variant, 'fixed');
  assert.deepEqual(r.params, { n: 2, order: 'agent-first' });
  assert.equal(r.paypal.orders.length, 1);
  assert.ok(r.shop.orders.length >= 1);
  assert.equal(r.outcomes.length, 2);
  assert.ok(r.log.length > 0);
});

test('A2 loses the first capture response but PayPal still captured', async () => {
  const r = await runA2('fixed', { seed: 1 });
  assert.equal(r.paypal.orders[0].status, 'COMPLETED');
  assert.equal(r.paypal.orders[0].captures.length, 1);
  assert.ok(r.log.some((l) => l.includes('response lost')));
});

test('A3 delivers the capture event twice', async () => {
  const r = await runA3('fixed', { seed: 1 });
  const captureDeliveries = r.log.filter((l) => l.startsWith('webhook PAYMENT.CAPTURE.COMPLETED'));
  assert.equal(captureDeliveries.length, 2);
});
