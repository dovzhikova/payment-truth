// Payment Truth shim: an axios-like client that answers evershop's PayPal
// calls from Payment Truth's fake PayPal (globalThis.__paymentTruthPayPal).
const api = () => globalThis.__paymentTruthPayPal;
const toPayPal = (o) => ({
  id: o.id, status: o.status, intent: 'CAPTURE',
  purchase_units: [{ payments: { captures: o.captures.map((c) => ({ id: c.id, status: c.status, amount: { value: c.amount, currency_code: 'USD' } })) } }],
});
const fail = (status, issue) => ({ status, data: { name: issue, message: issue, details: [{ issue }] } });
function client() {
  const respond = (res, config) => {
    const ok = config?.validateStatus ? config.validateStatus(res.status) : res.status < 400;
    if (ok) return res;
    const e = new Error(`Request failed with status code ${res.status}`);
    e.response = res;
    throw e;
  };
  const call = async (fn, config) => {
    try {
      return respond(await fn(), config);
    } catch (e) {
      if (e.response) throw e;
      if (e.issue) return respond(fail(e.issue === 'RESOURCE_NOT_FOUND' ? 404 : 422, e.issue), config);
      throw Object.assign(new Error(e.message || 'network error'), { code: 'ECONNABORTED' });
    }
  };
  return {
    get: (url, config) => {
      const m = url.match(/\/v2\/checkout\/orders\/([^/]+)$/);
      return call(async () => ({ status: 200, data: toPayPal(await api().getOrder(m[1])) }), config);
    },
    post: (url, body, config) => {
      const cap = url.match(/\/v2\/checkout\/orders\/([^/]+)\/capture$/);
      if (cap) {
        const rid = config?.headers?.['PayPal-Request-Id'] ?? `no-request-id-${Math.random()}`;
        return call(async () => ({ status: 201, data: toPayPal(await api().captureOrder(cap[1], rid)) }), config);
      }
      if (url.endsWith('/v1/notifications/verify-webhook-signature')) {
        return call(async () => {
          const ok = await api().verifyWebhookSignature({
            headers: { 'paypal-transmission-id': body.transmission_id ?? '', 'paypal-transmission-sig': body.transmission_sig ?? '' },
            body: JSON.stringify(body.webhook_event),
          });
          return { status: 200, data: { verification_status: ok ? 'SUCCESS' : 'FAILURE' } };
        }, config);
      }
      return Promise.resolve(respond(fail(404, 'NOT_SHIMMED'), config));
    },
  };
}
export const createAxiosInstance = async () => client();
export const createStandaloneAxiosInstance = async () => client();
