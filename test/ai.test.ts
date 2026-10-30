import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPrompt, parseDiagnosis, redact } from '../src/ai/diagnose.ts';
import { proveFix } from '../src/ai/prove.ts';
import { runMatrix } from '../src/matrix.ts';

const buggySource = readFileSync('src/shop/buggy.ts', 'utf8');
const fixedSource = readFileSync('src/shop/fixed.ts', 'utf8');

test('redact removes secret values and bearer-like tokens', () => {
  const out = redact('key sk-or-v1-abcdef0123456789abcdef0123456789abcdef01 and SECRETVALUE123 here', ['SECRETVALUE123']);
  assert.ok(!out.includes('SECRETVALUE123'));
  assert.ok(!out.includes('sk-or-v1-abcdef'));
});

test('the prompt carries failing verdicts and the handler source, and no secrets', async () => {
  const failing = (await runMatrix('buggy', 1)).filter((r) => r.verdicts.some((v) => v.result === 'FAIL'));
  const messages = buildPrompt({ failing, sourcePath: 'src/shop/buggy.ts', source: buggySource, secrets: ['TOPSECRET'] });
  const text = messages.map((m) => m.content).join('\n');
  assert.ok(text.includes('I3 FAIL'));
  assert.ok(text.includes('createBuggyShop'));
  assert.ok(!text.includes('TOPSECRET'));
});

test('parseDiagnosis reads JSON inside a code fence', () => {
  const d = parseDiagnosis('Here:\n```json\n{"findings":[{"invariant":"I2","line":61,"cause":"grant per delivery"}],"fixed_source":"export const x = 1;"}\n```');
  assert.equal(d.findings[0].invariant, 'I2');
  assert.equal(d.findings[0].line, 61);
  assert.equal(d.fixedSource, 'export const x = 1;');
});

test('parseDiagnosis rejects output without a fixed source', () => {
  assert.throws(() => parseDiagnosis('{"findings":[]}'), /fixed_source/);
});

test('a correct patch is proven: before FAIL, after PASS, forged webhook still rejected', async () => {
  const proof = await proveFix(fixedSource);
  assert.equal(proof.proven, true, JSON.stringify(proof.reasons));
  assert.equal(proof.after.fail, 0);
  assert.equal(proof.forgedRejected, true);
});

test('an unchanged buggy handler is not proven', async () => {
  const proof = await proveFix(buggySource);
  assert.equal(proof.proven, false);
  assert.ok(proof.after.fail > 0);
});

test('a patch that drops signature verification is not proven even if invariants pass', async () => {
  const unsafe = fixedSource.replace('if (!(await api.verifyWebhookSignature(delivery))) return 400;', '');
  assert.notEqual(unsafe, fixedSource);
  const proof = await proveFix(unsafe);
  assert.equal(proof.forgedRejected, false);
  assert.equal(proof.proven, false);
});

test('a patch that does not load is not proven', async () => {
  const proof = await proveFix('export function nope( {');
  assert.equal(proof.proven, false);
  assert.ok(proof.reasons.some((r) => /load|syntax|factory/i.test(r)));
});

test('a candidate with a real relative import loads, and the sandbox blocks file writes', async () => {
  const withImport = fixedSource.replace("import { randomUUID } from 'node:crypto';", "import { randomUUID } from 'node:crypto';\nimport { PayPalError } from '../paypal/types.ts';\nvoid PayPalError;");
  const ok = await proveFix(withImport);
  assert.equal(ok.proven, true, JSON.stringify(ok.reasons));
  const writer = fixedSource.replace("import { randomUUID } from 'node:crypto';", "import { randomUUID } from 'node:crypto';\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('/tmp/payment-truth-escape.txt', 'x');");
  const blocked = await proveFix(writer);
  assert.equal(blocked.proven, false);
  assert.ok(blocked.reasons.some((r) => /ERR_ACCESS_DENIED|load failed|access/i.test(r)), JSON.stringify(blocked.reasons));
});
