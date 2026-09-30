// Prints the primary rows of browser.run*.json files (one dir per label):
//   node primary.mjs base=<dir> head=<dir> ...
// Each row: median over the runs, and the spread (min-max) as % of the median.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const PRIMARY = [
  ['Cold load', 'desktop · create button enabled'],
  ['Cold load', 'phone, 4× CPU, Fast 4G · create button enabled'],
  ['Game setup', 'join: navigation → Join button'],
  ['Reopening', 'navigation → record shown (announcer = H) · H = 2000'],
  ['Game setup', 'join: click → joiner’s first frame'],
  ['Game setup', 'joiner’s first render() call'],
  ['Move latency', 'Enter → mover’s first frame with the move'],
  ['Move latency', 'Enter → opponent’s first frame with the move'],
  ['Selecting', 'click → first frame with the piece held'],
];
const EXTRA = (process.env.EXTRA ?? '').split('|').filter(Boolean).map((k) => ['', k]);

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export function load(dir) {
  const files = readdirSync(dir).filter((f) => /^browser\.run\d+\.json$/.test(f));
  const runs = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const byKey = new Map();
  for (const r of runs)
    for (const s of r.sections)
      for (const m of s.metrics ?? []) {
        if (m?.value == null) continue;
        const k = m.key;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(m.value);
      }
  return byKey;
}
const find = (byKey, key) => {
  if (byKey.has(key)) return byKey.get(key);
  for (const [k, v] of byKey) if (k.includes(key)) return v;
  return null;
};
const fmt = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(v < 10 ? 2 : 0)} ms`);
if (process.argv[1].endsWith('primary.mjs')) {
  const sets = process.argv.slice(2).map((a) => a.split('='));
  const loaded = sets.map(([l, d]) => [l, load(d)]);
  const head = ['Row', ...loaded.flatMap(([l]) => [`${l} median`, `${l} spread`, `${l} n`])];
  if (loaded.length === 2) head.push('ratio (first/second)');
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => ' --: ').join('|')}|`);
  const logs = [];
  for (const [, key] of [...PRIMARY, ...EXTRA]) {
    const cells = [key];
    const meds = [];
    for (const [, byKey] of loaded) {
      const v = find(byKey, key);
      if (!v) {
        cells.push('—', '—', '0');
        meds.push(null);
        continue;
      }
      const m = med(v);
      meds.push(m);
      cells.push(fmt(m), `${(((Math.max(...v) - Math.min(...v)) / m) * 100).toFixed(0)}%`, String(v.length));
    }
    if (loaded.length === 2 && meds[0] && meds[1]) {
      cells.push(`${(meds[0] / meds[1]).toFixed(2)}×`);
      logs.push(Math.log(meds[0] / meds[1]));
    }
    console.log(`| ${cells.join(' | ')} |`);
  }
  if (logs.length) console.log(`\ngeomean speedup: ${Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length).toFixed(3)}×`);
}
