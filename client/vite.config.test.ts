import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UserConfig } from 'vite';
import { expect, test, vi } from 'vitest';
import { picturePlacement } from './src/three/landingLens';
import config, {
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
  // Every start page carries it: a few KB at most (2,380 bytes when written)
  expect(script!.length).toBeLessThan(3200);
  // Run as the built page runs it, on its own: on `/` it places the picture
  // the page's own would show, before #root; anywhere else nothing
  try {
    for (const [path, width, height] of [
      ['/', 390, 844],
      ['/', 1440, 900],
      ['/new', 390, 844],
    ] as const) {
      vi.stubGlobal('innerWidth', width);
      vi.stubGlobal('innerHeight', height);
      window.history.replaceState(null, '', path);
      document.body.innerHTML = '<div id="root"></div>';
      new Function(script!)();
      const img = document.querySelector<HTMLImageElement>('#landing-early img');
      if (path !== '/') expect(img).toBeNull();
      else {
        const place = picturePlacement(width, height);
        expect(document.getElementById('landing-early')!.nextElementSibling?.id).toBe('root');
        expect(img!.getAttribute('src')).toBe(`/landing/${place.layout}.webp`);
        expect(img!.style.width).toBe(`${place.width}px`);
      }
    }
  } finally {
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  }
});

test('the build runs the start page’s scripts', () => {
  const flat = (p: unknown): unknown[] => (Array.isArray(p) ? p.flatMap(flat) : [p]);
  const names = flat((config as UserConfig).plugins).map((p) => (p as { name?: string })?.name);
  expect(names).toEqual(
    expect.arrayContaining(['preload-landing-picture', 'place-landing-picture-early']),
  );
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
