// node diagnose.ts            (run from external/evershop after setup.sh)
// 1. runs scenarios on evershop as published (before)
// 2. asks the AI for the cause and a corrected finalizePaypalOrder.ts
// 3. reruns every scenario on seeds 1-3 against a patched copy, in a child
//    process under the Node permission model with an empty environment
// 4. saves candidate, diff, diagnosis and proof under ../../runs/patches-evershop/
// Only finalizePaypalOrder.ts is replaced, so webhook signature verification
// (paypalWebhook.ts) is evershop's own code in both runs.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '../../src/config.ts';
import { parseDiagnosis, redact } from '../../src/ai/diagnose.ts';
import { DEFAULT_MODEL, openRouterModel } from '../../src/ai/model.ts';

const HERE = resolve('.');
const FINALIZE = 'modules/paypal/services/finalizePaypalOrder.ts';
type Out = { commit: string; out: { seed: number; scenario: string; params: Record<string, unknown>; verdicts: { id: string; result: string; detail: string }[]; shop: unknown; paypal: unknown; log: string[] }[] };

function runScenarios(label: string, srcDir: string, seeds: string, resultsFile: string): Out {
  rmSync(resultsFile, { force: true });
  const args = [
    '--permission',
    `--allow-fs-read=${HERE}`,
    `--allow-fs-read=${resolve('../../src')}`,
    '--allow-fs-read=/tmp',
    `--allow-fs-write=${resultsFile}`,
    '--allow-worker', // module.register runs loader hooks in a worker; workers inherit these limits
    '--import', './register.mjs', 'run.ts', seeds,
  ];
  const r = spawnSync(process.execPath, args, { env: { PATH: '/usr/bin:/bin', PT_EVERSHOP_SRC: srcDir, PT_RESULTS: resultsFile }, encoding: 'utf8', timeout: 300_000 });
  if (r.status !== 0) {
    console.error(`${label} run failed (exit ${r.status}):\n${(r.stderr || r.stdout).split('\n').slice(0, 12).join('\n')}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(resultsFile, 'utf8')) as Out;
}

const fails = (o: Out) => o.out.filter((r) => r.verdicts.some((v) => v.result === 'FAIL')).length;
const unknowns = (o: Out) => o.out.filter((r) => r.verdicts.some((v) => v.result === 'UNKNOWN')).length;

const env = { ...loadEnv('../../.env'), ...process.env } as Record<string, string>;
if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing in ../../.env');
const model = env.PT_MODEL ?? DEFAULT_MODEL;
const secrets = Object.entries(env).filter(([k]) => /KEY|SECRET|TOKEN|PASSWORD/.test(k)).map(([, v]) => v);

const before = runScenarios('before', resolve('vendor/src'), '1', resolve('results-before.json'));
console.log(`before (evershop ${before.commit.slice(0, 7)}): ${fails(before)}/${before.out.length} runs FAIL`);

const failing = before.out.filter((r) => r.verdicts.some((v) => v.result === 'FAIL'));
const sample = [failing[0], failing.find((r) => (r.params.n as number) === 4)].filter(Boolean);
const source = readFileSync(`vendor/src/${FINALIZE}`, 'utf8');
const context = ['modules/paypal/pages/frontStore/paypalReturn/index.ts', 'modules/paypal/services/paypalWebhook.ts']
  .map((f) => `--- ${f} (read-only context) ---\n${readFileSync(`vendor/src/${f}`, 'utf8')}`).join('\n\n');
const runs = sample.map((r) => [
  `### ${r.scenario} ${JSON.stringify(r.params)}`,
  ...r.verdicts.filter((v) => v.result !== 'PASS').map((v) => `${v.id} ${v.result}: ${v.detail}`),
  'Event log:', ...r.log.map((l) => `  ${l}`),
  `Shop state (grant = one order_placed row in the event table): ${JSON.stringify(r.shop)}`,
].join('\n')).join('\n\n');
const numbered = source.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
const system = `You review the PayPal integration of evershop, an open-source Node e-commerce platform (Postgres, READ COMMITTED). A deterministic harness ran its real code under agent-shaped traffic: the buyer's return page and PayPal's CHECKOUT.ORDER.APPROVED webhook finalize the same order concurrently. Invariant I2 says one PayPal order gives at most one fulfillment, and fulfillment here is one 'order_placed' event row. Find the cause in finalizePaypalOrder.ts and return a corrected version of that file only.
Rules: you do not decide whether the fix works; the harness reruns every scenario. Keep every export and signature, keep the existing imports from '@evershop/postgres-query-builder' and other modules (you may add names to existing import lists from the same modules), add no new dependencies, keep behaviour for sequential calls.
Reply with one JSON object only: {"findings":[{"invariant":"I2","line":<line in finalizePaypalOrder.ts>,"cause":"<one sentence>"}],"fixed_source":"<complete corrected finalizePaypalOrder.ts>"}`;
const user = `Failing runs:\n\n${runs}\n\nFile ${FINALIZE} (line numbers for reference only):\n${numbered}\n\n${context}`;

console.log(`asking ${model} for the cause`);
const reply = await openRouterModel(env.OPENROUTER_API_KEY, model)([{ role: 'system', content: system }, { role: 'user', content: redact(user, secrets) }]);
console.log(`model ${reply.model ?? model}, cost ${reply.costUsd !== undefined ? '$' + reply.costUsd.toFixed(4) : 'not reported'}`);
const diagnosis = parseDiagnosis(reply.text);
for (const f of diagnosis.findings) console.log(`  ${f.invariant} at ${FINALIZE}:${f.line}: ${f.cause}`);

rmSync('vendor-patched', { recursive: true, force: true });
cpSync('vendor', 'vendor-patched', { recursive: true });
writeFileSync(`vendor-patched/src/${FINALIZE}`, diagnosis.fixedSource);
const after = runScenarios('after', resolve('vendor-patched/src'), '1,2,3', resolve('results-after.json'));
const proven = fails(before) > 0 && fails(after) === 0 && unknowns(after) === 0;
console.log(`after (patched copy, seeds 1-3): ${fails(after)}/${after.out.length} runs FAIL, ${unknowns(after)} UNKNOWN`);
console.log(proven ? 'PROVEN: every scenario passes on the patched copy' : 'NOT PROVEN');

const dir = resolve(`../../runs/patches-evershop/${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/candidate.ts`, diagnosis.fixedSource);
writeFileSync(`${dir}/diagnosis.json`, JSON.stringify({ evershopCommit: before.commit, model: reply.model ?? model, costUsd: reply.costUsd, findings: diagnosis.findings }, null, 2));
writeFileSync(`${dir}/proof.json`, JSON.stringify({ proven, before: { fail: fails(before), runs: before.out.length }, after: { fail: fails(after), unknown: unknowns(after), runs: after.out.length } }, null, 2));
writeFileSync(`${dir}/patch.diff`, spawnSync('git', ['diff', '--no-index', '--no-color', '--', `vendor/src/${FINALIZE}`, `vendor-patched/src/${FINALIZE}`], { encoding: 'utf8' }).stdout);
console.log(`saved ${dir}/ (candidate.ts, patch.diff, diagnosis.json, proof.json); evershop's vendor/ copy was not changed`);
