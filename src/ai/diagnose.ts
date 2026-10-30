// The AI looks for the cause and proposes a patch. It never decides a
// verdict: prove.ts reruns the scenarios and the invariants decide.

import type { MatrixResult } from '../matrix.ts';
import { INVARIANT_RULES } from '../invariants/check.ts';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelReply = { text: string; costUsd?: number; model?: string };
export type ModelFn = (messages: ChatMessage[]) => Promise<ModelReply>;

export type Finding = { invariant: string; line: number; cause: string };
export type Diagnosis = { findings: Finding[]; fixedSource: string };

const TOKEN_PATTERNS = [/sk-or-v1-[A-Za-z0-9]{20,}/g, /sk-ant-[A-Za-z0-9_-]{20,}/g, /Bearer\s+[A-Za-z0-9._-]{20,}/g, /[A-Za-z0-9_-]{60,}/g];

// Removes known secret values and anything shaped like a credential.
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[REDACTED]');
  for (const re of TOKEN_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

const SYSTEM = `You review the PayPal integration of an online shop. A deterministic test harness ran the shop under agent-shaped traffic and some invariants FAILED. Find the cause in the source and return a corrected file.

Rules:
- You do not decide whether the fix works. The harness reruns every scenario and the invariants decide.
- Change business logic only. Keep the webhook signature check as the first step of onWebhook.
- Keep the exported factory function's name and signature, and keep the existing imports; add no new dependencies.
- Reply with one JSON object, nothing else:
  {"findings":[{"invariant":"I3","line":<line number in the given file>,"cause":"<one sentence>"}],"fixed_source":"<the complete corrected file>"}`;

export function buildPrompt(input: { failing: MatrixResult[]; sourcePath: string; source: string; secrets: string[] }): ChatMessage[] {
  const rules = Object.entries(INVARIANT_RULES).map(([id, rule]) => `${id}: ${rule}`).join('\n');
  const runs = input.failing
    .map(({ run, verdicts }) => {
      const params = Object.keys(run.params).length ? ` ${JSON.stringify(run.params)}` : '';
      return [
        `### ${run.scenario}${params}`,
        ...verdicts.filter((v) => v.result !== 'PASS').map((v) => `${v.id} ${v.result}: ${v.detail}`),
        'Event log:',
        ...run.log.map((l) => `  ${l}`),
        `PayPal orders: ${JSON.stringify(run.paypal.orders.map((o) => ({ id: o.id, status: o.status, captures: o.captures.map((c) => c.id) })))}`,
        `Shop orders: ${JSON.stringify(run.shop.orders)}`,
        `Shop grants: ${JSON.stringify(run.shop.grants)}`,
      ].join('\n');
    })
    .join('\n\n');
  const numbered = input.source.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
  const user = `Invariants:\n${rules}\n\nFailing runs:\n\n${runs}\n\nFile ${input.sourcePath} (line numbers added for reference, do not include them in fixed_source):\n${numbered}`;
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: redact(user, input.secrets) },
  ];
}

export function parseDiagnosis(text: string): Diagnosis {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let json: { findings?: Finding[]; fixed_source?: unknown };
  try {
    json = JSON.parse(candidate);
  } catch {
    throw new Error('model reply is not JSON');
  }
  if (typeof json.fixed_source !== 'string' || !json.fixed_source.trim()) throw new Error('model reply has no fixed_source');
  return { findings: Array.isArray(json.findings) ? json.findings : [], fixedSource: json.fixed_source };
}

export async function diagnose(
  input: { failing: MatrixResult[]; sourcePath: string; source: string; secrets: string[] },
  model: ModelFn,
): Promise<{ diagnosis: Diagnosis; reply: ModelReply }> {
  const reply = await model(buildPrompt(input));
  return { diagnosis: parseDiagnosis(reply.text), reply };
}
