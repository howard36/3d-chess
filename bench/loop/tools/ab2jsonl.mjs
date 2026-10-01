// Appends an A/B report's rows (bench/run.mjs --base ... --out <file>.md) to
// scoreboard.jsonl, one JSON object per measured row:
//   node ab2jsonl.mjs <report.md> --run <id> --change <ledger id> [--variant <text>] [--only <regex>]
// --only keeps the rows whose "where · case" matches (the rows the change is
// about, plus the primary ones); without it every row is kept.
import { appendFileSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const file = args[0];
const run = opt('--run');
const change = opt('--change');
if (!file || !run || !change) {
  console.error('usage: node ab2jsonl.mjs <report.md> --run <id> --change <id> [--variant t] [--only re]');
  process.exit(2);
}
const variant = opt('--variant');
const only = opt('--only') ? new RegExp(opt('--only')) : null;
const text = readFileSync(file, 'utf8');
const base = text.match(/^Base `([0-9a-f]+)`/m)?.[1] ?? null;
const head = text.match(/against this checkout \(`([^`]+)`/m)?.[1] ?? null;

/** A value as the report prints it ("1.2 ms", "830 µs", "4.1 frames/s") in its unit's base. */
const SCALE = { ns: 1e-6, 'µs': 1e-3, ms: 1, s: 1000, B: 1, KiB: 1024, MiB: 1024 ** 2 };
const parse = (cell) => {
  const m = cell.match(/^([\d.,]+)\s*([kMG]?)\s*(\S*)/);
  if (!m) return null;
  let v = Number(m[1].replace(/,/g, '')) * ({ k: 1e3, M: 1e6, G: 1e9 }[m[2]] ?? 1);
  const unit = m[3] || '';
  if (unit in SCALE) return { value: v * SCALE[unit], unit: unit.endsWith('B') ? 'B' : 'ms' };
  return { value: v, unit };
};

let tier = null;
let rows = 0;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'scoreboard.jsonl');
for (const line of text.split('\n')) {
  const h = line.match(/^### (\w+)/);
  if (h) tier = h[1];
  if (!tier || !line.startsWith('| ') || line.startsWith('| Where') || line.startsWith('| :'))
    continue;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length !== 7) continue;
  const [where, scenario, b, hd, , pairs, verdict] = cells;
  if (only && !only.test(`${where} · ${scenario}`)) continue;
  const pb = parse(b);
  const ph = parse(hd);
  if (!pb || !ph) continue;
  const row = {
    run,
    change,
    variant,
    base,
    head,
    tier,
    where,
    scenario,
    unit: pb.unit,
    baseValue: pb.value,
    headValue: ph.value,
    pairs: pairs.split(/\s+/).map(Number),
    verdict: verdict.replace(/\*/g, '') || 'unchanged',
    source: basename(file),
  };
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  rows++;
}
console.log(`${rows} rows appended to ${out}`);
