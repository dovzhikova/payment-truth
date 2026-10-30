import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReportData } from '../src/report/data.ts';
import { renderReport } from '../src/report/html.ts';
import { regressionTestSource } from '../src/report/regression.ts';
import { loadEvershop } from '../src/report/evershop.ts';

const fixedSource = readFileSync('src/shop/fixed.ts', 'utf8');
const diagnosis = { model: 'stub-model', costUsd: 0.08, findings: [{ invariant: 'I2', line: 44, cause: 'grant per delivery' }] };

test('report data pairs every before run with its after run', async () => {
  const data = await buildReportData({ candidateSource: fixedSource, diagnosis, recordedAt: '2026-10-30T11:38:33Z' });
  assert.equal(data.rows.length, 11);
  for (const row of data.rows) {
    assert.ok(row.before.verdicts.length === 4 && row.after?.verdicts.length === 4, row.key);
    assert.equal(row.after?.worst, 'PASS', row.key);
  }
  assert.ok(data.rows.some((r) => r.before.worst === 'FAIL'));
  assert.equal(data.proof.proven, true);
  assert.equal(data.mode, 'offline fake PayPal');
});

test('the rendered page is self-contained and labels recorded data', async () => {
  const data = await buildReportData({ candidateSource: fixedSource, diagnosis, recordedAt: '2026-10-30T11:38:33Z' });
  const html = renderReport(data);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!/<script[^>]+src=|<link[^>]+href="http/i.test(html), 'no external scripts or styles');
  assert.ok(html.includes('Recorded 2026-10-30'));
  assert.ok(html.includes('PROVEN'));
  assert.ok(html.includes('grant per delivery'));
  assert.ok(!html.includes('—'), 'no em dashes');
});

test('embedded data cannot break out of the script tag', async () => {
  const data = await buildReportData({
    candidateSource: fixedSource + '\n// </script><script>alert(1)</script>\n',
    diagnosis: { ...diagnosis, findings: [{ invariant: 'I1', line: 1, cause: '</script><img src=x onerror=alert(1)>' }] },
    recordedAt: '2026-10-30T11:38:33Z',
  });
  const html = renderReport(data);
  assert.equal(html.match(/<\/script>/gi)?.length, 2, 'only the two real closing tags');
});

test('exported regression test asserts no FAIL across every scenario', () => {
  const src = regressionTestSource('./src/shop/fixed.ts');
  assert.ok(src.includes("import { runMatrix }"));
  assert.ok(src.includes('./src/shop/fixed.ts'));
  assert.ok(src.includes("v.result !== 'PASS'"));
});

test('the recorded evershop result is summarised from its saved verdicts', () => {
  const e = loadEvershop('recorded/evershop');
  assert.equal(e.commit, 'f33f72cd02bc20fd5d9b2b111bdda46b79b77200');
  assert.deepEqual([e.before.fail, e.before.runs], [27, 33]);
  assert.deepEqual([e.after.fail, e.after.unknown, e.after.runs], [0, 0, 33]);
  assert.equal(e.proven, true);
  const n4 = e.before.variants.find((v) => v.key === 'A1 webhook-first N=4');
  assert.deepEqual(n4?.orderPlaced, [5]);
  assert.ok(e.fileUrl.endsWith('finalizePaypalOrder.ts#L68'));
  assert.ok(e.diff.includes('FOR UPDATE') && !e.diff.includes('vendor-patched'));
});

test('the report shows the evershop panel only when given recorded evershop data', async () => {
  const data = await buildReportData({ candidateSource: fixedSource, diagnosis, recordedAt: '2026-10-30T11:38:33Z', evershop: loadEvershop('recorded/evershop') });
  const html = renderReport(data);
  assert.ok(html.includes('id="evershop"') && html.includes('issues/1180'));
  assert.ok(!renderReport({ ...data, evershop: undefined }).includes('id="evershop"'));
  assert.ok(!html.includes('—'), 'no em dashes');
});
