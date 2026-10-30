// Holds webhook deliveries until the scenario releases them, so a scenario
// decides when PayPal's events reach the shop relative to the agent's calls.

import type { SignedDelivery } from '../paypal/types.ts';
import type { ShopHandlers } from '../shop/types.ts';

type Held = { delivery: SignedDelivery; done: (status: number) => void };

export class HeldNetwork {
  private queue: Held[] = [];
  private shop: ShopHandlers | undefined;
  readonly statuses: number[] = [];

  attach(shop: ShopHandlers): void {
    this.shop = shop;
  }

  // Pass this as FakePayPal's `deliver`.
  readonly deliver = (delivery: SignedDelivery): Promise<void> =>
    new Promise((resolve) => {
      this.queue.push({ delivery, done: () => resolve() });
    });

  get size(): number {
    return this.queue.length;
  }

  // Delivers the oldest held event and resolves when the shop has answered.
  async releaseOne(): Promise<void> {
    const next = this.queue.shift();
    if (!next) return;
    if (!this.shop) throw new Error('HeldNetwork: no shop attached');
    const status = await this.shop.onWebhook(next.delivery);
    this.statuses.push(status);
    next.done(status);
  }

  // Delivers everything, including events produced while delivering.
  async flush(): Promise<void> {
    while (this.queue.length > 0) await this.releaseOne();
  }
}
