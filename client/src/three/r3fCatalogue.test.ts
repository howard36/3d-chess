import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import * as catalogue from './r3fCatalogue';

// The production build hands r3f only the classes in r3fCatalogue.ts
// (vite.config.ts), and neither these unit tests nor the e2e suite (which
// runs the dev server) would notice a missing one: a scene element whose
// class is not listed would only fail in production. So every lowercase
// JSX element in the scene and the screens that names a three.js class must
// be listed (but for SVG's own elements whose names three.js shares).
const SVG = new Set(['path', 'line']);

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.tsx') && !e.name.includes('.test.')
        ? [join(dir, e.name)]
        : [],
  );

describe('the r3f catalogue', () => {
  it('lists every three.js class the scene writes as an element', () => {
    const used = new Set<string>();
    for (const file of [...sources(__dirname), ...sources(join(__dirname, '../screens'))]) {
      for (const [, tag] of readFileSync(file, 'utf8').matchAll(/<([a-z][A-Za-z0-9]*)[\s>/]/g)) {
        const name = tag[0].toUpperCase() + tag.slice(1);
        if (name in THREE && !SVG.has(tag)) used.add(name);
      }
    }
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((name) => !(name in catalogue))).toEqual([]);
    // ...and nothing more, so the list stays the scene's own
    expect(Object.keys(catalogue).filter((name) => !used.has(name))).toEqual([]);
  });
});
