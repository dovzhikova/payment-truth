import type { SignedDelivery } from '../paypal/types.ts';

export type OrderStatus = 'PENDING' | 'PAID' | 'FAILED';

export type ShopOrder = { id: number; paypal_order_id: string; sku: string; status: OrderStatus };

export type Grant = { id: number; paypal_order_id: string; sku: string; capture_id: string };

export interface ShopHandlers {
  // Starts a purchase; returns the PayPal order id the buyer (or agent) approves.
  checkout(sku: string): Promise<string>;
  // Called when the buyer or the buyer's agent comes back to finish the purchase.
  complete(paypalOrderId: string): Promise<OrderStatus>;
  // Webhook endpoint; returns the HTTP status the shop answers with.
  onWebhook(delivery: SignedDelivery): Promise<number>;
}
