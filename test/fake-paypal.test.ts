import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakePayPal } from '../src/paypal/fake.ts';
import type { SignedDelivery, WebhookEvent } from '../src/paypal/types.ts';

function setup(seed = 1) {
  const delivered: SignedDelivery[] = [];
  const pp = new FakePayPal({ seed, deliver: async (d) => { delivered.push(d); } });
  const events = () => delivered.map((d) => JSON.parse(d.body) as WebhookEvent);
  return { pp, delivered, events };
}

test('createOrder returns a CREATED USD 1.00 order', async () => {
  const { pp } = setup();
  const o = await pp.createOrder('req-1');
  assert.equal(o.status, 'CREATED');
  assert.equal(o.amount, '1.00');
  assert.deepEqual(o.captures, []);
});

test('capture before buyer approval is rejected', async () => {
  const { pp } = setup();
  const o = await pp.createOrder('req-1');
  await assert.rejects(pp.captureOrder(o.id, 'cap-1'), /ORDER_NOT_APPROVED/);
});

test('approve emits CHECKOUT.ORDER.APPROVED', async () => {
  const { pp, events } = setup();
  const o = await pp.createOrder('req-1');
  await pp.approve(o.id);
  assert.deepEqual(events().map((e) => e.event_type), ['CHECKOUT.ORDER.APPROVED']);
});

test('capture after approval yields one COMPLETED capture and one event', async () => {
  const { pp, events } = setup();
  const o = await pp.createOrder('req-1');
  await pp.approve(o.id);
  const c = await pp.captureOrder(o.id, 'cap-1');
  assert.equal(c.status, 'COMPLETED');
  assert.equal(c.captures.length, 1);
  assert.equal(c.captures[0].status, 'COMPLETED');
  assert.equal(events().filter((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED').length, 1);
});

test('same PayPal-Request-Id twice returns the same capture and emits once', async () => {
  const { pp, events } = setup();
  const o = await pp.createOrder('req-1');
  await pp.approve(o.id);
  const a = await pp.captureOrder(o.id, 'cap-1');
  const b = await pp.captureOrder(o.id, 'cap-1');
  assert.equal(a.captures[0].id, b.captures[0].id);
  assert.equal(b.captures.length, 1);
  assert.equal(events().filter((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED').length, 1);
});

test('a different PayPal-Request-Id on a captured order is rejected', async () => {
  const { pp } = setup();
  const o = await pp.createOrder('req-1');
  await pp.approve(o.id);
  await pp.captureOrder(o.id, 'cap-1');
  await assert.rejects(pp.captureOrder(o.id, 'cap-2'), /ORDER_ALREADY_CAPTURED/);
});

test('forged deliveries fail signature verification, real ones pass', async () => {
  const { pp, delivered } = setup();
  const o = await pp.createOrder('req-1');
  await pp.approve(o.id);
  assert.equal(await pp.verifyWebhookSignature(delivered[0]), true);
  const forged = pp.forge({ id: 'WH-forged', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { order_id: o.id, capture_id: 'X' } });
  assert.equal(await pp.verifyWebhookSignature(forged), false);
  const tampered = { headers: delivered[0].headers, body: delivered[0].body.replace(o.id, 'OTHER') };
  assert.equal(await pp.verifyWebhookSignature(tampered), false);
});

test('resend delivers the identical body again', async () => {
  const { pp, delivered, events } = setup();
  const o = await pp.createOrder('req-1');
  await pp.approve(o.id);
  await pp.captureOrder(o.id, 'cap-1');
  const ev = events().find((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED')!;
  await pp.resend(ev.id);
  assert.equal(delivered.at(-1)!.body, delivered.find((d) => d.body.includes(ev.id))!.body);
  assert.equal(await pp.verifyWebhookSignature(delivered.at(-1)!), true);
});

test('facts expose orders and events', async () => {
  const { pp } = setup();
  const o = await pp.createOrder('req-1');
  await pp.approve(o.id);
  const f = pp.facts();
  assert.equal(f.orders.length, 1);
  assert.equal(f.orders[0].status, 'APPROVED');
  assert.equal(f.events.length, 1);
});
