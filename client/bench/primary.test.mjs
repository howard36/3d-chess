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
    // A row's name is its parts joined by " · ", each written out in the
    // bench but a count of plies, built from a template; a cold load's
    // first part is the name of one of its cases
    const parts = row.what.split(' · ');
    for (const part of parts)
      if (/^\d+ plies$/.test(part)) expect(browser).toContain('} plies`');
      else expect(browser).toContain(part);
    if (row.section === 'cold-load') expect(browser).toContain(`label: '${parts[0]}'`);
  });

  it.each(PRIMARY.filter((r) => r.tier === 'client').map((r) => [r.moment, r]))('%s', (_, row) => {
    const bench = source(`./${row.file}.bench.ts`);
    expect(bench).toContain(row.where.split(' · ')[1] ?? row.where);
    expect(bench).toContain(row.what);
  });
});
