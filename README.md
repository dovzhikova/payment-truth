# Payment Truth

AI buyer agents already pay through PayPal. Is your shop's backend ready for them?

Payment Truth drives a shop's PayPal backend with agent-shaped traffic (retries after a timeout, parallel completions, races with PayPal's webhooks) and checks the result against deterministic invariants. When an invariant fails, an AI finds the cause in the shop's code and proposes a patch; the patch counts as proven only when the same scenario fails before it and passes after it.

## Status (2026-10-30)

| Part | State |
| --- | --- |
| Offline core: fake PayPal, demo shop (buggy and fixed), scenarios A1 to A3, invariants I1 to I4, CLI | Done |
| Live PayPal sandbox client, real signed webhooks, webhook resend | Client done. Spike on 2026-10-30: real approval and capture webhooks received over a tunnel; capture webhook signature verified; same PayPal-Request-Id returns the same capture; a different one is rejected with ORDER_ALREADY_CAPTURED; webhook resend redelivers the same event id with a valid signature. Approval webhook signature not yet checked. |
| AI diagnosis and proven patch loop | Done. `node src/cli.ts diagnose` (OpenRouter, default `anthropic/claude-opus-5.5`). First hint-free run on 2026-10-30: 4 findings at the right lines, patch proven (28/33 runs FAIL before, 0/33 after, forged webhooks still rejected), $0.08. The planted defects are listed in `docs/planted-defects.md`, not in the source the AI reads. |
| One-screen report, replay mode on Render | Not started |

The scenario matrix below runs offline against an in-memory PayPal. The live spike (`node src/spike.ts`) runs one real sandbox order end to end; it needs `.env` with sandbox credentials, `cloudflared`, and a person to approve the order as the sandbox buyer.

## Run it

Requires Node 24 or newer. No dependencies to install.

```bash
npm test
node src/cli.ts check                      # buggy and fixed shop, exits 1 if any invariant FAILs
node src/cli.ts check --variant fixed --seed 3
node src/cli.ts check --json results.json
```

## Scenarios

The agent behaviour is our model of how a buying agent acts, not a measurement of any specific agent.

| ID | What the "agent" does |
| --- | --- |
| A1 race | Completes the purchase right after approval while `CHECKOUT.ORDER.APPROVED` arrives in parallel. Runs with 1, 2 and 4 concurrent completions, in three event orders. Modelled on [woocommerce-paypal-payments#4173](https://github.com/woocommerce/woocommerce-paypal-payments/issues/4173). |
| A2 retry after timeout | The capture succeeds at PayPal but the response is lost; the agent retries. |
| A3 duplicate webhook | A normal purchase, then PayPal delivers `PAYMENT.CAPTURE.COMPLETED` again. |

## Invariants

Each one is PASS, FAIL or UNKNOWN. Missing data is never PASS.

| ID | Rule |
| --- | --- |
| I1 | Every grant rests on a COMPLETED capture PayPal reports for that order. |
| I2 | One PayPal order and one SKU give at most one grant. |
| I3 | One PayPal order maps to exactly one shop order. |
| I4 | An unknown capture outcome is reconciled with PayPal, never FAILED without proof; at most one capture per order. |

## Layout

```
src/paypal/      PayPalApi interface and the in-memory FakePayPal
src/shop/        SQLite store, buggy.ts (planted defects) and fixed.ts
src/traffic/     held webhook network, lossy capture network, scenarios A1-A3
src/invariants/  checkRun: verdicts for I1-I4
src/matrix.ts    every scenario the MVP checks
src/cli.ts       command line
```

## How a patch is proven

`diagnose` sends the AI the failing verdicts, the event log, PayPal facts, shop rows and the handler source, with secrets redacted. The AI returns findings and a corrected file. The harness, not the AI, then:

1. runs the corrected file in a child process under the Node permission model (read access to `src/` only, no child processes, no file writes, empty environment, so no secrets are reachable; network access is not blocked by Node 24's permission model);
2. runs every scenario on seeds 1, 2 and 3;
3. checks that forged webhooks are still rejected.

The patch counts as proven only if the original shop FAILs, the patched one has no FAIL and no UNKNOWN, and forged webhooks are rejected. It is saved under `runs/patches/` with a diff; `src/` is never changed.

## Safety

Sandbox only. Webhook signatures are verified before any business logic in both shop variants; the buggy variant breaks business logic only. Secrets belong in a local `.env`, which is gitignored, and never in prompts, exports or recorded runs.

## License

MIT
