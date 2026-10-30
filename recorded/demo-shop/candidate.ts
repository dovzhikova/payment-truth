// Demo shop backend used as the system under test.

import { randomUUID } from 'node:crypto';
import type { PayPalApi, SignedDelivery, WebhookEvent } from '../paypal/types.ts';
import type { Store } from './store.ts';
import type { OrderStatus, ShopHandlers } from './types.ts';

export function createBuggyShop(api: PayPalApi, store: Store): ShopHandlers {
  const granted = new Set<string>();

  async function paypalCompleted(paypalOrderId: string): Promise<boolean> {
    try {
      const o: any = await api.getOrder(paypalOrderId);
      return !!o && o.status === 'COMPLETED';
    } catch {
      return false;
    }
  }

  async function completeOrder(paypalOrderId: string): Promise<OrderStatus> {
    const sku = store.cartSku(paypalOrderId);
    if (!sku) return 'FAILED';
    const existing: any = store.findOrder(paypalOrderId);
    if (!existing) {
      store.insertOrder(paypalOrderId, sku, 'PENDING');
    } else if (existing.status === 'PAID') {
      return 'PAID';
    }
    if (await paypalCompleted(paypalOrderId)) {
      store.setStatus(paypalOrderId, 'PAID');
      return 'PAID';
    }
    const current: any = store.findOrder(paypalOrderId);
    if (current && current.status === 'PAID') return 'PAID';
    try {
      const result = await api.captureOrder(paypalOrderId, 'capture-' + paypalOrderId);
      if (result.status === 'COMPLETED') {
        store.setStatus(paypalOrderId, 'PAID');
        return 'PAID';
      }
    } catch {
      // outcome unknown: reconcile below
    }
    if (await paypalCompleted(paypalOrderId)) {
      store.setStatus(paypalOrderId, 'PAID');
      return 'PAID';
    }
    const after: any = store.findOrder(paypalOrderId);
    if (after && after.status === 'PAID') return 'PAID';
    return (after && after.status) || 'PENDING';
  }

  return {
    async checkout(sku) {
      const order = await api.createOrder(randomUUID());
      store.saveCart(order.id, sku);
      return order.id;
    },

    complete: completeOrder,

    async onWebhook(delivery: SignedDelivery) {
      if (!(await api.verifyWebhookSignature(delivery))) return 400;
      const event = JSON.parse(delivery.body) as WebhookEvent;
      const paypalOrderId = event.resource.order_id;
      const sku = store.cartSku(paypalOrderId);
      if (!sku) return 200;
      if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
        if (!store.findOrder(paypalOrderId)) await completeOrder(paypalOrderId);
      } else if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const key = paypalOrderId + '|' + sku;
        if (granted.has(key)) return 200;
        if (!(await paypalCompleted(paypalOrderId))) return 200;
        if (granted.has(key)) return 200;
        granted.add(key);
        if (store.findOrder(paypalOrderId)) {
          store.setStatus(paypalOrderId, 'PAID');
        } else {
          store.insertOrder(paypalOrderId, sku, 'PAID');
        }
        store.insertGrant(paypalOrderId, sku, event.resource.capture_id ?? '');
      }
      return 200;
    },
  };
}
