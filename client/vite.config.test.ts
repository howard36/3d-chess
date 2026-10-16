import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import {
  parseHeaders,
  placeLandingPictureEarly,
  preloadLandingPictureOnStartPage,
} from './vite.config';

test('the built page preloads its picture after the viewport tag, where a phone knows its width', async () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const transform = preloadLandingPictureOnStartPage().transformIndexHtml as (
    html: string,
  ) => Promise<string>;
  const built = await transform(html);
  // Before the tag a phone's innerWidth is the default 980 px: the script
  // would pick the tablet's picture, and the phone's would come late
  const viewport = built.indexOf('<meta name="viewport"');
  expect(viewport).toBeGreaterThan(-1);
  expect(built.indexOf('innerWidth')).toBeGreaterThan(viewport);
});

test('the built page places the start page’s picture right after #root, self-contained', async () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const transform = placeLandingPictureEarly().transformIndexHtml as (
    html: string,
  ) => Promise<string>;
  const built = await transform(html);
  const script = built.match(/<div id="root"><\/div>\s*<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(script).not.toMatch(/\bimport\b/);
  expect(script).toContain('landing-early');
});

test('vite preview sends the host’s headers (public/_headers), read as Pages reads them', () => {
  const rules = parseHeaders(readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8'));
  const names = (path: string) =>
    rules.filter((r) => r.path.test(path)).flatMap((r) => r.headers.map(([name]) => name));
  for (const path of ['/', '/game/abc', '/assets/index-B2x9_kQe.js'])
    expect(names(path)).toEqual(
      expect.arrayContaining([
        'X-Frame-Options',
        'Content-Security-Policy',
        'X-Content-Type-Options',
      ]),
    );
  // A path's dots are dots, its star anything
  const [rule] = parseHeaders('/a.b/*\n  X-Test: 1\n');
  expect([rule.path.test('/a.b/c/d'), rule.path.test('/axb/c')]).toEqual([true, false]);
  expect(rule.headers).toEqual([['X-Test', '1']]);
});
