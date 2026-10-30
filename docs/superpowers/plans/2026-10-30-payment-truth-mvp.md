# Payment Truth MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check whether a shop's PayPal backend survives AI-buyer-agent traffic (race, retry after timeout, duplicate webhook), prove fixes with deterministic invariants, and let an AI diagnose and patch failures.

**Architecture:** One Node process, zero runtime dependencies. A `PayPalApi` interface has two implementations: an in-memory `FakePayPal` (offline tests, deterministic seeded interleavings) and a sandbox client (Phase 2). Two shop variants (`buggy`, `fixed`) implement the same `ShopHandlers` interface over `node:sqlite`. A traffic generator runs scenarios A1-A3 and returns a `RunRecord`; a pure invariant checker turns it into PASS/FAIL/UNKNOWN verdicts.

**Tech Stack:** Node 24 (native TypeScript type stripping, erasable syntax only), `node:test`, `node:sqlite`, `node:http`, `fetch`.

**Spec:** Notion "Payment Truth: спецификация MVP v3" https://app.notion.com/p/409061d7ec9e8187bd8cf5f10b4fd2f1

## Global Constraints

- Sandbox only: fixed origin `https://api-m.sandbox.paypal.com`; any other PayPal origin is refused before a request is made.
- Every order is USD 1.00, Orders v2, intent CAPTURE.
- A grant (fake licence) is a SQLite row; no real customers or goods.
- Every webhook is signature-verified before business logic, in both shop variants. The buggy variant breaks only business logic.
- Secrets live only in local config (`.env`, gitignored); never in prompts, exports, recorded runs, logs given to the AI, or browser code.
- Verdicts are PASS, FAIL or UNKNOWN; missing or stale data is never PASS.
- The AI never picks targets, amounts, endpoints or keys, never issues verdicts, never executes code; a human applies patches.
- Runtime dependencies: none. Dev: none beyond Node 24.
- No em dashes in code comments, docs or UI copy.

## Review Focus

1. Interleaving coverage: a race that only shows up under one event order must be found; A1 runs every order in `['webhook-first','agent-first','interleaved']` and N in `[1,2,4]`.
2. Forged webhook: an event with a bad signature must change nothing (no order row, no grant) in both variants.
3. Missing PayPal facts (capture never observed) must yield UNKNOWN for I1, not PASS.
4. Retried capture with the same PayPal-Request-Id must return the original capture, not a second one, in `FakePayPal` (otherwise A2 "fixed" passes for the wrong reason).
5. Determinism: the same seed must produce the same event log twice.

---

## Phase 1: offline core (no keys needed)

### Task 1: PayPal interface and FakePayPal

**Files:**
- Create: `src/paypal/types.ts`, `src/paypal/fake.ts`, `package.json`, `.gitignore`, `LICENSE` (MIT)
- Test: `test/fake-paypal.test.ts`

**Interfaces (produces):**
- `type PayPalOrder = { id: string; status: 'CREATED'|'APPROVED'|'COMPLETED'; amount: '1.00'; captures: Capture[] }`, `type Capture = { id: string; status: 'COMPLETED'; amount: '1.00' }`
- `type WebhookEvent = { id: string; event_type: 'CHECKOUT.ORDER.APPROVED'|'PAYMENT.CAPTURE.COMPLETED'; resource: { order_id: string; capture_id?: string } }`
- `type SignedDelivery = { headers: Record<string,string>; body: string }`
- `interface PayPalApi { createOrder(requestId: string): Promise<PayPalOrder>; getOrder(id: string): Promise<PayPalOrder>; captureOrder(id: string, requestId: string): Promise<PayPalOrder>; verifyWebhookSignature(d: SignedDelivery): Promise<boolean> }`
- `class FakePayPal implements PayPalApi` with `constructor(opts: { seed: number; deliver: (d: SignedDelivery) => Promise<void> })`, `approve(orderId): Promise<void>` (buyer approval, emits APPROVED), `resend(eventId): Promise<void>`, `forge(event: WebhookEvent): SignedDelivery`, `facts(): { orders: PayPalOrder[]; events: WebhookEvent[] }`. Async methods await a seeded random delay of 0-3 ms so concurrent callers interleave deterministically.

- [ ] Tests: `createOrder` returns CREATED USD 1.00; capture before approve rejects; capture after approve yields one COMPLETED capture and emits PAYMENT.CAPTURE.COMPLETED; same requestId twice returns the same capture id and emits once (Review Focus 4); different requestId on a COMPLETED order rejects with `ORDER_ALREADY_CAPTURED`; `forge()` output fails `verifyWebhookSignature` (HMAC with a private key the forger lacks); `resend` delivers the identical body again. Run `node --test` and see FAIL, implement, see PASS, commit.

### Task 2: Shop store and two handler variants

**Files:**
- Create: `src/shop/store.ts`, `src/shop/types.ts`, `src/shop/buggy.ts`, `src/shop/fixed.ts`
- Test: `test/shop.test.ts`

**Interfaces:**
- Consumes: `PayPalApi`, `SignedDelivery`, `WebhookEvent` (Task 1).
- Produces: `class Store` over `node:sqlite` `:memory:` with tables `orders(id INTEGER PK, paypal_order_id TEXT, status TEXT)` and `grants(id INTEGER PK, paypal_order_id TEXT, sku TEXT, capture_id TEXT)`; `store.snapshot(): { orders: ShopOrder[]; grants: Grant[] }`.
- `interface ShopHandlers { checkout(sku: string): Promise<string /* paypal order id */>; complete(paypalOrderId: string): Promise<'PAID'|'FAILED'|'PENDING'>; onWebhook(d: SignedDelivery): Promise<number /* http status */> }`
- `createBuggyShop(api: PayPalApi, store: Store): ShopHandlers`, `createFixedShop(api: PayPalApi, store: Store): ShopHandlers`

