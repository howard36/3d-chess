// How often the A/B's rule (bench/verdict.mjs) calls a row by chance, read off
// the committed reports: every row of their "Everything measured" tables is
// taken as the noise of a real comparison, and its pairs' signs are flipped at
// random (under the null a pair is as likely to go either way). A row is then
// called only when every pair lands on one side (2^(1-n) of the flips) and its
// ratios' sizes clear the rule, so its chance of a false call is exact given
// its sizes. Prints, per number of pairs, the rows, the false calls expected
// among them, and the calls the rule makes on the data as it is.
//
//   node bench/loop/tools/calling-rule-null.mjs [--min-pairs 10] [--aa]
//
// --aa reads only the A/A reports (identical code), whose calls are all chance.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chanceOfCall, verdict } from '../../verdict.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.indexOf(name);
const minPairs = arg('--min-pairs') > 0 ? Number(process.argv[arg('--min-pairs') + 1]) : 2;
const aaOnly = arg('--aa') > 0;

const calls = (ratios) =>
  verdict(
    ratios.map((r) => [100, 100 * r]),
    'lower',
    'ms',
  )?.real ?? false;

const byPairs = new Map();
for (const file of readdirSync(dir).filter((f) => /^ab-.*\.md$/.test(f))) {
  if (aaOnly && !/-aa/.test(file)) continue;
  const text = readFileSync(join(dir, file), 'utf8');
  const at = text.indexOf('## Everything measured');
  if (at < 0) continue;
  for (const line of text.slice(at).split('\n')) {
    const cell = line
      .split('|')
      .map((c) => c.trim())
      .find((c) => /^\d+\.\d\d( \d+\.\d\d)+$/.test(c));
    if (!cell) continue;
    const ratios = cell.split(' ').map(Number);
    if (ratios.length < minPairs || ratios.some((r) => !(r > 0))) continue;
    const n = ratios.length;
    const s = byPairs.get(n) ?? { rows: 0, expected: 0, called: 0 };
    s.rows++;
    s.expected += chanceOfCall(ratios);
    if (calls(ratios)) s.called++;
    byPairs.set(n, s);
  }
}
let rows = 0;
let expected = 0;
let called = 0;
console.log('pairs  rows  false calls expected  called on the data');
for (const [n, s] of [...byPairs].sort((a, b) => a[0] - b[0])) {
  console.log(
    `${String(n).padStart(5)} ${String(s.rows).padStart(5)} ${s.expected.toFixed(4).padStart(21)} ${String(s.called).padStart(19)}`,
  );
  rows += s.rows;
  expected += s.expected;
  called += s.called;
}
console.log(
  `  all ${String(rows).padStart(5)} ${expected.toFixed(4).padStart(21)} ${String(called).padStart(19)}` +
    `  (${((expected / rows) * 100).toFixed(4)}% of rows by chance)`,
);
