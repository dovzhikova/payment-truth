// A patch counts as proven only when the baseline FAILs, the candidate passes
// every scenario on several seeds with no UNKNOWN, and forged webhooks are
// still rejected. The candidate runs in a sandboxed child process; it is
// never applied to the source tree.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatrix } from '../matrix.ts';
import type { Verdict } from '../invariants/check.ts';
import type { RunRecord, Variant } from '../traffic/scenarios.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Candidates sit next to the real handlers so their relative imports resolve the same way.
const CANDIDATES = join(SRC, 'shop');

export type WorkerRun = {
  scenario: string;
  params: Record<string, unknown>;
  seed: number;
  verdicts: Verdict[];
  paypal?: RunRecord['paypal'];
  shop?: RunRecord['shop'];
  log?: string[];
};
type WorkerOut = { loaded: boolean; error?: string; factory?: string; runs?: WorkerRun[]; forgedRejected?: boolean };

export type Proof = {
  proven: boolean;
  reasons: string[];
  before: { fail: number; runs: number };
  after: { fail: number; unknown: number; runs: number };
  forgedRejected: boolean;
  afterRuns: WorkerRun[];
};

function runWorker(candidatePath: string, seeds: number[]): Promise<WorkerOut> {
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      ['--permission', `--allow-fs-read=${SRC}`, join(SRC, 'ai', 'prove-worker.ts'), candidatePath, seeds.join(',')],
      { env: {}, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split('\n').pop() ?? '';
      try {
        done(JSON.parse(line) as WorkerOut);
      } catch {
        done({ loaded: false, error: `worker gave no result: ${err.split('\n').find((l) => /Error/.test(l)) ?? err.slice(0, 200)}` });
      }
    });
  });
}

export async function proveFix(candidateSource: string, opts: { baseline?: Variant; seeds?: number[] } = {}): Promise<Proof> {
  const baseline = opts.baseline ?? 'buggy';
  const seeds = opts.seeds ?? [1, 2, 3];
  const reasons: string[] = [];

  const beforeRuns = (await Promise.all(seeds.map((s) => runMatrix(baseline, s)))).flat();
  const beforeFail = beforeRuns.filter((r) => r.verdicts.some((v) => v.result === 'FAIL')).length;
  if (beforeFail === 0) reasons.push('baseline has no FAIL, so there is nothing to prove');

  const file = join(CANDIDATES, `.cand-${createHash('sha256').update(candidateSource).digest('hex').slice(0, 12)}.ts`);
  writeFileSync(file, candidateSource);
  let out: WorkerOut;
  try {
    out = await runWorker(file, seeds);
  } finally {
    rmSync(file, { force: true });
  }

  if (!out.loaded || out.error) reasons.push(out.error ?? 'candidate did not load');
  const afterRuns = out.runs ?? [];
  const afterFail = afterRuns.filter((r) => r.verdicts.some((v) => v.result === 'FAIL')).length;
  const afterUnknown = afterRuns.filter((r) => r.verdicts.some((v) => v.result === 'UNKNOWN')).length;
  if (afterRuns.length === 0) reasons.push('no scenario ran on the candidate');
  if (afterFail > 0) reasons.push(`${afterFail} run(s) still FAIL`);
  if (afterUnknown > 0) reasons.push(`${afterUnknown} run(s) UNKNOWN`);
  const forgedRejected = out.forgedRejected === true;
  if (out.loaded && !out.error && !forgedRejected) reasons.push('forged webhooks are no longer rejected');

  return {
    proven: reasons.length === 0,
    reasons,
    before: { fail: beforeFail, runs: beforeRuns.length },
    after: { fail: afterFail, unknown: afterUnknown, runs: afterRuns.length },
    forgedRejected,
    afterRuns,
  };
}
