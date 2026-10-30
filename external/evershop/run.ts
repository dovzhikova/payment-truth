// node --import ./register.mjs run.ts [seeds]
// Runs evershop's real PayPal code under scenarios A1-A3 and prints verdicts.
import { readFileSync, writeFileSync } from 'node:fs';
import { runMatrix } from '../../src/matrix.ts';
import { close, createEvershopShop } from './adapter.ts';

const seeds = (process.argv[2] ?? '1,2,3').split(',').map(Number);
const commit = readFileSync(new URL('./vendor/COMMIT', import.meta.url), 'utf8').trim();
console.log(`evershop @ ${commit.slice(0, 7)} (real PayPal code, Postgres 15), seeds ${seeds.join(',')}`);
const out = [];
for (const seed of seeds) {
  for (const { run, verdicts } of await runMatrix(createEvershopShop, seed)) {
    const bad = verdicts.filter((v) => v.result !== 'PASS');
    const label = run.scenario === 'A1' ? `A1 ${run.params.order} N=${run.params.n}` : run.scenario;
    console.log(`seed ${seed} ${label.padEnd(26)} ${bad.length ? bad.map((v) => `${v.id} ${v.result}: ${v.detail}`).join(' | ') : 'PASS'}`);
    out.push({ seed, scenario: run.scenario, params: run.params, verdicts, shop: run.shop, paypal: run.paypal, log: run.log });
  }
}
writeFileSync(process.env.PT_RESULTS ?? new URL('./results.json', import.meta.url), JSON.stringify({ commit, out }, null, 2));
await close();
