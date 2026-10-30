# Planted defects in src/shop/buggy.ts

Kept out of the source file so the AI diagnosis has no hints. The buggy shop verifies webhook signatures correctly; only business logic is wrong.

1. `complete()`: check-then-insert across an await, so concurrent calls create duplicate shop orders (I3).
2. `complete()`: a fresh PayPal-Request-Id per call, so a retry is a new capture attempt instead of a replay (I4).
3. `complete()`: any error marks the order FAILED, even when the capture went through and only the response was lost (I4).
4. Approval webhook: creates and captures the order when it is not there yet, racing the agent's own completion (I3, I4).
5. Capture webhook: grants on every delivery, so a redelivered event grants twice (I2).
