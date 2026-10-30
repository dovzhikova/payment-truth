import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakePayPal } from '../src/paypal/fake.ts';
import { Store } from '../src/shop/store.ts';
import { createBuggyShop } from '../src/shop/buggy.ts';
import { createFixedShop } from '../src/shop/fixed.ts';
import { HeldNetwork } from '../src/traffic/network.ts';

const variants = { buggy: createBuggyShop, fixed: createFixedShop };

function setup(variant: keyof typeof variants) {
  const net = new HeldNetwork();
  const pp = new FakePayPal({ seed: 7, deliver: net.deliver });
  const store = new Store();
  const shop = variants[variant](pp, store);
  net.attach(shop);
  return { pp, store, shop, net };
}

for (const variant of ['buggy', 'fixed'] as const) {
  test(`${variant}: forged webhook is rejected with 400 and changes nothing`, async () => {
    const { pp, store, shop } = setup(variant);
    const id = await shop.checkout('SKU-1');
    const forged = pp.forge({ id: 'WH-x', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { order_id: id, capture_id: 'CAP-x' } });
    assert.equal(await shop.onWebhook(forged), 400);
    const forgedApproval = pp.forge({ id: 'WH-y', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { order_id: id } });
    assert.equal(await shop.onWebhook(forgedApproval), 400);
    assert.deepEqual(store.snapshot().orders, []);
    assert.deepEqual(store.snapshot().grants, []);
  });

  test(`${variant}: sequential happy path gives one PAID order and one grant`, async () => {
    const { pp, store, shop, net } = setup(variant);
    const id = await shop.checkout('SKU-1');
    await pp.approve(id);
    assert.equal(await shop.complete(id), 'PAID');
    await net.flush();
    const snap = store.snapshot();
    assert.equal(snap.orders.length, 1);
    assert.equal(snap.orders[0].status, 'PAID');
    assert.equal(snap.grants.length, 1);
    assert.equal(snap.grants[0].sku, 'SKU-1');
    assert.deepEqual(net.statuses, [200, 200]);
  });
}

test('fixed: approval webhook alone completes the sale when the agent never returns', async () => {
  const { pp, store, shop, net } = setup('fixed');
  const id = await shop.checkout('SKU-1');
  await pp.approve(id);
  await net.flush();
  const snap = store.snapshot();
  assert.equal(snap.orders.length, 1);
  assert.equal(snap.orders[0].status, 'PAID');
  assert.equal(snap.grants.length, 1);
});
