// Live sandbox spike (spec v3, 30-31.10): one real order end to end.
//   node src/spike.ts
// Starts a cloudflared quick tunnel and a local webhook receiver, registers a
// temporary webhook on the sandbox app (deleted at the end), creates a USD 1.00
// order for a human to approve as the sandbox buyer, captures it, checks
// PayPal-Request-Id idempotency, resends the capture event and verifies every
// delivery's signature. Writes runs/spike-<timestamp>.json without secrets.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadEnv, requireEnv } from './config.ts';
import { SandboxPayPal } from './paypal/sandbox.ts';
import type { WebhookEvent } from './paypal/types.ts';

const PORT = 8787;
const env = { ...loadEnv(), ...process.env } as Record<string, string>;
requireEnv(env, ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']);

type Delivery = { receivedAt: string; headers: Record<string, string>; body: string; event: WebhookEvent; verified?: boolean };
const deliveries: Delivery[] = [];
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), steps: [] as unknown[] };
const step = (name: string, data: Record<string, unknown> = {}) => {
  (report.steps as unknown[]).push({ at: new Date().toISOString(), name, ...data });
  console.log(`[spike] ${name}${Object.keys(data).length ? ' ' + JSON.stringify(data) : ''}`);
};

async function waitFor<T>(label: string, timeoutMs: number, probe: () => T | undefined): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = probe();
    if (hit !== undefined) {
      console.log(`[spike] MATCHED: ${label}`);
      return hit;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`[spike] TIMED OUT after ${timeoutMs / 1000}s: ${label}`);
  return undefined;
}

function startServer(): Promise<void> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhooks/paypal') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
      try {
        deliveries.push({ receivedAt: new Date().toISOString(), headers, body, event: JSON.parse(body) });
        console.log(`[spike] webhook received: ${JSON.parse(body).event_type}`);
      } catch {
        console.log('[spike] webhook with unparseable body ignored');
      }
      res.writeHead(200).end();
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve()));
}

function startTunnel(): Promise<{ url: string; stop: () => void }> {
  return new Promise((resolve, reject) => {
    const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`]);
    const timer = setTimeout(() => reject(new Error('cloudflared did not print a URL in 60s')), 60_000);
    const onData = (chunk: Buffer) => {
      const m = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0], stop: () => child.kill() });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
  });
}

async function main() {
  await startServer();
  const tunnel = await startTunnel();
  step('tunnel up', { url: tunnel.url });
  // Give the quick tunnel's DNS a moment before PayPal validates the URL.
  await new Promise((r) => setTimeout(r, 8000));

  const bootstrap = new SandboxPayPal({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, webhookId: '' });
  const hook = await bootstrap.request<{ id: string }>('POST', '/v1/notifications/webhooks', {
    url: `${tunnel.url}/webhooks/paypal`,
    event_types: [{ name: 'CHECKOUT.ORDER.APPROVED' }, { name: 'PAYMENT.CAPTURE.COMPLETED' }],
  });
  step('webhook registered', { webhookId: hook.id });
  const pp = new SandboxPayPal({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, webhookId: hook.id });

  try {
    const order = await pp.createOrder(`spike-create-${Date.now()}`);
    step('order created', { orderId: order.id, status: order.status, approveUrl: order.approveUrl });
    writeFileSync('runs/private/approve-url.txt', `${order.approveUrl}\n`);
    console.log(`\n[spike] APPROVE AS THE SANDBOX BUYER: ${order.approveUrl}\n`);

    const approved = await waitFor('CHECKOUT.ORDER.APPROVED webhook', 15 * 60_000, () =>
      deliveries.find((d) => d.event.event_type === 'CHECKOUT.ORDER.APPROVED' && JSON.stringify(d.event).includes(order.id)),
    );
    const afterApproval = await pp.getOrder(order.id);
    step('order after approval', { status: afterApproval.status, approvedWebhook: Boolean(approved) });

    const requestId = `cap-${order.id}`;
    const captured = await pp.captureOrder(order.id, requestId);
    step('captured', { status: captured.status, captures: captured.captures });

    const again = await pp.captureOrder(order.id, requestId);
    step('capture repeated with the same PayPal-Request-Id', {
      status: again.status,
      sameCaptureId: again.captures[0]?.id === captured.captures[0]?.id,
      captureCount: again.captures.length,
    });
    try {
      await pp.captureOrder(order.id, `${requestId}-other`);
      step('capture with a different request id', { result: 'accepted (unexpected)' });
    } catch (e) {
      step('capture with a different request id', { result: 'rejected', issue: (e as Error).message });
    }

    const capEvent = await waitFor('PAYMENT.CAPTURE.COMPLETED webhook', 5 * 60_000, () =>
      deliveries.find((d) => d.event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && JSON.stringify(d.event).includes(captured.captures[0]?.id ?? '§')),
    );
    if (capEvent) {
      const before = deliveries.filter((d) => d.event.id === capEvent.event.id).length;
      await pp.resendWebhookEvent(capEvent.event.id);
      step('resend requested', { eventId: capEvent.event.id });
      const second = await waitFor('second delivery of the capture event', 5 * 60_000, () => {
        const copies = deliveries.filter((d) => d.event.id === capEvent.event.id);
        return copies.length > before ? copies : undefined;
      });
      if (second) {
        step('resend delivered', {
          copies: second.length,
          sameBody: second[0].body === second.at(-1)!.body,
          sameTransmissionId: second[0].headers['paypal-transmission-id'] === second.at(-1)!.headers['paypal-transmission-id'],
        });
      }
    }

    for (const d of deliveries) d.verified = await pp.verifyWebhookSignature({ headers: d.headers, body: d.body });
    step('signature verification', { results: deliveries.map((d) => ({ type: d.event.event_type, id: d.event.id, verified: d.verified })) });
    const forged = await pp.verifyWebhookSignature({
      headers: { ...(deliveries[0]?.headers ?? {}), 'paypal-transmission-sig': 'forged' },
      body: deliveries[0]?.body ?? '{}',
    });
    step('forged signature check', { verified: forged });
    report.deliveries = deliveries.map((d) => ({ receivedAt: d.receivedAt, event: d.event, verified: d.verified, transmissionId: d.headers['paypal-transmission-id'] }));
  } finally {
    await pp.request('DELETE', `/v1/notifications/webhooks/${hook.id}`).then(
      () => step('webhook deleted', { webhookId: hook.id }),
      (e) => step('webhook delete failed', { webhookId: hook.id, error: (e as Error).message }),
    );
    tunnel.stop();
    const file = `runs/spike-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`[spike] report written to ${file}`);
    process.exit(0);
  }
}

mkdirSync('runs/private', { recursive: true });
await main();