Buggy behavior (each is one planted defect, business logic only): `complete` inserts a shop order if none exists (check-then-insert with an await in between), captures with a fresh random requestId per call, marks FAILED on any thrown error; APPROVED webhook also creates the order and captures; CAPTURE.COMPLETED webhook grants without dedupe.
Fixed behavior: unique index on `orders.paypal_order_id` and `grants(paypal_order_id, sku)` with INSERT OR IGNORE; requestId derived deterministically from the paypal order id (`cap-<id>`); on error or timeout status stays PENDING, then `getOrder` and, if not COMPLETED, retry with the same requestId; grant only from an observed COMPLETED capture.

- [ ] Tests (run against both variants where noted): forged webhook returns 400 and leaves snapshot empty in both (Review Focus 2); fixed: sequential happy path gives 1 order, 1 grant. Fail, implement, pass, commit.

### Task 3: Lossy network wrapper and traffic scenarios

**Files:**
- Create: `src/traffic/lossy.ts`, `src/traffic/scenarios.ts`
- Test: `test/scenarios.test.ts`

**Interfaces:**
- `withLostCaptureResponse(api: PayPalApi, times: number): PayPalApi` performs the real capture, then throws `new TimeoutError()` for the first `times` calls.
- `type EventOrder = 'webhook-first'|'agent-first'|'interleaved'`
- `type RunRecord = { scenario: 'A1'|'A2'|'A3'; variant: 'buggy'|'fixed'; seed: number; params: Record<string, unknown>; paypal: ReturnType<FakePayPal['facts']>; shop: ReturnType<Store['snapshot']>; log: string[]; outcomes: string[] }`
- `runA1(variant, { seed, n, order }): Promise<RunRecord>`: approve, then N concurrent `complete()` calls racing the APPROVED webhook in the given order.
- `runA2(variant, { seed }): Promise<RunRecord>`: first capture response lost, agent retries `complete()` once.
- `runA3(variant, { seed }): Promise<RunRecord>`: happy path, then `resend` of the CAPTURE.COMPLETED event.

- [ ] Tests: same seed twice gives identical `log` (Review Focus 5); RunRecord contains PayPal facts and shop snapshot. Fail, implement, pass, commit.

### Task 4: Invariant checker

**Files:**
- Create: `src/invariants/check.ts`
- Test: `test/invariants.test.ts`

**Interfaces:**
- `type Verdict = { id: 'I1'|'I2'|'I3'|'I4'; result: 'PASS'|'FAIL'|'UNKNOWN'; detail: string }`
- `checkRun(run: RunRecord): Verdict[]` (pure)
- I1 every grant has a COMPLETED capture on that PayPal order (no observed capture: UNKNOWN, Review Focus 3); I2 at most one grant per (paypal order, sku); I3 exactly one shop order per PayPal order that reached the shop; I4 no shop order FAILED while PayPal shows COMPLETED, and PayPal shows at most one capture per order.

- [ ] Tests with hand-built RunRecords for each verdict, including UNKNOWN. Fail, implement, pass, commit.

### Task 5: Scenario matrix proves buggy FAILs and fixed PASSes, plus CLI

**Files:**
- Create: `src/cli.ts` (`node src/cli.ts check [--variant buggy|fixed] [--json out.json]`), `test/matrix.test.ts`, `README.md` (run instructions, honest status)

- [ ] Tests: for A1 over all orders x N in [1,2,4], fixed has no FAIL (Review Focus 1); buggy has at least one FAIL in A1, A2, A3 each. CLI prints one line per scenario run with verdicts and exits 1 if any FAIL. Commit.

## Phase 2: live sandbox (needs her sandbox client ID/secret and public HTTPS)

### Task 6: Sandbox client and spike
- `src/paypal/sandbox.ts` implementing `PayPalApi` against `https://api-m.sandbox.paypal.com` (OAuth client credentials, `PayPal-Request-Id` header, `POST /v1/notifications/verify-webhook-signature`), origin guard test.
- Webhook receiver on `node:http` behind ngrok or Render; buyer approval via sandbox buyer account.
- Spike checklist from spec: real signed webhook verified; resend (`POST /v1/notifications/webhooks-events/{id}/resend`) delivers a second copy that also verifies. Record outcome in README; if resend fails, A3 falls back to a local replay of a verified event and says so.
- Recorder: save RunRecords with raw PayPal responses and event ids, secrets stripped, to `runs/*.json`.

## Phase 3: AI diagnosis loop (needs a model API key)

### Task 7: Diagnose and verify
- `src/ai/diagnose.ts`: input is FAIL verdicts + redacted log + handler source; output is `{ invariant, file, line, cause, patch (unified diff) }`. Patch is applied to a temp copy, the same scenario reruns on a fresh order; accepted only if before = FAIL and after = PASS. No auto-apply to the user's tree.

## Phase 4: report, replay mode, external code, submission
- Task 8: one-screen HTML report (verdicts before/after, PayPal facts vs shop rows, regression test export).
- Task 9: replay mode serving recorded runs on Render, labelled "recorded" with date; no keys.
- Task 10: run against 2-3 public Node PayPal integrations; honest results in README.
- Task 11: README, license, secret scan, video under 3 minutes, Devpost.
