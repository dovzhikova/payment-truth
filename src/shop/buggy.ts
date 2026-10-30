// A shop backend written the way many real integrations are. It verifies
// webhook signatures correctly; only the business logic is wrong. Planted
// defects, each one line of thinking a reviewer could miss:
//   1. complete(): check-then-insert across an await, so concurrent calls
//      create duplicate shop orders.
//   2. complete(): a fresh PayPal-Request-Id per call, so a retry is a new
//      capture attempt instead of a replay.
//   3. complete(): any error marks the order FAILED, even when the capture
//      went through and only the response was lost.
//   4. Approval webhook: creates and captures the order when it "isn't
//      there yet", racing the agent's own completion.
//   5. Capture webhook: grants on every delivery, so a redelivered event
//      grants twice.

import { randomUUID } from 'node:crypto';
import type { PayPalApi, SignedDelivery, WebhookEvent } from '../paypal/types.ts';
import type { Store } from './store.ts';
import type { OrderStatus, ShopHandlers } from './types.ts';

export function createBuggyShop(api: PayPalApi, store: Store): ShopHandlers {
  async function completeOrder(paypalOrderId: string): Promise<OrderStatus> {
    const sku = store.cartSku(paypalOrderId);
    if (!sku) return 'FAILED';
    const existing = store.findOrder(paypalOrderId);
    await api.getOrder(paypalOrderId); // load the order to show the buyer a summary
    if (!existing) store.insertOrder(paypalOrderId, sku, 'PENDING');
    try {
      const result = await api.captureOrder(paypalOrderId, randomUUID());
      const status: OrderStatus = result.status === 'COMPLETED' ? 'PAID' : 'FAILED';
      store.setStatus(paypalOrderId, status);
      return status;
    } catch {
      store.setStatus(paypalOrderId, 'FAILED');
      return 'FAILED';
    }
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
        store.insertGrant(paypalOrderId, sku, event.resource.capture_id ?? '');
      }
      return 200;
    },
  };
}
