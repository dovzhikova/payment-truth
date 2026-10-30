// PayPal REST client, sandbox only. Credentials come from the caller (read
// from .env by config.ts) and are never logged.

import { PayPalError } from './types.ts';
import type { PayPalApi, PayPalOrder, SignedDelivery } from './types.ts';

export const SANDBOX_ORIGIN = 'https://api-m.sandbox.paypal.com';

export type SandboxOptions = {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
};

type RawOrder = {
  id: string;
  status: string;
  links?: { rel: string; href: string }[];
  purchase_units?: { amount?: { value: string }; payments?: { captures?: { id: string; status: string; amount?: { value: string } }[] } }[];
};

const VERIFY_HEADERS = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];

export class SandboxPayPal implements PayPalApi {
  private readonly opts: Required<Omit<SandboxOptions, 'baseUrl'>>;
  private token: { value: string; expiresAt: number } | undefined;

  constructor(opts: SandboxOptions) {
    if ((opts.baseUrl ?? SANDBOX_ORIGIN) !== SANDBOX_ORIGIN) throw new Error(`sandbox only: refusing ${opts.baseUrl}`);
    this.opts = { clientId: opts.clientId, clientSecret: opts.clientSecret, webhookId: opts.webhookId, fetchFn: opts.fetchFn ?? fetch };
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const res = await this.opts.fetchFn(`${SANDBOX_ORIGIN}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) throw new PayPalError(`OAUTH_FAILED ${res.status} ${json.error ?? ''}`.trim());
    this.token = { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 300) - 60) * 1000 };
    return this.token.value;
  }

  // Raw JSON request against the sandbox. Exposed for the spike and the recorder.
  async request<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    const res = await this.opts.fetchFn(`${SANDBOX_ORIGIN}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const issue = json?.details?.[0]?.issue ?? json?.name ?? `HTTP_${res.status}`;
      throw new PayPalError(issue);
    }
    return json as T;
  }

  private map(raw: RawOrder): PayPalOrder {
    const unit = raw.purchase_units?.[0];
    return {
      id: raw.id,
      status: raw.status,
      amount: unit?.amount?.value ?? '1.00',
      captures: (unit?.payments?.captures ?? []).map((c) => ({ id: c.id, status: c.status, amount: c.amount?.value ?? '' })),
      approveUrl: raw.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href,
    };
  }

  async createOrder(requestId: string): Promise<PayPalOrder> {
    const raw = await this.request<RawOrder>(
      'POST',
      '/v2/checkout/orders',
      { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '1.00' } }] },
      { 'PayPal-Request-Id': requestId },
    );
    return this.map(raw);
  }

  async getOrder(id: string): Promise<PayPalOrder> {
    return this.map(await this.request<RawOrder>('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`));
  }

  async captureOrder(id: string, requestId: string): Promise<PayPalOrder> {
    const raw = await this.request<RawOrder>('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { 'PayPal-Request-Id': requestId });
    return this.map(raw);
  }

  async verifyWebhookSignature(d: SignedDelivery): Promise<boolean> {
    const h = Object.fromEntries(Object.entries(d.headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (!VERIFY_HEADERS.every((k) => h[k])) return false;
    const result = await this.request<{ verification_status?: string }>('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: h['paypal-auth-algo'],
      cert_url: h['paypal-cert-url'],
      transmission_id: h['paypal-transmission-id'],
      transmission_sig: h['paypal-transmission-sig'],
      transmission_time: h['paypal-transmission-time'],
      webhook_id: this.opts.webhookId,
      webhook_event: JSON.parse(d.body),
    });
    return result.verification_status === 'SUCCESS';
  }

  async resendWebhookEvent(eventId: string): Promise<void> {
    await this.request('POST', `/v1/notifications/webhooks-events/${encodeURIComponent(eventId)}/resend`, { webhook_ids: [this.opts.webhookId] });
  }
}
