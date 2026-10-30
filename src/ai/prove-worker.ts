// Runs inside a sandboxed child process (see prove.ts): Node permission model,
// read access to src/ only, no child processes, no file writes, empty env.
// Loads a candidate shop module, runs every scenario and the forged-webhook
// check, prints one JSON line.

import { pathToFileURL } from 'node:url';
import { FakePayPal } from '../paypal/fake.ts';
import { Store } from '../shop/store.ts';
import { runMatrix } from '../matrix.ts';
import type { ShopFactory } from '../traffic/scenarios.ts';

const [candidatePath, seedsArg] = process.argv.slice(2);
const seeds = (seedsArg ?? '1,2,3').split(',').map(Number);

async function forgedRejected(factory: ShopFactory): Promise<boolean> {
  const pp = new FakePayPal({ seed: 1, deliver: async () => {} });
  const store = new Store();
  const shop = factory(pp, store);
  const id = await shop.checkout('SKU-1');
  const a = await shop.onWebhook(pp.forge({ id: 'WH-f1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { order_id: id } }));
  const b = await shop.onWebhook(pp.forge({ id: 'WH-f2', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { order_id: id, capture_id: 'CAP-f' } }));
  const snap = store.snapshot();
  return a >= 400 && b >= 400 && snap.orders.length === 0 && snap.grants.length === 0;
}

async function main() {
  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(candidatePath).href);
  } catch (e) {
    return { loaded: false, error: `load failed: ${(e as Error).message}` };
  }
  const entry = Object.entries(mod).find(([k, v]) => k.startsWith('create') && typeof v === 'function');
  if (!entry) return { loaded: false, error: 'no exported create* factory' };
  const factory = entry[1] as ShopFactory;
  const runs = [];
  for (const seed of seeds) {
    for (const r of await runMatrix(factory, seed)) runs.push({ scenario: r.run.scenario, params: r.run.params, seed, verdicts: r.verdicts });
  }
  return { loaded: true, factory: entry[0], runs, forgedRejected: await forgedRejected(factory) };
}

main().then(
  (out) => process.stdout.write(JSON.stringify(out) + '\n'),
  (e) => process.stdout.write(JSON.stringify({ loaded: true, error: `crashed: ${(e as Error).message}` }) + '\n'),
);
