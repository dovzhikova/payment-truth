// Agent-shaped traffic. This is our model of how a buying agent behaves
// (retries after a timeout, parallel calls, racing PayPal's webhooks), not a
// measurement of any specific agent.

import { FakePayPal } from '../paypal/fake.ts';
import type { Facts } from '../paypal/fake.ts';
import type { PayPalApi, SignedDelivery, WebhookEvent } from '../paypal/types.ts';
import { Store } from '../shop/store.ts';
import { createBuggyShop } from '../shop/buggy.ts';
import { createFixedShop } from '../shop/fixed.ts';
import type { ShopHandlers } from '../shop/types.ts';
import { HeldNetwork } from './network.ts';
import { withLostCaptureResponse } from './lossy.ts';

export type Variant = 'buggy' | 'fixed';
export type ShopFactory = (api: PayPalApi, store: Store) => ShopHandlers;
export type EventOrder = 'webhook-first' | 'agent-first' | 'interleaved';
export const EVENT_ORDERS: EventOrder[] = ['webhook-first', 'agent-first', 'interleaved'];

export type RunRecord = {
  scenario: 'A1' | 'A2' | 'A3';
  variant: Variant | string;
  seed: number;
  params: Record<string, unknown>;
  paypal: Facts;
  shop: ReturnType<Store['snapshot']>;
  log: string[];
  outcomes: string[];
};

const FACTORIES: Record<Variant, ShopFactory> = { buggy: createBuggyShop, fixed: createFixedShop };

function factoryFor(variant: Variant | ShopFactory): { name: string; factory: ShopFactory } {
  return typeof variant === 'function' ? { name: 'custom', factory: variant } : { name: variant, factory: FACTORIES[variant] };
}

function harness(variant: Variant | ShopFactory, seed: number, lostCaptures = 0) {
  const log: string[] = [];
  const net = new HeldNetwork();
  const pp = new FakePayPal({ seed, deliver: net.deliver });
  const store = new Store();
  const api = lostCaptures > 0 ? withLostCaptureResponse(pp, lostCaptures, () => log.push('network: capture response lost')) : pp;
  const { name, factory } = factoryFor(variant);
  const shop = factory(api, store);
  net.attach({
    ...shop,
    async onWebhook(d: SignedDelivery) {
      const type = (JSON.parse(d.body) as WebhookEvent).event_type;
      const status = await shop.onWebhook(d);
      log.push(`webhook ${type} -> ${status}`);
      return status;
    },
  });
  const outcomes: string[] = [];
  const agent = async (label: string, paypalOrderId: string) => {
    const status = await shop.complete(paypalOrderId);
    outcomes.push(status);
    log.push(`${label}: complete -> ${status}`);
  };
  async function finish(scenario: RunRecord['scenario'], params: Record<string, unknown>): Promise<RunRecord> {
    await net.flush();
    await pp.settle();
    return { scenario, variant: name, seed, params, paypal: pp.facts(), shop: store.snapshot(), log, outcomes };
  }
  return { pp, net, shop, log, agent, finish };
}

// A1: the agent finishes right after approval while CHECKOUT.ORDER.APPROVED
// arrives in parallel; n agent calls run concurrently.
export async function runA1(variant: Variant | ShopFactory, opts: { seed: number; n: number; order: EventOrder }): Promise<RunRecord> {
  const h = harness(variant, opts.seed);
  const id = await h.shop.checkout('SKU-1');
  await h.pp.approve(id);
  const agents = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => h.agent(`agent#${from + i}`, id));
  const running: Promise<void>[] = [];
  if (opts.order === 'webhook-first') {
    running.push(h.net.releaseOne(), ...agents(0, opts.n));
  } else if (opts.order === 'agent-first') {
    running.push(...agents(0, opts.n), h.net.releaseOne());
  } else {
    const half = Math.ceil(opts.n / 2);
    running.push(...agents(0, half), h.net.releaseOne(), ...agents(half, opts.n));
  }
  await Promise.all(running);
  return h.finish('A1', { n: opts.n, order: opts.order });
}

// A2: the capture succeeds at PayPal but the response is lost; the agent retries.
export async function runA2(variant: Variant | ShopFactory, opts: { seed: number }): Promise<RunRecord> {
  const h = harness(variant, opts.seed, 1);
  const id = await h.shop.checkout('SKU-1');
  await h.pp.approve(id);
  await h.agent('agent', id);
  await h.agent('agent retry', id);
  return h.finish('A2', {});
}

// A3: a normal purchase, then PayPal delivers PAYMENT.CAPTURE.COMPLETED again.
export async function runA3(variant: Variant | ShopFactory, opts: { seed: number }): Promise<RunRecord> {
  const h = harness(variant, opts.seed);
  const id = await h.shop.checkout('SKU-1');
  await h.pp.approve(id);
  await h.agent('agent', id);
  await h.net.flush();
  const captureEvent = h.pp.facts().events.find((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED');
  if (captureEvent) {
    h.log.push(`paypal: resend ${captureEvent.id}`);
    await h.pp.resend(captureEvent.id);
  }
  return h.finish('A3', {});
}
