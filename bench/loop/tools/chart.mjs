// Renders a scoreboard chart (SVG): one row per primary benchmark, a bar per
// label (median), whiskers min–max over runs. Values are normalised to the
// first label's median so rows of different scale share one axis.
//   node chart.mjs out.svg base=<dir> head=<dir>
import { writeFileSync } from 'node:fs';
import { load, PRIMARY } from './primary.mjs';

const [out, ...sets] = process.argv.slice(2);
const loaded = sets.map((a) => a.split('=')).map(([l, d]) => [l, load(d)]);
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const find = (byKey, key) => {
  if (byKey.has(key)) return byKey.get(key);
  for (const [k, v] of byKey) if (k.includes(key)) return v;
  return null;
};
const fmt = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(v < 10 ? 2 : 0)} ms`);
const rows = PRIMARY.map(([, key]) => {
  const vals = loaded.map(([l, b]) => [l, find(b, key)]);
  return { key, vals };
}).filter((r) => r.vals[0][1]);
const colors = ['#8a8f98', '#2f7de1', '#16a34a', '#d97706'];
const W = 900;
const rowH = 26 * loaded.length + 18;
const H = 60 + rows.length * rowH;
const x0 = 330;
const xw = 480;
const maxR = 1.6;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">`;
svg += `<rect width="100%" height="100%" fill="#fff"/>`;
svg += `<text x="12" y="20" font-size="14" font-weight="600">Primary benchmarks, relative to ${loaded[0][0]} (median of runs; whiskers min–max; shorter is faster)</text>`;
for (let t = 0; t <= maxR + 1e-9; t += 0.2) {
  const x = x0 + (t / maxR) * xw;
  svg += `<line x1="${x}" y1="32" x2="${x}" y2="${H - 8}" stroke="${Math.abs(t - 1) < 1e-9 ? '#444' : '#e5e5e5'}"/>`;
  svg += `<text x="${x}" y="44" text-anchor="middle" fill="#666">${t.toFixed(1)}×</text>`;
}
loaded.forEach(([l], i) => {
  svg += `<rect x="${x0 + 250 + i * 110}" y="8" width="10" height="10" fill="${colors[i]}"/><text x="${x0 + 264 + i * 110}" y="17">${l}</text>`;
});
rows.forEach((r, i) => {
  const y = 56 + i * rowH;
  const ref = med(r.vals[0][1]);
  svg += `<text x="12" y="${y + 12}">${r.key.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
  r.vals.forEach(([l, v], j) => {
    if (!v) return;
    const m = med(v) / ref;
    const lo = Math.min(...v) / ref;
    const hi = Math.max(...v) / ref;
    const yy = y + j * 24;
    const px = (q) => x0 + (Math.min(q, maxR) / maxR) * xw;
    svg += `<rect x="${x0}" y="${yy}" width="${px(m) - x0}" height="16" fill="${colors[j]}" opacity="0.85"/>`;
    svg += `<line x1="${px(lo)}" y1="${yy + 8}" x2="${px(hi)}" y2="${yy + 8}" stroke="#111"/>`;
    svg += `<text x="${px(Math.max(hi, m)) + 6}" y="${yy + 12}" fill="#333">${fmt(med(v))}</text>`;
  });
});
svg += '</svg>';
writeFileSync(out, svg);
