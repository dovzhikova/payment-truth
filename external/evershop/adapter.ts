// Plugs evershop's real PayPal handlers into Payment Truth's ShopHandlers.
// What counts as what (our mapping, stated in the README):
//   shop order  = evershop "order" row; PAID = paypal_captured, FAILED = paypal_failed
//   grant       = one "order_placed" row in evershop's event table (fulfillment trigger)

import { randomUUID } from 'node:crypto';
import type { PayPalApi } from '../../src/paypal/types.ts';
import type { Grant, OrderStatus, ShopHandlers, ShopOrder } from '../../src/shop/types.ts';

const V = new URL('./vendor/src/', import.meta.url).href;
const { pool } = await import(V + 'lib/postgres/connection.js');
const returnPage = (await import(V + 'modules/paypal/pages/frontStore/paypalReturn/index.ts')).default;
const webhookRoute = (await import(V + 'modules/paypal/api/paypalWebhook/[bodyRaw]webhook.ts')).default;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS "order" (order_id serial PRIMARY KEY, uuid text UNIQUE, order_number text, integration_order_id text, payment_method text, payment_status text, grand_total numeric, currency text);
CREATE TABLE IF NOT EXISTS payment_transaction (payment_transaction_id serial PRIMARY KEY, uuid text UNIQUE DEFAULT gen_random_uuid()::text, payment_transaction_order_id int REFERENCES "order"(order_id) ON DELETE CASCADE, transaction_id text, amount numeric, payment_action text, transaction_type text, additional_information text, CONSTRAINT "UNQ_PAYMENT_TRANSACTION_ID_ORDER_ID" UNIQUE (payment_transaction_order_id, transaction_id));
CREATE TABLE IF NOT EXISTS order_activity (order_activity_id serial PRIMARY KEY, order_activity_order_id int, comment text, customer_notified int);
CREATE TABLE IF NOT EXISTS event (event_id serial PRIMARY KEY, uuid text DEFAULT gen_random_uuid()::text, name text, data jsonb);`;
await pool.query(SCHEMA);

const mapStatus = (s: string): OrderStatus => (s === 'paypal_captured' ? 'PAID' : s === 'paypal_failed' ? 'FAILED' : 'PENDING');

export function createEvershopShop(api: PayPalApi): ShopHandlers {
  (globalThis as Record<string, unknown>).__paymentTruthPayPal = api;
  const ready = pool.query('TRUNCATE event, order_activity, payment_transaction, "order" RESTART IDENTITY CASCADE');
  let n = 0;
  return {
    async checkout() {
      await ready;
      const order = await api.createOrder(randomUUID());
      n += 1;
      await pool.query(
        `INSERT INTO "order" (uuid, order_number, integration_order_id, payment_method, payment_status, grand_total, currency) VALUES ($1, $2, $3, 'paypal', 'pending', 1.00, 'USD')`,
        [randomUUID(), String(10000 + n), order.id],
      );
      return order.id;
    },
    async complete(paypalOrderId) {
      const { rows } = await pool.query('SELECT uuid FROM "order" WHERE integration_order_id = $1', [paypalOrderId]);
      await returnPage({ query: { token: paypalOrderId }, params: { order_id: rows[0].uuid }, app: { locals: {} } }, { redirect() {} }, () => {});
      const after = await pool.query('SELECT payment_status FROM "order" WHERE integration_order_id = $1', [paypalOrderId]);
      return mapStatus(after.rows[0].payment_status);
    },
    async onWebhook(delivery) {
      let status = 200;
      const res = { status(c: number) { status = c; return res; }, json() { return res; } };
      await webhookRoute({ body: Buffer.from(delivery.body), headers: delivery.headers }, res, () => {});
      return status;
    },
    async snapshot() {
      const orders = (await pool.query('SELECT order_id, integration_order_id, payment_status FROM "order" ORDER BY order_id')).rows;
      const placed = (await pool.query(`SELECT e.event_id, o.integration_order_id,
          (SELECT transaction_id FROM payment_transaction t WHERE t.payment_transaction_order_id = o.order_id ORDER BY payment_transaction_id LIMIT 1) AS capture_id
        FROM event e JOIN "order" o ON o.order_id = (e.data->>'order_id')::int WHERE e.name = 'order_placed' ORDER BY e.event_id`)).rows;
      return {
        orders: orders.map((o): ShopOrder => ({ id: o.order_id, paypal_order_id: o.integration_order_id, sku: 'SKU-1', status: mapStatus(o.payment_status) })),
        grants: placed.map((g): Grant => ({ id: g.event_id, paypal_order_id: g.integration_order_id, sku: 'SKU-1', capture_id: g.capture_id ?? '' })),
      };
    },
  };
}

export async function close(): Promise<void> {
  await pool.end();
}
