// A network between the shop and PayPal that loses capture responses:
// PayPal performs the capture, the shop never hears back.

import type { PayPalApi } from '../paypal/types.ts';

export class TimeoutError extends Error {
  constructor(message = 'response lost') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withLostCaptureResponse(api: PayPalApi, times: number, onLost?: () => void): PayPalApi {
  let remaining = times;
  return {
    createOrder: (requestId) => api.createOrder(requestId),
    getOrder: (id) => api.getOrder(id),
    verifyWebhookSignature: (d) => api.verifyWebhookSignature(d),
    async captureOrder(id, requestId) {
      const result = await api.captureOrder(id, requestId);
      if (remaining > 0) {
        remaining -= 1;
        onLost?.();
        throw new TimeoutError();
      }
      return result;
    },
  };
}
