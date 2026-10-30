// Shapes shared by the fake and the sandbox PayPal clients. Kept to the
// fields the invariants need; the sandbox client maps real responses onto them.

export type Capture = { id: string; status: 'COMPLETED'; amount: '1.00' };

export type PayPalOrder = {
  id: string;
  status: 'CREATED' | 'APPROVED' | 'COMPLETED';
  amount: '1.00';
  captures: Capture[];
};

export type EventType = 'CHECKOUT.ORDER.APPROVED' | 'PAYMENT.CAPTURE.COMPLETED';

export type WebhookEvent = {
  id: string;
  event_type: EventType;
  resource: { order_id: string; capture_id?: string };
};

export type SignedDelivery = { headers: Record<string, string>; body: string };

export interface PayPalApi {
  createOrder(requestId: string): Promise<PayPalOrder>;
  getOrder(id: string): Promise<PayPalOrder>;
  captureOrder(id: string, requestId: string): Promise<PayPalOrder>;
  verifyWebhookSignature(delivery: SignedDelivery): Promise<boolean>;
}

export class PayPalError extends Error {
  readonly issue: string;
  constructor(issue: string) {
    super(issue);
    this.issue = issue;
  }
}
