// One-screen report. Self-contained: inline CSS and JS, no network. Data is
// embedded as JSON with "<" escaped, and rendered with textContent only.

import type { ReportData } from './data.ts';

const CSS = `
:root {
  --bg: #f6f5f1; --panel: #ffffff; --ink: #17181b; --muted: #61646c; --line: #e3e1da;
  --pass: #127a4b; --pass-bg: #e3f4ea; --fail: #b4232a; --fail-bg: #fbe7e6; --unk: #8a5a00; --unk-bg: #fbf0d9;
  --accent: #003087; --accent-bg: #e6edf8; --code-bg: #f1f0ec; --add: #e3f4ea; --del: #fbe7e6;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #111214; --panel: #191a1d; --ink: #ecebe6; --muted: #9b9da4; --line: #2b2c31;
    --pass: #5fd394; --pass-bg: #163325; --fail: #ff8a84; --fail-bg: #3a1a1a; --unk: #f2c463; --unk-bg: #3a2e12;
    --accent: #8fb3ff; --accent-bg: #1b2540; --code-bg: #141518; --add: #15301f; --del: #361818;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 var(--sans); }
header { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; padding: 18px 24px 14px; border-bottom: 1px solid var(--line); }
header h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
header .q { color: var(--muted); font-size: 15px; }
header .meta { margin-left: auto; color: var(--muted); font-size: 12px; font-family: var(--mono); }
main { display: grid; grid-template-columns: 360px minmax(0, 1fr) minmax(320px, 400px); gap: 16px; padding: 16px 24px 8px; align-items: start; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.panel h2 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; color: var(--muted); font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--line); }
td { padding: 4px 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
tr.run { cursor: pointer; }
tr.run:hover td { background: var(--accent-bg); }
tr.run.sel td { background: var(--accent-bg); box-shadow: inset 0 0 0 0 transparent; }
tr.run.sel td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
td.name { font-size: 13px; white-space: nowrap; }
td.name small { display: inline; white-space: nowrap; margin-left: 6px; color: var(--muted); font-family: var(--mono); font-size: 11px; }
.pill { display: inline-block; min-width: 52px; text-align: center; font: 600 11px/1 var(--mono); padding: 4px 7px; border-radius: 999px; }
.PASS { color: var(--pass); background: var(--pass-bg); }
.FAIL { color: var(--fail); background: var(--fail-bg); }
.UNKNOWN { color: var(--unk); background: var(--unk-bg); }
.summary { display: flex; gap: 10px; margin-top: 12px; font-size: 12px; color: var(--muted); }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.side h3 { margin: 0 0 8px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
.verdicts { list-style: none; margin: 0 0 12px; padding: 0; }
.verdicts li { display: grid; grid-template-columns: 26px 70px 1fr; gap: 6px; align-items: start; padding: 3px 0; font-size: 12.5px; }
.verdicts b { font-family: var(--mono); }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.fact { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.fact .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.fact .v { font-family: var(--mono); font-size: 12px; margin-top: 4px; white-space: pre-wrap; word-break: break-word; }
.log { font: 11.5px/1.5 var(--mono); background: var(--code-bg); border-radius: 8px; padding: 8px 10px; margin: 0; white-space: pre-wrap; max-height: 170px; overflow: auto; }
.proof { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.proof .badge { font: 700 15px/1 var(--mono); padding: 8px 12px; border-radius: 8px; }
.checks { list-style: none; padding: 0; margin: 0 0 14px; font-size: 12.5px; }
.checks li { padding: 3px 0 3px 22px; position: relative; }
.checks li::before { content: attr(data-mark); position: absolute; left: 0; font-family: var(--mono); font-weight: 700; }
.checks li.ok::before { color: var(--pass); }
.checks li.no::before { color: var(--fail); }
.finding { border-left: 3px solid var(--accent); padding: 2px 0 2px 10px; margin: 0 0 7px; font-size: 12px; }
.finding .where { font-family: var(--mono); font-size: 11.5px; color: var(--muted); }
.diff { font: 11px/1.45 var(--mono); background: var(--code-bg); border-radius: 8px; padding: 8px 0; margin: 0; max-height: 260px; overflow: auto; }
.diff span { display: block; padding: 0 10px; white-space: pre; }
.diff .a { background: var(--add); }
.diff .d { background: var(--del); }
.diff .h { color: var(--muted); }
button { font: 600 12px var(--sans); color: var(--accent); background: var(--accent-bg); border: 1px solid transparent; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
button:focus-visible, tr.run:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.muted { color: var(--muted); }
footer { padding: 6px 24px 18px; color: var(--muted); font-size: 12px; }
.ext { padding: 0 24px 8px; }
.ext .panel { display: grid; grid-template-columns: 360px minmax(0, 1fr) minmax(320px, 400px); gap: 16px; }
.ext .panel > h2 { grid-column: 1 / -1; margin-bottom: 0; }
.ext .lede { margin: 0 0 10px; font-size: 13px; }
.ext td { font-size: 12.5px; }
.ext td.num { font-family: var(--mono); text-align: right; }
a { color: var(--accent); }
footer a { color: inherit; }
@media (max-width: 1180px) { main, .ext .panel { grid-template-columns: 1fr; } }
@media (max-width: 640px) { header, main, .ext, footer { padding-left: 16px; padding-right: 16px; } .cols, .facts { grid-template-columns: 1fr; } }
`;

