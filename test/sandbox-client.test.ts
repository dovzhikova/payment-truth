import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SandboxPayPal, SANDBOX_ORIGIN } from '../src/paypal/sandbox.ts';

type Call = { url: string; init: RequestInit };

function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchFn = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

const creds = { clientId: 'id', clientSecret: 'secret', webhookId: 'WH-ID' };
const token = { status: 200, body: { access_token: 'tok', expires_in: 32400 } };

test('refuses any origin other than the PayPal sandbox', () => {
  assert.throws(() => new SandboxPayPal({ ...creds, baseUrl: 'https://api-m.paypal.com' }), /sandbox only/);
  assert.equal(SANDBOX_ORIGIN, 'https://api-m.sandbox.paypal.com');
});

test('captureOrder sends the PayPal-Request-Id and maps captures', async () => {
  const { calls, fetchFn } = stubFetch([
    token,
    { status: 201, body: { id: 'O1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'C1', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'USD' } }] } }] } },
  ]);
  const pp = new SandboxPayPal({ ...creds, fetchFn });
  const o = await pp.captureOrder('O1', 'cap-O1');
  assert.equal(calls[1].url, `${SANDBOX_ORIGIN}/v2/checkout/orders/O1/capture`);
  assert.equal((calls[1].init.headers as Record<string, string>)['PayPal-Request-Id'], 'cap-O1');
  assert.deepEqual(o.captures, [{ id: 'C1', status: 'COMPLETED', amount: '1.00' }]);
  assert.equal(o.status, 'COMPLETED');
});

test('createOrder asks for USD 1.00 with intent CAPTURE and returns the approve link', async () => {
  const { calls, fetchFn } = stubFetch([
    token,
    { status: 201, body: { id: 'O2', status: 'CREATED', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=O2' }] } },
  ]);
  const o = await new SandboxPayPal({ ...creds, fetchFn }).createOrder('req-1');
  const body = JSON.parse(String(calls[1].init.body));
  assert.equal(body.intent, 'CAPTURE');
  assert.deepEqual(body.purchase_units[0].amount, { currency_code: 'USD', value: '1.00' });
  assert.equal(o.approveUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=O2');
  assert.equal(o.status, 'CREATED');
});

test('PayPal errors surface the issue code', async () => {
  const { fetchFn } = stubFetch([token, { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } }]);
  await assert.rejects(new SandboxPayPal({ ...creds, fetchFn }).captureOrder('O1', 'x'), /ORDER_ALREADY_CAPTURED/);
});

test('verifyWebhookSignature posts the transmission headers and the webhook id', async () => {
  const { calls, fetchFn } = stubFetch([token, { status: 200, body: { verification_status: 'SUCCESS' } }]);
  const headers = {
    'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
    'paypal-transmission-id': 't1', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2026-10-30T10:00:00Z',
  };
  const ok = await new SandboxPayPal({ ...creds, fetchFn }).verifyWebhookSignature({ headers, body: '{"id":"WH-1"}' });
  assert.equal(ok, true);
  const sent = JSON.parse(String(calls[1].init.body));
  assert.equal(sent.webhook_id, 'WH-ID');
  assert.equal(sent.transmission_id, 't1');
  assert.deepEqual(sent.webhook_event, { id: 'WH-1' });
});

test('verifyWebhookSignature is false on FAILURE and on a missing header', async () => {
  const { fetchFn } = stubFetch([token, { status: 200, body: { verification_status: 'FAILURE' } }]);
  const pp = new SandboxPayPal({ ...creds, fetchFn });
  assert.equal(await pp.verifyWebhookSignature({ headers: {}, body: '{}' }), false);
  const full = { 'paypal-auth-algo': 'a', 'paypal-cert-url': 'c', 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 'x' };
  assert.equal(await pp.verifyWebhookSignature({ headers: full, body: '{}' }), false);
});

test('the OAuth token is fetched once and reused', async () => {
  const { calls, fetchFn } = stubFetch([token, { status: 200, body: { id: 'O1', status: 'APPROVED' } }, { status: 200, body: { id: 'O1', status: 'APPROVED' } }]);
  const pp = new SandboxPayPal({ ...creds, fetchFn });
  await pp.getOrder('O1');
  await pp.getOrder('O1');
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/oauth2/token')).length, 1);
});
