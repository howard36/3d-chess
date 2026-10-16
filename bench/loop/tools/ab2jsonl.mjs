// Appends an A/B report's rows (bench/run.mjs --base ... --out <file>.md) to
// scoreboard.jsonl, one JSON object per measured row:
//   node ab2jsonl.mjs <report.md> --run <id> --change <ledger id> [--variant <text>] [--only <regex>] [--head <sha>]
// --only keeps the rows whose "where · case" matches (the rows the change is
// about, plus the primary ones); without it every row is kept. A head measured
// with uncommitted changes is written <sha>+wip (its parent's sha and more),
// unless --head names the commit the change became.
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
  console.error('usage: node ab2jsonl.mjs <report.md> --run <id> --change <id> [--variant t] [--only re] [--head sha]');
  process.exit(2);
}
const variant = opt('--variant');
const only = opt('--only') ? new RegExp(opt('--only')) : null;
const text = readFileSync(file, 'utf8');
const base = text.match(/^Base `([0-9a-f]+)`/m)?.[1] ?? null;
const measured = text.match(/against this checkout \(`([^`]+)`( with uncommitted changes)?/m);
const head = opt('--head') ?? (measured ? `${measured[1]}${measured[2] ? '+wip' : ''}` : null);

/** A value as the report prints it ("1.2 ms", "830 µs", "7.91 fps", "4.5/s") in its unit's base. */
const SCALE = { ns: 1e-6, 'µs': 1e-3, ms: 1, s: 1000, B: 1, KiB: 1024, MiB: 1024 ** 2 };
const parse = (cell) => {
  // (k, M and G only as a rate's multiplier: "4.5k/s", never the M of "MiB")
  const m = cell.match(/^([\d.,]+)\s*([kMG](?=\/s))?\s*(\S*)/);
  if (!m) return null;
  let v = Number(m[1].replace(/,/g, '')) * ({ k: 1e3, M: 1e6, G: 1e9 }[m[2]] ?? 1);
  const unit = m[3] || '';
  if (unit in SCALE) return { value: v * SCALE[unit], unit: unit.endsWith('B') ? 'B' : 'ms' };
  return { value: v, unit };
};

/** A pairs cell of differences ("+1 −2 0", "+52.5 ms −1.20 s 0 ms") as numbers, times in ms. */
const diffsOf = (cell) =>
  [...cell.matchAll(/([+\u2212-]?)([\d.]+)\s*(ns|µs|ms|s|B|KiB|MiB)?(?=\s|$)/g)].map(
    ([, sign, n, unit]) => (sign && sign !== '+' ? -1 : 1) * Number(n) * (unit ? SCALE[unit] : 1),
  );

let tier = null;
let rows = 0;
let missing = 0;
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
  // A row one side lost is kept, with that side null, and said
  if (!pb && !ph) continue;
  if (!pb || !ph) {
    console.warn(`missing on ${pb ? 'head' : 'base'}: ${where} · ${scenario}`);
    missing++;
  }
  const row = {
    run,
    change,
    variant,
    base,
    head,
    tier,
    where,
    scenario,
    unit: (pb ?? ph).unit,
    baseValue: pb?.value ?? null,
    headValue: ph?.value ?? null,
    // Ratios are printed to two decimals; a value judged by its pairs'
    // differences (a side at 0) prints them signed, a count's as whole
    // numbers and a time's with its unit ("+52.5 ms"), kept apart (in ms)
    ...(pairs && !pairs.split(/\s+/).every((t) => /^\d+\.\d+$/.test(t))
      ? { pairs: [], pairDiffs: diffsOf(pairs) }
      : { pairs: pairs ? pairs.split(/\s+/).map(Number) : [] }),
    verdict: verdict.replace(/\*/g, '') || 'unchanged',
    source: basename(file),
  };
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  rows++;
}
console.log(`${rows} rows appended to ${out}${missing ? ` (${missing} with one side missing)` : ''}`);
