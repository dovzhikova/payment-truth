# Posted 2026-10-30 as https://github.com/evershopcommerce/evershop/issues/1180 (text as drafted; the posted footer omits the repo-link placeholder)

**Title:** [BUG] PayPal: concurrent finalization emits `order_placed` more than once (duplicate confirmation emails)

---

### Summary

`recordPaypalPayment` in `modules/paypal/services/finalizePaypalOrder.ts` decides whether this is the first finalization with a plain `SELECT` on `payment_transaction`, then upserts the row, with no lock in between:

https://github.com/evershopcommerce/evershop/blob/f33f72cd02bc20fd5d9b2b111bdda46b79b77200/packages/evershop/src/modules/paypal/services/finalizePaypalOrder.ts#L68-L73

Under Postgres's default READ COMMITTED isolation, two callers that run at the same time both see no row, both set `firstFinalization = true`, and both emit `order_placed`. The upsert keeps the transaction table correct (one row), and PayPal returns the same capture for the shared `PayPal-Request-Id`, so there is **no double charge**. The visible effect is that `sendOrderConfirmationEmail` runs once per concurrent caller, and any plugin subscribed to `order_placed` also runs more than once.

The docstring says `order_placed` is emitted "exactly once across every caller (return page now, webhook and reconciliation cron later)", so this looks like an unintended gap rather than a design choice.

### When it happens

The return page (`paypalReturn`) and the `CHECKOUT.ORDER.APPROVED` webhook both find the order still `pending` and both call `finalizePaypalOrder`. The webhook can arrive while the buyer's redirect is still being handled, so the two can overlap in normal traffic. A refreshed or double-submitted return page, or an automated client that retries the return URL, adds more concurrent callers.

Sequential calls are handled correctly: a retry after a lost capture response and a duplicate webhook delivery both produce exactly one `order_placed`.

### Reproduction

Tested at `f33f72cd` (current `main`; `finalizePaypalOrder.ts` on `dev` is identical as of 2026-10-30).

We ran evershop's own `paypalReturn` page handler, the PayPal webhook route, `finalizePaypalOrder`, `updatePaymentStatus`, `addOrderActivityLog` and the event `emit` unmodified against Postgres 15, with a simulated PayPal Orders v2 API (idempotent capture by `PayPal-Request-Id`, signed webhooks). Only logging, config, plugin hooks, type-only modules and the HTTP client were stubbed. One order is approved, then the `CHECKOUT.ORDER.APPROVED` webhook and N return-page requests run concurrently, in three orderings (webhook first, return page first, interleaved), on 3 seeds.

Result: every one of the 27 concurrent runs FAILED. Rows in the `event` table with `name = 'order_placed'` for the single order: 2 when N=1, 3 when N=2, 5 when N=4 (always N+1, one per caller). One `payment_transaction` row and one PayPal capture in every run.

### Suggested fix

Lock the order row inside the transaction before the existence check, so concurrent finalizations of the same order serialize and the second one sees the first one's committed transaction row:

```diff
@@ -65,6 +65,14 @@ export async function recordPaypalPayment(
   await startTransaction(connection);
   let firstFinalization = false;
   try {
+    // Serialize every finalization of this order: lock the order row before
+    // the existence check so concurrent callers (return page, webhooks, cron)
+    // cannot all observe "no transaction yet" and each emit order_placed.
+    // Under READ COMMITTED the check below then sees the winner's commit.
+    await (connection as any).query(
+      'SELECT order_id FROM "order" WHERE order_id = $1 FOR UPDATE',
+      [order.order_id]
+    );
     const existing = await select()
       .from('payment_transaction')
       .where('transaction_id', '=', payment.id)
```

With this change the same 27 concurrent runs plus the sequential ones (33 in total) all produced exactly one `order_placed`, and webhook signature verification was untouched. An alternative with the same effect is to let the insert decide (`INSERT ... ON CONFLICT DO NOTHING RETURNING`) and treat "row returned" as the first finalization. Happy to open a PR with whichever you prefer.

---

_Found with Payment Truth, an open-source harness that tests payment integrations under retrying and concurrent (agent-style) traffic. Repo link: TBD once public._
