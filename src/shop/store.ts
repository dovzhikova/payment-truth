// The demo shop's database. The grant row stands in for a licence.

import { DatabaseSync } from 'node:sqlite';
import type { Grant, OrderStatus, ShopOrder } from './types.ts';

export class Store {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS carts (paypal_order_id TEXT PRIMARY KEY, sku TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, paypal_order_id TEXT NOT NULL, sku TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grants (id INTEGER PRIMARY KEY, paypal_order_id TEXT NOT NULL, sku TEXT NOT NULL, capture_id TEXT NOT NULL);
    `);
  }

  // One shop order per PayPal order, one grant per PayPal order and SKU.
  addUniqueness(): void {
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS orders_paypal_order ON orders (paypal_order_id);
      CREATE UNIQUE INDEX IF NOT EXISTS grants_paypal_order_sku ON grants (paypal_order_id, sku);
    `);
  }

  saveCart(paypalOrderId: string, sku: string): void {
    this.db.prepare('INSERT INTO carts (paypal_order_id, sku) VALUES (?, ?)').run(paypalOrderId, sku);
  }

  cartSku(paypalOrderId: string): string | undefined {
    const row = this.db.prepare('SELECT sku FROM carts WHERE paypal_order_id = ?').get(paypalOrderId) as { sku: string } | undefined;
    return row?.sku;
  }

  findOrder(paypalOrderId: string): ShopOrder | undefined {
    return this.db.prepare('SELECT * FROM orders WHERE paypal_order_id = ? ORDER BY id LIMIT 1').get(paypalOrderId) as ShopOrder | undefined;
  }

  insertOrder(paypalOrderId: string, sku: string, status: OrderStatus): void {
    this.db.prepare('INSERT INTO orders (paypal_order_id, sku, status) VALUES (?, ?, ?)').run(paypalOrderId, sku, status);
  }

  // Returns true when a row was inserted.
  insertOrderIgnore(paypalOrderId: string, sku: string, status: OrderStatus): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO orders (paypal_order_id, sku, status) VALUES (?, ?, ?)').run(paypalOrderId, sku, status);
    return Number(r.changes) > 0;
  }

  setStatus(paypalOrderId: string, status: OrderStatus): void {
    this.db.prepare('UPDATE orders SET status = ? WHERE paypal_order_id = ?').run(status, paypalOrderId);
  }

  insertGrant(paypalOrderId: string, sku: string, captureId: string): void {
    this.db.prepare('INSERT INTO grants (paypal_order_id, sku, capture_id) VALUES (?, ?, ?)').run(paypalOrderId, sku, captureId);
  }

  insertGrantIgnore(paypalOrderId: string, sku: string, captureId: string): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO grants (paypal_order_id, sku, capture_id) VALUES (?, ?, ?)').run(paypalOrderId, sku, captureId);
    return Number(r.changes) > 0;
  }

  snapshot(): { orders: ShopOrder[]; grants: Grant[] } {
    const plain = <T>(rows: unknown[]) => rows.map((r) => ({ ...(r as object) }) as T);
    return {
      orders: plain<ShopOrder>(this.db.prepare('SELECT * FROM orders ORDER BY id').all()),
      grants: plain<Grant>(this.db.prepare('SELECT * FROM grants ORDER BY id').all()),
    };
  }
}
