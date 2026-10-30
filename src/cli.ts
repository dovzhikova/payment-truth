// node src/cli.ts check [--variant buggy|fixed|both] [--seed N] [--json out.json]
// Exits 1 when any invariant FAILs.

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runMatrix } from './matrix.ts';
import type { MatrixResult } from './matrix.ts';
import type { Variant } from './traffic/scenarios.ts';

const LABELS = { A1: 'race', A2: 'retry after timeout', A3: 'duplicate webhook' } as const;

function describe(r: MatrixResult): string {
  const { run, verdicts } = r;
  const params = run.scenario === 'A1' ? ` ${run.params.order} N=${run.params.n}` : '';
  const worst = verdicts.some((v) => v.result === 'FAIL') ? 'FAIL' : verdicts.some((v) => v.result === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
  const head = `${run.scenario} ${LABELS[run.scenario]}${params}`.padEnd(40) + worst;
  const notes = verdicts.filter((v) => v.result !== 'PASS').map((v) => `    ${v.id} ${v.result}: ${v.detail}`);
  return [head, ...notes].join('\n');
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { variant: { type: 'string', default: 'both' }, seed: { type: 'string', default: '1' }, json: { type: 'string' } },
  });
  if (positionals[0] !== 'check') {
    console.error('usage: node src/cli.ts check [--variant buggy|fixed|both] [--seed N] [--json out.json]');
    return 2;
  }
  const variants: Variant[] = values.variant === 'both' ? ['buggy', 'fixed'] : [values.variant as Variant];
  if (!variants.every((v) => v === 'buggy' || v === 'fixed')) {
    console.error(`unknown variant: ${values.variant}`);
    return 2;
  }
  const seed = Number(values.seed);
  const all: Record<string, MatrixResult[]> = {};
  let failed = false;
  for (const variant of variants) {
    const results = await runMatrix(variant, seed);
    all[variant] = results;
    console.log(`\n${variant} shop under agent traffic (offline fake PayPal, seed ${seed})`);
    for (const r of results) console.log(describe(r));
    if (results.some((r) => r.verdicts.some((v) => v.result === 'FAIL'))) failed = true;
  }
  if (values.json) writeFileSync(values.json, JSON.stringify(all, null, 2));
  return failed ? 1 : 0;
}

process.exitCode = await main();
