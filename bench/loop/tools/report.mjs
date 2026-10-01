// Builds a run's report page (HTML, readable on a phone) from the run's
// content file and the scoreboard:
//   node report.mjs <RUN-id.report.json> <out.html>
// The content file holds the words (each section's items, as small HTML
// strings); every chart is drawn here from scoreboard.jsonl rows, picked by
// a `rows` filter: { change, only (regex on "where · scenario"), variant }.
// Each chart says which file and which A/B report its numbers come from.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [contentFile, out] = process.argv.slice(2);
if (!contentFile || !out) {
  console.error('usage: node report.mjs <RUN-id.report.json> <out.html>');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const content = JSON.parse(readFileSync(contentFile, 'utf8'));
const board = readFileSync(join(here, '..', 'scoreboard.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const pick = (f) => {
  const only = f.only ? new RegExp(f.only) : null;
  const rows = board.filter(
    (r) =>
      (!f.run || r.run === f.run) &&
      (!f.change || r.change === f.change) &&
      (f.variant === undefined || r.variant === f.variant) &&
      (!only || only.test(`${r.where} · ${r.scenario}`)),
  );
  if (!rows.length) throw new Error(`no scoreboard rows for ${JSON.stringify(f)}`);
  return rows;
};

const fmt = (v, unit) => {
  if (unit === 'B') return v >= 1024 ? `${(v / 1024).toFixed(1)} KiB` : `${Math.round(v)} B`;
  if (unit === 'ms') {
    if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
    if (v >= 1) return `${v.toFixed(v < 10 ? 1 : 0)} ms`;
    return `${(v * 1000).toFixed(v * 1000 < 10 ? 1 : 0)} µs`;
  }
  return `${Number(v.toPrecision(3))}${unit ? ` ${unit}` : ''}`;
};

// A row per measure: its head/base ratio on a log axis from 0.5× to 2×, the
// median as a bar from 1×, each pair as a dot. Shorter (left) is faster for
// times; for throughputs (frames/s) the report says so in the row's label.
const chart = (f, caption) => {
  const rows = pick(f);
  const W = 640;
  const left = 250;
  const right = W - 16;
  const rowH = 34;
  const top = 26;
  const H = top + rows.length * rowH + 8;
  const lo = Math.log(0.5);
  const hi = Math.log(2);
  const x = (ratio) => left + ((Math.log(Math.min(Math.max(ratio, 0.5), 2)) - lo) / (hi - lo)) * (right - left);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(caption)}">`;
  for (const t of [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2]) {
    svg += `<line x1="${x(t)}" y1="${top - 6}" x2="${x(t)}" y2="${H - 4}" class="${t === 1 ? 'axis1' : 'grid'}"/>`;
    svg += `<text x="${x(t)}" y="${top - 10}" class="tick" text-anchor="middle">${t}×</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const ratio = r.headValue / r.baseValue;
    const cls = r.verdict === 'better' ? 'good' : r.verdict === 'worse' ? 'bad' : 'flat';
    const label = r.scenario.length > 44 ? `${r.scenario.slice(0, 43)}…` : r.scenario;
    svg += `<text x="0" y="${y + 13}" class="lab">${esc(label)}</text>`;
    svg += `<text x="0" y="${y + 27}" class="sub">${esc(fmt(r.baseValue, r.unit))} → ${esc(fmt(r.headValue, r.unit))}</text>`;
    const a = Math.min(x(1), x(ratio));
    const b = Math.max(x(1), x(ratio));
    svg += `<rect x="${a}" y="${y + 6}" width="${Math.max(b - a, 1.5)}" height="14" rx="2" class="bar ${cls}"/>`;
    for (const p of r.pairs ?? []) if (Number.isFinite(p)) svg += `<circle cx="${x(p)}" cy="${y + 13}" r="3" class="pair"/>`;
    const pct = `${ratio < 1 ? '−' : '+'}${Math.abs((ratio - 1) * 100).toFixed(0)}%`;
    svg += `<text x="${right}" y="${y + 29}" class="sub" text-anchor="end">${pct} ${r.verdict === 'unchanged' ? '(not called)' : r.verdict}</text>`;
  });
  svg += '</svg>';
  const sources = [...new Set(rows.map((r) => r.source))].join(', ');
  return `<figure class="chart"><div class="scroll">${svg}</div><figcaption>${esc(caption)} Head ÷ base, log axis; bar = median of interleaved pairs, dots = each pair. Data: <code>bench/loop/scoreboard.jsonl</code> from <code>${esc(sources)}</code>.</figcaption></figure>`;
};

const item = (it) => {
  let html = `<article class="item">`;
  if (it.title) html += `<h3>${it.title}</h3>`;
  if (it.body) html += `<div class="body">${it.body}</div>`;
  for (const c of it.charts ?? []) html += chart(c.rows, c.caption ?? '');
  if (it.recommend) html += `<p class="rec"><span>Recommendation</span> ${it.recommend}</p>`;
  return `${html}</article>`;
};

const SECTIONS = [
  ['needs', 'Needs from me'],
  ['scoreboard', 'Scoreboard'],
  ['changed', 'Changed'],
  ['removed', 'Removed'],
  ['rejected', 'Tried and rejected'],
  ['choices', 'Choices made alone'],
  ['notConfirmed', 'Not confirmed'],
  ['merge', 'For the merge'],
  ['next', 'Next'],
];

const css = `
/* Layout: one reading column, charts full-width inside it, scrolling sideways on their own */
:root {
  --ground: #f3f1ec; --panel: #fbfaf7; --ink: #23262d; --muted: #5d626d; --rule: #dcd8cf;
  --gold: #9a6a12; --good: #1f7a5c; --bad: #c2332a; --flat: #8b8f98; --dot: #23262d;
  --display: "Bricolage Grotesque", "Avenir Next", system-ui, sans-serif;
  --body: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --ground: #1b1d22; --panel: #23262d; --ink: #ebe8e1; --muted: #a8acb5; --rule: #3a3e47;
  --gold: #f8c970; --good: #5fc9a2; --bad: #ff6d62; --flat: #8b8f98; --dot: #ebe8e1; color-scheme: dark } }
:root[data-theme="dark"] {
  --ground: #1b1d22; --panel: #23262d; --ink: #ebe8e1; --muted: #a8acb5; --rule: #3a3e47;
  --gold: #f8c970; --good: #5fc9a2; --bad: #ff6d62; --flat: #8b8f98; --dot: #ebe8e1; color-scheme: dark }
body { background: var(--ground); color: var(--ink); font: 16px/1.55 var(--body); }
main { max-width: 46rem; margin: 0 auto; padding-inline: 16px; padding-block: 28px 64px; display: grid; gap: 28px; }
header { display: grid; gap: 6px; }
.eyebrow { font: 600 12px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--gold); }
h1 { font: 700 clamp(28px, 6vw, 40px)/1.1 var(--display); margin: 0; text-wrap: balance; }
.meta { color: var(--muted); font-size: 14px; }
.meta code, code { font-family: var(--mono); font-size: .86em; }
section { display: grid; gap: 14px; border-top: 1px solid var(--rule); padding-top: 18px; min-width: 0; }
h2 { font: 650 22px/1.2 var(--display); margin: 0; text-wrap: balance; }
h3 { font: 650 17px/1.3 var(--body); margin: 0; text-wrap: balance; }
.item { display: grid; gap: 10px; min-width: 0; }
.needs .item { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; }
.body { min-width: 0; } .body p { margin: 0 0 .6em; } .body p:last-child { margin: 0; }
.body ul { margin: 0; padding-left: 1.2em; } .body li { margin: .2em 0; }
.rec { margin: 0; } .rec span { font: 600 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--gold); margin-right: .4em; }
.chart { margin: 0; display: grid; gap: 6px; min-width: 0; }
.scroll { overflow-x: auto; }
.chart svg { width: 100%; min-width: 520px; height: auto; display: block; font-family: var(--body); }
.chart .lab { font-size: 13px; fill: var(--ink); } .chart .sub, .chart .tick { font-size: 11px; fill: var(--muted); font-variant-numeric: tabular-nums; }
.chart .grid { stroke: var(--rule); } .chart .axis1 { stroke: var(--muted); stroke-width: 1.5; }
.chart .bar.good { fill: var(--good); } .chart .bar.bad { fill: var(--bad); } .chart .bar.flat { fill: var(--flat); opacity: .55; }
.chart .pair { fill: var(--dot); }
figcaption { font-size: 13px; color: var(--muted); }
table { border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 4px 10px 4px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
a { color: var(--gold); }
:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
`;

let html = `<title>${esc(content.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=JetBrains+Mono:wght@400;600&family=Source+Sans+3:wght@400;600&display=swap">
<style>${css}</style>
<main>
<header><div class="eyebrow">${esc(content.eyebrow)}</div><h1>${esc(content.heading)}</h1><div class="meta">${content.meta}</div></header>
`;
for (const [key, title] of SECTIONS) {
  const s = content[key];
  if (!s) continue;
  html += `<section class="${key}" id="${key}"><h2>${title}</h2>`;
  if (s.intro) html += `<div class="body">${s.intro}</div>`;
  for (const it of s.items ?? []) html += item(it);
  html += '</section>\n';
}
html += '</main>\n';
writeFileSync(out, html);
console.log(`wrote ${out}`);
