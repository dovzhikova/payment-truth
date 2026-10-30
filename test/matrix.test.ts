import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMatrix } from '../src/matrix.ts';

test('fixed shop: no FAIL and no UNKNOWN across scenarios, event orders, N and seeds', async () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const { run, verdicts } of await runMatrix('fixed', seed)) {
      const bad = verdicts.filter((v) => v.result !== 'PASS');
      assert.deepEqual(bad, [], `${run.scenario} ${JSON.stringify(run.params)} seed ${seed}`);
    }
  }
});

test('buggy shop: every scenario has at least one FAIL', async () => {
  const results = await runMatrix('buggy', 1);
  for (const scenario of ['A1', 'A2', 'A3']) {
    const fails = results.filter((r) => r.run.scenario === scenario).flatMap((r) => r.verdicts).filter((v) => v.result === 'FAIL');
    assert.ok(fails.length > 0, `${scenario} should FAIL on the buggy shop`);
  }
});

test('the A1 matrix covers every event order and N in 1, 2, 4', async () => {
  const a1 = (await runMatrix('fixed', 1)).filter((r) => r.run.scenario === 'A1').map((r) => `${r.run.params.order}/${r.run.params.n}`);
  assert.equal(a1.length, 9);
  for (const order of ['webhook-first', 'agent-first', 'interleaved']) for (const n of [1, 2, 4]) assert.ok(a1.includes(`${order}/${n}`));
});
