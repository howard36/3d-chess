// The headline measurements (bench/primary.mjs) name their rows by the exact
// text the benches write: a label renamed in a bench and not there would
// leave the headline row "not measured". Each name must still be in its bench.
import { readFileSync } from 'node:fs';
import { PRIMARY } from '../../bench/primary.mjs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const browser = source('../scripts/bench-browser.mjs');

describe('each headline measurement names a row its bench writes', () => {
  it.each(PRIMARY.filter((r) => r.tier === 'browser').map((r) => [r.moment, r]))('%s', (_, row) => {
    expect(browser).toContain(`title: '${row.where}'`);
    // A row's name is its case and its label joined by " · ", either of which
    // may be built from a template: the longest part is written out
    const parts = row.what.split(' · ');
    const longest = parts.reduce((a, b) => (b.length > a.length ? b : a));
    expect(browser).toContain(longest);
  });

  it.each(PRIMARY.filter((r) => r.tier === 'client').map((r) => [r.moment, r]))('%s', (_, row) => {
    const bench = source(`./${row.file}.bench.ts`);
    expect(bench).toContain(row.where.split(' · ')[1] ?? row.where);
    expect(bench).toContain(row.what);
  });
});
