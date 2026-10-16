import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

// (vitest runs from client/)
const SRC = join(process.cwd(), 'src');
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : /\.(css|tsx?)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

// A var() with no fallback whose property nothing sets leaves its
// declaration invalid at computed-value time: the property quietly falls
// back to inherit or initial (a colour that was never applied)
test('every custom property the stylesheets read without a fallback is set somewhere', () => {
  const files = sources(SRC);
  const sheets = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8'));
  const code = files.filter((f) => !f.endsWith('.css')).map((f) => readFileSync(f, 'utf8'));
  const defined = new Set(
    sheets.flatMap((s) => [...s.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])),
  );
  const read = new Set(
    sheets.flatMap((s) => [...s.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1])),
  );
  expect(sheets.length).toBeGreaterThan(1);
  expect(read.size).toBeGreaterThan(20);
  // Set from script: its name in the code, as a style key or a setProperty's
  const unset = [...read].filter(
    (name) => !defined.has(name) && !code.some((c) => new RegExp(`['\`]${name}(?![\\w-])`).test(c)),
  );
  expect(unset).toEqual([]);
});
