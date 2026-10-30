// Payment Truth shim: the config keys the PayPal path reads.
const statuses = Object.fromEntries(
  ['pending', 'paypal_captured', 'paypal_authorized', 'paypal_pending', 'paypal_failed', 'paypal_refunded', 'paypal_partial_refunded', 'canceled'].map((s) => [s, { name: s }]),
);
const config = { 'oms.order.paymentStatus': statuses, 'system.paypal': { webhookId: 'WH-PAYMENT-TRUTH' } };
export const getConfig = (key, fallback) => (key in config ? config[key] : fallback);
