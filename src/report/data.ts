// Everything the one-screen report shows, computed by the harness: the buggy
// shop's runs (before), the patched shop's runs (after, re-proven locally),
// the AI's findings and the diff.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMatrix } from '../matrix.ts';
import { proveFix } from '../ai/prove.ts';
import type { Finding } from '../ai/diagnose.ts';
import type { Verdict } from '../invariants/check.ts';
import type { RunRecord } from '../traffic/scenarios.ts';
import { regressionTestSource } from './regression.ts';
import type { EvershopData } from './evershop.ts';

export type Worst = 'PASS' | 'FAIL' | 'UNKNOWN';
export type RowSide = { worst: Worst; verdicts: Verdict[]; paypal?: RunRecord['paypal']; shop?: RunRecord['shop']; log?: string[] };
export type Row = { key: string; scenario: string; label: string; params: Record<string, unknown>; before: RowSide; after?: RowSide };

export type ReportData = {
  title: string;
  recordedAt: string;
  mode: string;
  seed: number;
  rows: Row[];
  proof: { proven: boolean; reasons: string[]; before: { fail: number; runs: number }; after: { fail: number; unknown: number; runs: number }; forgedRejected: boolean; seeds: number[] };
  diagnosis: { model: string; costUsd?: number; findings: Finding[] };
  diff: string;
  regressionTest: string;
  evershop?: EvershopData;
};

const LABELS: Record<string, string> = { A1: 'Race with the approval webhook', A2: 'Retry after a lost response', A3: 'Duplicate capture webhook' };

const worstOf = (verdicts: Verdict[]): Worst =>
  verdicts.some((v) => v.result === 'FAIL') ? 'FAIL' : verdicts.some((v) => v.result === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';

const keyOf = (scenario: string, params: Record<string, unknown>) =>
  scenario === 'A1' ? `A1 ${params.order} N=${params.n}` : scenario;

function diffAgainstBuggy(candidateSource: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pt-diff-'));
  try {
    const file = join(dir, 'patched.ts');
    writeFileSync(file, candidateSource);
    const out = spawnSync('git', ['diff', '--no-index', '--no-color', '-U2', '--', 'src/shop/buggy.ts', file], { encoding: 'utf8' }).stdout;
    return out.split('\n').filter((l) => !l.startsWith('diff --git') && !l.startsWith('index ')).join('\n').split(file).join('/patched/buggy.ts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function buildReportData(input: {
  candidateSource: string;
  diagnosis: { model: string; costUsd?: number; findings: Finding[] };
  recordedAt: string;
  seed?: number;
  evershop?: EvershopData;
}): Promise<ReportData> {
  const seed = input.seed ?? 1;
  const seeds = [1, 2, 3];
  const before = await runMatrix('buggy', seed);
  const proof = await proveFix(input.candidateSource, { seeds });
  const afterBySeed = new Map(proof.afterRuns.filter((r) => r.seed === seed).map((r) => [keyOf(r.scenario, r.params), r]));

  const rows: Row[] = before.map(({ run, verdicts }) => {
    const key = keyOf(run.scenario, run.params);
    const a = afterBySeed.get(key);
    return {
      key,
      scenario: run.scenario,
      label: LABELS[run.scenario],
      params: run.params,
      before: { worst: worstOf(verdicts), verdicts, paypal: run.paypal, shop: run.shop, log: run.log },
      after: a ? { worst: worstOf(a.verdicts), verdicts: a.verdicts, paypal: a.paypal, shop: a.shop, log: a.log } : undefined,
    };
  });

  return {
    title: 'Payment Truth',
    recordedAt: input.recordedAt,
    mode: 'offline fake PayPal',
    seed,
    rows,
    proof: { proven: proof.proven, reasons: proof.reasons, before: proof.before, after: proof.after, forgedRejected: proof.forgedRejected, seeds },
    diagnosis: input.diagnosis,
    diff: diffAgainstBuggy(input.candidateSource),
    regressionTest: regressionTestSource('./src/shop/buggy.ts'),
    evershop: input.evershop,
  };
}
