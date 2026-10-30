// The evershop result for the report, read from a recorded run directory
// (recorded/evershop/). Nothing here executes evershop; it only summarises
// verdicts that the harness in external/evershop/ wrote on the recorded date.

import { readFileSync } from 'node:fs';
import type { Finding } from '../ai/diagnose.ts';

type Run = { seed: number; scenario: string; params: Record<string, unknown>; verdicts: { id: string; result: string }[]; shop: { grants: unknown[] } };
type Results = { commit: string; out: Run[] };

export type EvershopVariant = { key: string; seeds: number; fail: number; orderPlaced: number[] };
export type EvershopData = {
  commit: string;
  recordedAt: string;
  before: { runs: number; fail: number; variants: EvershopVariant[] };
  after: { runs: number; fail: number; unknown: number };
  proven: boolean;
  diagnosis: { model: string; costUsd?: number; findings: Finding[] };
  diff: string;
  file: string;
  fileUrl: string;
  issueUrl: string;
};

const FILE = 'packages/evershop/src/modules/paypal/services/finalizePaypalOrder.ts';
export const EVERSHOP_ISSUE = 'https://github.com/evershopcommerce/evershop/issues/1180';

const keyOf = (r: Run) => (r.scenario === 'A1' ? `A1 ${r.params.order} N=${r.params.n}` : r.scenario);
const worst = (r: Run) => (r.verdicts.some((v) => v.result === 'FAIL') ? 'FAIL' : r.verdicts.some((v) => v.result === 'UNKNOWN') ? 'UNKNOWN' : 'PASS');

export function loadEvershop(dir: string): EvershopData {
  const read = (name: string) => readFileSync(`${dir}/${name}`, 'utf8');
  const before: Results = JSON.parse(read('results-before.json'));
  const after: Results = JSON.parse(read('results-after.json'));
  const diagnosis = JSON.parse(read('diagnosis.json'));

  const variants = new Map<string, EvershopVariant>();
  for (const r of before.out) {
    const v = variants.get(keyOf(r)) ?? { key: keyOf(r), seeds: 0, fail: 0, orderPlaced: [] };
    v.seeds += 1;
    if (worst(r) === 'FAIL') v.fail += 1;
    if (!v.orderPlaced.includes(r.shop.grants.length)) v.orderPlaced.push(r.shop.grants.length);
    variants.set(v.key, v);
  }
  const line = diagnosis.findings[0]?.line ?? 1;
  return {
    commit: before.commit,
    recordedAt: read('RECORDED_AT').trim(),
    before: { runs: before.out.length, fail: before.out.filter((r) => worst(r) === 'FAIL').length, variants: [...variants.values()] },
    after: {
      runs: after.out.length,
      fail: after.out.filter((r) => worst(r) === 'FAIL').length,
      unknown: after.out.filter((r) => worst(r) === 'UNKNOWN').length,
    },
    proven: JSON.parse(read('proof.json')).proven === true,
    diagnosis: { model: diagnosis.model, costUsd: diagnosis.costUsd, findings: diagnosis.findings },
    diff: read('patch.diff')
      .split('\n')
      .filter((l) => !l.startsWith('diff --git') && !l.startsWith('index '))
      .join('\n')
      .replace(/(---|\+\+\+) [ab]\/vendor(-patched)?\/src\//g, '$1 '),
    file: 'finalizePaypalOrder.ts',
    fileUrl: `https://github.com/evershopcommerce/evershop/blob/${before.commit}/${FILE}#L${line}`,
    issueUrl: EVERSHOP_ISSUE,
  };
}
