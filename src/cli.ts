// node src/cli.ts check [--variant buggy|fixed|both] [--seed N] [--json out.json]
//   Exits 1 when any invariant FAILs.
// node src/cli.ts diagnose [--model id]
//   Runs the buggy shop, asks the AI for the cause and a patch, proves the
//   patch in a sandbox and saves it under runs/patches/. Never edits src/.
// node src/cli.ts report [--patch runs/patches/<dir>] [--evershop recorded/evershop] [--out runs/report/index.html]
//   Re-proves the latest saved patch locally and writes the one-screen report.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from './config.ts';
import { diagnose } from './ai/diagnose.ts';
import { DEFAULT_MODEL, openRouterModel } from './ai/model.ts';
import { proveFix } from './ai/prove.ts';
import { existsSync, readdirSync } from 'node:fs';
import { loadEvershop } from './report/evershop.ts';
import { buildReportData } from './report/data.ts';
import { renderReport } from './report/html.ts';
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

async function runDiagnose(modelId: string): Promise<number> {
  const env = { ...loadEnv(), ...process.env } as Record<string, string>;
  if (!env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is missing in .env');
    return 2;
  }
  const sourcePath = 'src/shop/buggy.ts';
  const source = readFileSync(sourcePath, 'utf8');
  const failing = (await runMatrix('buggy', 1)).filter((r) => r.verdicts.some((v) => v.result === 'FAIL'));
  console.log(`buggy shop: ${failing.length} failing run(s); asking ${modelId} for the cause`);
  const secrets = Object.entries(env).filter(([k]) => /KEY|SECRET|TOKEN|PASSWORD/.test(k)).map(([, v]) => v);
  const { diagnosis, reply } = await diagnose({ failing, sourcePath, source, secrets }, openRouterModel(env.OPENROUTER_API_KEY, modelId));
  console.log(`model ${reply.model ?? modelId}, cost ${reply.costUsd !== undefined ? '$' + reply.costUsd.toFixed(4) : 'not reported'}`);
  for (const f of diagnosis.findings) console.log(`  ${f.invariant} at ${sourcePath}:${f.line}: ${f.cause}`);
  const proof = await proveFix(diagnosis.fixedSource);
  console.log(`before: ${proof.before.fail}/${proof.before.runs} runs FAIL; after: ${proof.after.fail}/${proof.after.runs} FAIL, ${proof.after.unknown} UNKNOWN; forged webhooks rejected: ${proof.forgedRejected}`);
  console.log(proof.proven ? 'PROVEN: the patch fixes every failing scenario and keeps signature checks' : `NOT PROVEN: ${proof.reasons.join('; ')}`);
  const dir = `runs/patches/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/candidate.ts`, diagnosis.fixedSource);
  writeFileSync(`${dir}/diagnosis.json`, JSON.stringify({ model: reply.model ?? modelId, costUsd: reply.costUsd, findings: diagnosis.findings }, null, 2));
  writeFileSync(`${dir}/proof.json`, JSON.stringify(proof, null, 2));
  const diff = spawnSync('git', ['diff', '--no-index', '--', sourcePath, `${dir}/candidate.ts`], { encoding: 'utf8' });
  writeFileSync(`${dir}/patch.diff`, diff.stdout);
  console.log(`saved ${dir}/ (candidate.ts, patch.diff, diagnosis.json, proof.json); src/ was not changed`);
  return proof.proven ? 0 : 1;
}

async function runReport(patchDir: string | undefined, out: string, evershopDir?: string): Promise<number> {
  const dirs = !existsSync('runs/patches') ? [] : readdirSync('runs/patches', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const dir = patchDir ?? (dirs.length ? `runs/patches/${dirs.at(-1)}` : undefined);
  if (!dir) {
    console.error('no saved patch; run `node src/cli.ts diagnose` first');
    return 2;
  }
  const diagnosis = JSON.parse(readFileSync(`${dir}/diagnosis.json`, 'utf8'));
  const recordedAt = existsSync(`${dir}/RECORDED_AT`)
    ? readFileSync(`${dir}/RECORDED_AT`, 'utf8').trim()
    : dir.split('/').pop()!.replace(/T(\d\d)-(\d\d)-(\d\d)-\d+Z$/, 'T$1:$2:$3Z');
  const evershop = evershopDir ? loadEvershop(evershopDir) : undefined;
  const data = await buildReportData({ candidateSource: readFileSync(`${dir}/candidate.ts`, 'utf8'), diagnosis, recordedAt, evershop });
  mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  writeFileSync(out, renderReport(data));
  console.log(`report written to ${out} from ${dir} (proven: ${data.proof.proven})`);
  return 0;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      variant: { type: 'string', default: 'both' },
      seed: { type: 'string', default: '1' },
      json: { type: 'string' },
      model: { type: 'string' },
      patch: { type: 'string' },
      evershop: { type: 'string' },
      out: { type: 'string', default: 'runs/report/index.html' },
    },
  });
  if (positionals[0] === 'report') return runReport(values.patch, values.out!, values.evershop);
  if (positionals[0] === 'diagnose') return runDiagnose(values.model ?? loadEnv().PT_MODEL ?? DEFAULT_MODEL);
  if (positionals[0] !== 'check') {
    console.error('usage: node src/cli.ts check [--variant buggy|fixed|both] [--seed N] [--json out.json]\n       node src/cli.ts diagnose [--model id]');
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