const JS = `
const data = JSON.parse(document.getElementById('data').textContent);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};
const pill = (w) => h('span', { class: 'pill ' + w }, w);
let selected = data.rows.findIndex((r) => r.before.worst === 'FAIL');
if (selected < 0) selected = 0;

function scenarioTable() {
  const body = h('tbody');
  data.rows.forEach((r, i) => {
    const short = { A1: 'race', A2: 'retry after lost response', A3: 'duplicate webhook' }[r.scenario];
    const sub = r.scenario === 'A1' ? r.params.order + ' · N=' + r.params.n : '';
    const tr = h('tr', { class: 'run' + (i === selected ? ' sel' : ''), tabindex: '0', onclick: () => select(i), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); } } },
      h('td', { class: 'name' }, h('b', {}, r.scenario), ' ' + short, sub ? h('small', {}, sub) : null),
      h('td', {}, pill(r.before.worst)),
      h('td', {}, r.after ? pill(r.after.worst) : h('span', { class: 'muted' }, 'n/a')));
    body.append(tr);
  });
  const fails = data.rows.filter((r) => r.before.worst === 'FAIL').length;
  const fixed = data.rows.filter((r) => r.after && r.after.worst === 'PASS').length;
  return [h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Scenario'), h('th', {}, 'Before'), h('th', {}, 'After'))), body),
    h('div', { class: 'summary' }, h('span', {}, fails + ' of ' + data.rows.length + ' runs fail before'), h('span', {}, fixed + ' of ' + data.rows.length + ' pass after'))];
}

function factsOf(side) {
  if (!side || !side.paypal) return h('p', { class: 'muted' }, 'No run.');
  const pp = side.paypal.orders.map((o) => o.id + '  ' + o.status + '\\n' + (o.captures.length ? o.captures.map((c) => '  capture ' + c.id + ' ' + c.status).join('\\n') : '  no capture')).join('\\n') || 'no order';
  const shopOrders = side.shop.orders.map((o) => '#' + o.id + ' ' + o.status).join('\\n') || 'none';
  const grants = side.shop.grants.length + ' licence' + (side.shop.grants.length === 1 ? '' : 's') + (side.shop.grants.length ? '\\n' + side.shop.grants.map((g) => 'for ' + g.capture_id).join('\\n') : '');
  return h('div', { class: 'facts' },
    h('div', { class: 'fact' }, h('div', { class: 'k' }, 'PayPal says'), h('div', { class: 'v' }, pp)),
    h('div', { class: 'fact' }, h('div', { class: 'k' }, 'Shop recorded'), h('div', { class: 'v' }, 'orders\\n' + shopOrders + '\\n\\n' + grants)));
}

function side(title, s) {
  return h('div', { class: 'side' },
    h('h3', {}, title, s ? pill(s.worst) : null),
    s ? h('ul', { class: 'verdicts' }, s.verdicts.map((v) => h('li', {}, h('b', {}, v.id), pill(v.result), h('span', {}, v.detail)))) : null,
    factsOf(s),
    s && s.log ? h('pre', { class: 'log' }, s.log.join('\\n')) : null);
}

function detail() {
  const r = data.rows[selected];
  const sub = r.scenario === 'A1' ? ' (' + r.params.order + ', N=' + r.params.n + ')' : '';
  return [h('h2', {}, r.scenario + ' ' + r.label + sub), h('div', { class: 'cols' }, side('Buggy shop', r.before), side('Patched shop', r.after))];
}

function aiPanel() {
  const p = data.proof;
  const checks = [
    [p.before.fail > 0, 'Buggy shop fails ' + p.before.fail + ' of ' + p.before.runs + ' runs'],
    [p.after.fail === 0, 'Patched shop: ' + p.after.fail + ' FAIL in ' + p.after.runs + ' runs (seeds ' + p.seeds.join(', ') + ')'],
    [p.after.unknown === 0, p.after.unknown + ' UNKNOWN verdicts'],
    [p.forgedRejected, p.forgedRejected ? 'Forged webhooks still rejected' : 'Forged webhooks accepted'],
  ];
  const lines = data.diff.split('\\n').map((l) => h('span', { class: l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'd' : l.startsWith('@@') ? 'h' : '' }, l || ' '));
  const download = () => {
    const a = h('a', { href: URL.createObjectURL(new Blob([data.regressionTest], { type: 'text/plain' })), download: 'payment-truth.regression.test.ts' });
    document.body.append(a); a.click(); a.remove();
  };
  const cost = data.diagnosis.costUsd != null ? ', $' + Number(data.diagnosis.costUsd).toFixed(3) : '';
  return [
    h('h2', {}, 'AI diagnosis, checked by the harness'),
    h('div', { class: 'proof' }, h('span', { class: 'badge ' + (p.proven ? 'PASS' : 'FAIL') }, p.proven ? 'PROVEN' : 'NOT PROVEN'), h('span', { class: 'muted' }, 'The AI proposes. The invariants decide.')),
    h('p', {}, h('button', { onclick: download }, 'Download regression test')),
    h('ul', { class: 'checks' }, checks.map(([ok, text]) => h('li', { class: ok ? 'ok' : 'no', 'data-mark': ok ? '\\u2713' : '\\u2715' }, text))),
    p.reasons.length ? h('p', { class: 'muted' }, p.reasons.join('; ')) : null,
    data.diagnosis.findings.map((f) => h('div', { class: 'finding' }, h('div', { class: 'where' }, f.invariant + '  src/shop/buggy.ts:' + f.line), h('div', {}, f.cause))),
    h('p', { class: 'muted' }, 'Model ' + data.diagnosis.model + cost),
    h('pre', { class: 'diff', 'aria-label': 'Patch diff' }, lines),
  ];
}

function evershopPanel() {
  const e = data.evershop;
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  const rows = e.before.variants.map((v) => {
    const a1 = v.key.startsWith('A1 ');
    const name = a1 ? 'race' : v.key === 'A2' ? 'retry after lost response' : 'duplicate webhook';
    const label = h('td', { class: 'name' }, h('b', {}, v.key.slice(0, 2)), ' ' + name, a1 ? h('small', {}, v.key.slice(3).replace(' N=', ' · N=')) : null);
    return h('tr', {}, label, h('td', {}, pill(v.fail ? 'FAIL' : 'PASS')), h('td', { class: 'num' }, v.orderPlaced.join(', ')));
  });
  const f = e.diagnosis.findings[0];
  const cost = e.diagnosis.costUsd != null ? ', $' + Number(e.diagnosis.costUsd).toFixed(3) : '';
  const diff = e.diff.split('\\n').map((l) => h('span', { class: l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'd' : l.startsWith('@@') ? 'h' : '' }, l || ' '));
  return [
    h('h2', {}, 'Real open-source code: evershop, recorded ' + e.recordedAt.slice(0, 10)),
    h('div', {},
      h('p', { class: 'lede' }, "evershop's own PayPal handlers at ", h('code', {}, e.commit.slice(0, 7)), ' against Postgres 15 and the fake PayPal; only logging, config, plugin hooks and the HTTP client are stubbed. Seeds 1 to 3.'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Scenario'), h('th', {}, 'Before'), h('th', {}, 'order_placed events'))), h('tbody', {}, rows)),
      h('div', { class: 'summary' }, h('span', {}, e.before.fail + ' of ' + e.before.runs + ' runs fail before'), h('span', {}, (e.after.runs - e.after.fail - e.after.unknown) + ' of ' + e.after.runs + ' pass after'))),
    h('div', {},
      h('div', { class: 'proof' }, h('span', { class: 'badge ' + (e.proven ? 'PASS' : 'FAIL') }, e.proven ? 'PROVEN' : 'NOT PROVEN'), h('span', { class: 'muted' }, 'One payment, one capture, but one confirmation email per concurrent caller. No double charge.')),
      f ? h('div', { class: 'finding' }, h('div', { class: 'where' }, f.invariant + '  ', link(e.fileUrl, e.file + ':' + f.line)), h('div', {}, f.cause)) : null,
      h('p', { class: 'muted' }, 'Model ' + e.diagnosis.model + cost),
      h('p', {}, 'Reported upstream: ', link(e.issueUrl, 'evershop issue #' + e.issueUrl.split('/').pop()))),
    h('pre', { class: 'diff', 'aria-label': 'evershop patch diff' }, diff),
  ];
}

function select(i) { selected = i; render(); document.querySelectorAll('tr.run')[i]?.focus(); }
function render() {
  const nodes = (list) => list.flat(2).filter((n) => n != null);
  document.getElementById('scenarios').replaceChildren(h('h2', {}, 'Agent traffic scenarios'), ...nodes(scenarioTable()));
  document.getElementById('detail').replaceChildren(...nodes(detail()));
  document.getElementById('ai').replaceChildren(...nodes(aiPanel()));
  if (data.evershop) document.getElementById('evershop').replaceChildren(...nodes(evershopPanel()));
}
render();
`;

export function renderReport(data: ReportData): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const recorded = data.recordedAt.slice(0, 10);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payment Truth report</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>Payment Truth</h1>
  <span class="q">Is your PayPal backend ready for AI buyer agents?</span>
  <span class="meta">Recorded ${recorded} · ${data.mode} · seed ${data.seed}</span>
</header>
<main>
  <section class="panel" id="scenarios" aria-label="Scenarios"></section>
  <section class="panel" id="detail" aria-label="Selected run"></section>
  <section class="panel" id="ai" aria-label="AI diagnosis"></section>
</main>
${data.evershop ? '<div class="ext"><section class="panel" id="evershop" aria-label="evershop result"></section></div>' : ''}
<footer>Agent behaviour in these scenarios is our model of how a buying agent acts, not a measurement of a specific agent. Verdicts come from deterministic invariants; missing data is UNKNOWN, never PASS. Source: <a href="https://github.com/dovzhikova/payment-truth">github.com/dovzhikova/payment-truth</a> (MIT).</footer>
<script type="application/json" id="data">${json}</script>
<script>${JS}</script>
</body>
</html>
`;
}
