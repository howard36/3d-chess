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

// A browser inside the build's target without the cap unit, round() or mod()
// (Safari before 17.2, Chrome before 125) drops a declaration that reads one
// at parse time, or, behind a var(), finds it invalid where it is used and
// falls back to the property's initial value: a pill or a button shrunk to
// its words. So they stand only inside an @supports that tests them
// (index.css: --caps, --caps-odd, --caps-lift)
test('cap, round() and mod() are read only where @supports says the browser has them', () => {
  const outside = (css: string): string => {
    let s = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (let at = s.indexOf('@supports'); at >= 0; at = s.indexOf('@supports')) {
      const open = s.indexOf('{', at);
      const condition = s.slice(at, open);
      expect(condition).toMatch(/round\(1cap, 1px\)/);
      expect(condition).toMatch(/mod\(/);
      let depth = 0;
      let end = open;
      for (; end < s.length; end++) {
        if (s[end] === '{') depth++;
        else if (s[end] === '}' && --depth === 0) break;
      }
      s = s.slice(0, at) + s.slice(end + 1);
    }
    return s;
  };
  const sheets = sources(SRC).filter((f) => f.endsWith('.css'));
  const all = sheets.map((f) => readFileSync(f, 'utf8')).join('\n');
  expect(all).toMatch(/var\(--caps-odd\)/);
  const found = sheets.flatMap((f) =>
    [...outside(readFileSync(f, 'utf8')).matchAll(/\b(?:mod|round)\(|\d(?:\.\d+)?cap\b/g)].map(
      (m) => `${f}: ${m[0]}`,
    ),
  );
  expect(found).toEqual([]);
});

// A control focused by the page itself, for a player on a pointer, carries
// data-quiet-focus and shows no ring (lib/focus.ts); the browser's outline
// is taken off for it globally, but a ring a rule draws (an outline set
// after that rule, a box-shadow, a descendant's) shows unless the rule
// itself leaves the quiet focus out (CLAUDE.md "Gotchas")
test('every focus ring a stylesheet draws leaves out the quiet focus', () => {
  const parts = (selector: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < selector.length; i++) {
      if (selector[i] === '(') depth++;
      else if (selector[i] === ')') depth--;
      else if (selector[i] === ',' && depth === 0) {
        out.push(selector.slice(start, i));
        start = i + 1;
      }
    }
    return [...out, selector.slice(start)].map((s) => s.trim());
  };
  const rings: string[] = [];
  const unquiet: string[] = [];
  for (const file of sources(SRC).filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const ring = /(^|;)\s*(outline|box-shadow)\s*:(?!\s*none\s*(;|$))/.test(body);
      if (!ring) continue;
      for (const part of parts(selector)) {
        if (!part.includes(':focus-visible')) continue;
        rings.push(part);
        if (
          part.split(':focus-visible').length - 1 !==
          part.split(':focus-visible:not([data-quiet-focus])').length - 1
        )
          unquiet.push(`${file.slice(SRC.length + 1)}: ${part}`);
      }
    }
  }
  expect(rings.length).toBeGreaterThan(5);
  expect(unquiet).toEqual([]);
});
