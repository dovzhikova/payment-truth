// In-memory PayPal used for offline tests and the scenario matrix.
// Every async call yields a seeded number of event-loop turns, so concurrent
// callers interleave the same way for the same seed.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { PayPalError } from './types.ts';
import type { PayPalApi, PayPalOrder, SignedDelivery, WebhookEvent } from './types.ts';

export type Facts = { orders: PayPalOrder[]; events: WebhookEvent[] };

type Options = { seed: number; deliver: (d: SignedDelivery) => Promise<void> };

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sign(key: string, transmissionId: string, body: string): string {
  return createHmac('sha256', key).update(`${transmissionId}|${body}`).digest('hex');
}

export class FakePayPal implements PayPalApi {
  private readonly rand: () => number;
  private readonly deliverFn: Options['deliver'];
  private readonly key = 'fake-paypal-signing-key';
  private readonly orders = new Map<string, PayPalOrder>();
  private readonly captureByRequest = new Map<string, string>(); // requestId -> orderId
  private readonly events: WebhookEvent[] = [];
  private readonly deliveries = new Map<string, SignedDelivery>(); // event id -> delivery
  private readonly pending = new Set<Promise<void>>();
  private counter = 0;

  constructor(opts: Options) {
    this.rand = mulberry32(opts.seed);
    this.deliverFn = opts.deliver;
  }

  // Seeded scheduling noise: 0 to 3 event-loop turns.
  async yieldTurns(): Promise<void> {
    const turns = Math.floor(this.rand() * 4);
    for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r));
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${String(this.counter).padStart(4, '0')}`;
  }

  private copy(o: PayPalOrder): PayPalOrder {
    return structuredClone(o);
  }

  async createOrder(_requestId: string): Promise<PayPalOrder> {
    await this.yieldTurns();
    const order: PayPalOrder = { id: this.nextId('ORD'), status: 'CREATED', amount: '1.00', captures: [] };
    this.orders.set(order.id, order);
    return this.copy(order);
  }

  async getOrder(id: string): Promise<PayPalOrder> {
    await this.yieldTurns();
    const o = this.orders.get(id);
    if (!o) throw new PayPalError('RESOURCE_NOT_FOUND');
    return this.copy(o);
  }

  // Buyer approval. Emits CHECKOUT.ORDER.APPROVED.
  async approve(orderId: string): Promise<void> {
    await this.yieldTurns();
    const o = this.orders.get(orderId);
    if (!o) throw new PayPalError('RESOURCE_NOT_FOUND');
    o.status = 'APPROVED';
    this.emit({ id: this.nextId('WH'), event_type: 'CHECKOUT.ORDER.APPROVED', resource: { order_id: o.id, id: o.id, status: 'APPROVED' } });
  }

  async captureOrder(id: string, requestId: string): Promise<PayPalOrder> {
    await this.yieldTurns();
    const o = this.orders.get(id);
    if (!o) throw new PayPalError('RESOURCE_NOT_FOUND');
    // Idempotency: a repeated PayPal-Request-Id returns the original result.
    if (this.captureByRequest.get(requestId) === id) return this.copy(o);
    if (o.status === 'COMPLETED') throw new PayPalError('ORDER_ALREADY_CAPTURED');
    if (o.status !== 'APPROVED') throw new PayPalError('ORDER_NOT_APPROVED');
    const capture = { id: this.nextId('CAP'), status: 'COMPLETED' as const, amount: '1.00' as const };
    o.captures.push(capture);
    o.status = 'COMPLETED';
    this.captureByRequest.set(requestId, id);
    this.emit({
      id: this.nextId('WH'),
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        order_id: o.id, capture_id: capture.id, id: capture.id, status: 'COMPLETED',
        amount: { value: '1.00', currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: o.id } },
      },
    });
    return this.copy(o);
  }

  async verifyWebhookSignature(d: SignedDelivery): Promise<boolean> {
    await this.yieldTurns();
    const tid = d.headers['paypal-transmission-id'] ?? '';
    const sig = d.headers['paypal-transmission-sig'] ?? '';
    const expected = sign(this.key, tid, d.body);
    if (sig.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  // Redeliver an earlier event, the way PayPal's resend does.
  async resend(eventId: string): Promise<void> {
    await this.yieldTurns();
    const d = this.deliveries.get(eventId);
    if (!d) throw new PayPalError('RESOURCE_NOT_FOUND');
    this.dispatch(d);
  }

  // A delivery signed with a key the attacker controls, not PayPal's.
  forge(event: WebhookEvent): SignedDelivery {
    const body = JSON.stringify(event);
    const tid = `forged-${event.id}`;
    return { headers: { 'paypal-transmission-id': tid, 'paypal-transmission-sig': sign('attacker-key', tid, body) }, body };
  }

  facts(): Facts {
    return { orders: [...this.orders.values()].map((o) => this.copy(o)), events: structuredClone(this.events) };
  }

  // Resolves once every webhook delivery started so far has been handled.
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private emit(event: WebhookEvent): void {
    this.events.push(structuredClone(event));
    const body = JSON.stringify(event);
    const tid = `tx-${event.id}`;
    const d = { headers: { 'paypal-transmission-id': tid, 'paypal-transmission-sig': sign(this.key, tid, body) }, body };
    this.deliveries.set(event.id, d);
    this.dispatch(d);
  }

  // Delivery is asynchronous, like a real webhook: the API call does not wait for it.
  private dispatch(d: SignedDelivery): void {
    const p = this.deliverFn(structuredClone(d)).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
}
