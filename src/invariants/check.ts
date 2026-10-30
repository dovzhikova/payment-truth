// Deterministic verdicts over one run. The AI never decides these.
// Missing or stale data is UNKNOWN, never PASS.

import type { PayPalOrder } from '../paypal/types.ts';
import type { RunRecord } from '../traffic/scenarios.ts';

export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4';
export type Verdict = { id: InvariantId; result: 'PASS' | 'FAIL' | 'UNKNOWN'; detail: string };

export const INVARIANT_RULES: Record<InvariantId, string> = {
  I1: 'Every grant rests on a COMPLETED capture PayPal reports for that order.',
  I2: 'One PayPal order and one SKU give at most one grant.',
  I3: 'One PayPal order maps to exactly one shop order.',
  I4: 'An unknown capture outcome is reconciled with PayPal, never FAILED without proof; at most one capture per order.',
};

function count<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return m;
}

export function checkRun(run: RunRecord): Verdict[] {
  const paypal = new Map<string, PayPalOrder>(run.paypal.orders.map((o) => [o.id, o]));
  const { orders, grants } = run.shop;

  const i1 = ((): Verdict => {
    if (paypal.size === 0) return { id: 'I1', result: 'UNKNOWN', detail: 'no PayPal facts recorded' };
    for (const g of grants) {
      const o = paypal.get(g.paypal_order_id);
      if (!o) return { id: 'I1', result: 'UNKNOWN', detail: `PayPal order ${g.paypal_order_id} not observed` };
      if (!o.captures.some((c) => c.id === g.capture_id && c.status === 'COMPLETED')) {
        return { id: 'I1', result: 'FAIL', detail: `grant ${g.id} cites capture ${g.capture_id || '(none)'}, PayPal has no such COMPLETED capture` };
      }
    }
    return { id: 'I1', result: 'PASS', detail: `${grants.length} grant(s), each backed by a COMPLETED capture` };
  })();

  const i2 = ((): Verdict => {
    for (const [key, n] of count(grants, (g) => `${g.paypal_order_id}/${g.sku}`)) {
      if (n > 1) return { id: 'I2', result: 'FAIL', detail: `${n} grants for ${key}` };
    }
    return { id: 'I2', result: 'PASS', detail: 'at most one grant per order and SKU' };
  })();

  const i3 = ((): Verdict => {
    for (const [ppId, n] of count(orders, (o) => o.paypal_order_id)) {
      if (n > 1) return { id: 'I3', result: 'FAIL', detail: `${n} shop orders for PayPal order ${ppId}` };
    }
    const shopIds = new Set(orders.map((o) => o.paypal_order_id));
    for (const o of paypal.values()) {
      if (o.status === 'COMPLETED' && !shopIds.has(o.id)) return { id: 'I3', result: 'FAIL', detail: `PayPal order ${o.id} is paid but the shop has no order` };
    }
    if (paypal.size === 0) return { id: 'I3', result: 'UNKNOWN', detail: 'no PayPal facts recorded' };
    return { id: 'I3', result: 'PASS', detail: 'one shop order per PayPal order' };
  })();

  const i4 = ((): Verdict => {
    for (const o of paypal.values()) {
      if (o.captures.length > 1) return { id: 'I4', result: 'FAIL', detail: `${o.captures.length} captures on PayPal order ${o.id}` };
    }
    for (const s of orders) {
      const o = paypal.get(s.paypal_order_id);
      if (!o) return { id: 'I4', result: 'UNKNOWN', detail: `PayPal order ${s.paypal_order_id} not observed` };
      if (s.status === 'FAILED' && o.status === 'COMPLETED') {
        return { id: 'I4', result: 'FAIL', detail: `shop order ${s.id} is FAILED while PayPal order ${o.id} is COMPLETED` };
      }
    }
    if (paypal.size === 0) return { id: 'I4', result: 'UNKNOWN', detail: 'no PayPal facts recorded' };
    return { id: 'I4', result: 'PASS', detail: 'shop status agrees with PayPal' };
  })();

  return [i1, i2, i3, i4];
}
