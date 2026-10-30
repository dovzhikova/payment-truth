import { checkRun } from './invariants/check.ts';
import type { Verdict } from './invariants/check.ts';
import { EVENT_ORDERS, runA1, runA2, runA3 } from './traffic/scenarios.ts';
import type { RunRecord, ShopFactory, Variant } from './traffic/scenarios.ts';

export type MatrixResult = { run: RunRecord; verdicts: Verdict[] };

export const A1_AGENT_COUNTS = [1, 2, 4];

// Every scenario the MVP checks: A1 over all event orders and agent counts, then A2 and A3.
export async function runMatrix(variant: Variant | ShopFactory, seed: number): Promise<MatrixResult[]> {
  const runs: RunRecord[] = [];
  for (const order of EVENT_ORDERS) {
    for (const n of A1_AGENT_COUNTS) runs.push(await runA1(variant, { seed, n, order }));
  }
  runs.push(await runA2(variant, { seed }));
  runs.push(await runA3(variant, { seed }));
  return runs.map((run) => ({ run, verdicts: checkRun(run) }));
}
