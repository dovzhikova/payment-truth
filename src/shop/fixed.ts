// The same shop with the defects fixed:
//   - one shop order per PayPal order, enforced by a unique index;
//   - one PayPal-Request-Id per PayPal order, so retries replay;
//   - an unknown capture outcome stays PENDING and is reconciled by reading
//     the order from PayPal, never marked FAILED on a guess;
//   - a grant only for a capture PayPal reports as COMPLETED, at most once.

import { randomUUID } from 'node:crypto';
import type { PayPalApi, PayPalOrder, SignedDelivery, WebhookEvent } from '../paypal/types.ts';
import type { Store } from './store.ts';
import type { OrderStatus, ShopHandlers } from './types.ts';

const requestIdFor = (paypalOrderId: string) => `cap-${paypalOrderId}`;

export function createFixedShop(api: PayPalApi, store: Store): ShopHandlers {
  store.addUniqueness();

  function statusFrom(order: PayPalOrder): OrderStatus {
    return order.status === 'COMPLETED' && order.captures.some((c) => c.status === 'COMPLETED') ? 'PAID' : 'PENDING';
  }

  async function settle(paypalOrderId: string): Promise<OrderStatus> {
    let order: PayPalOrder;
    try {
      order = await api.captureOrder(paypalOrderId, requestIdFor(paypalOrderId));
    } catch {
      // The outcome is unknown: ask PayPal instead of guessing.
      try {
        order = await api.getOrder(paypalOrderId);
        if (order.status === 'APPROVED') order = await api.captureOrder(paypalOrderId, requestIdFor(paypalOrderId));
      } catch {
        return 'PENDING';
      }
    }
    const status = statusFrom(order);
    if (status === 'PAID') store.setStatus(paypalOrderId, 'PAID');
    return status;
  }

  async function startCompletion(paypalOrderId: string): Promise<OrderStatus> {
    const sku = store.cartSku(paypalOrderId);
    if (!sku) return 'FAILED';
    store.insertOrderIgnore(paypalOrderId, sku, 'PENDING');
    return settle(paypalOrderId);
  }

  return {
    async checkout(sku) {
      const order = await api.createOrder(randomUUID());
      store.saveCart(order.id, sku);
      return order.id;
    },

    complete: startCompletion,

    async onWebhook(delivery: SignedDelivery) {
      if (!(await api.verifyWebhookSignature(delivery))) return 400;
      const event = JSON.parse(delivery.body) as WebhookEvent;
      const paypalOrderId = event.resource.order_id;
      const sku = store.cartSku(paypalOrderId);
      if (!sku) return 200;
      if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
        await startCompletion(paypalOrderId);
      } else if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const order = await api.getOrder(paypalOrderId);
        const capture = order.captures.find((c) => c.id === event.resource.capture_id && c.status === 'COMPLETED');
        if (!capture) return 200; // not observed at PayPal: no grant
        store.insertOrderIgnore(paypalOrderId, sku, 'PAID');
        store.setStatus(paypalOrderId, 'PAID');
        store.insertGrantIgnore(paypalOrderId, sku, capture.id);
      }
      return 200;
    },
  };
}
