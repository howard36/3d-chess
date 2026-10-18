import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { UserConfig } from 'vite';
import { expect, test, vi } from 'vitest';
import { picturePlacement } from './src/three/landingLens';
import { parseHeaders } from './bench/preview.config';
import config, {
  KEEP_A_YEAR,
  keepHashedFiles,
  landingVersion,
  placeLandingPictureEarly,
  preloadLandingPictureOnStartPage,
  versionLandingPictures,
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
  // Run as the built page runs it, on its own: on `/` in a phone's window it
  // places the picture the page's own would show, before #root; anywhere else
  // (another page, a wider window) nothing
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
      if (path !== '/' || width > height) expect(img).toBeNull();
      else {
        const place = picturePlacement(width, height);
        expect(document.getElementById('landing-early')!.nextElementSibling?.id).toBe('root');
        expect(img!.getAttribute('src')).toBe(
          `/landing/${place.picture}.webp?v=${landingVersion()}`,
        );
        expect(img!.style.width).toBe(`${place.width}px`);
      }
    }
  } finally {
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  }
});

test('the built page’s preload asks for the very addresses its early picture shows, by their version', async () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const head = preloadLandingPictureOnStartPage().transformIndexHtml as (
    h: string,
  ) => Promise<string>;
  const body = placeLandingPictureEarly().transformIndexHtml as (h: string) => Promise<string>;
  const built = await body(await head(html));
  const scripts = [...built.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  try {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '<div id="root"></div>';
    for (const script of scripts) new Function(script)();
    const link = document.head.querySelector('link[rel="preload"][as="image"]')!;
    const source = document.querySelector('#landing-early source')!;
    expect(link.getAttribute('imagesrcset')).toBe(source.getAttribute('srcset'));
    expect(link.getAttribute('href')).toContain(`?v=${landingVersion()}`);
    link.remove();
  } finally {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  }
});

test('the pictures’ version changes with any of them, and the host keeps them a year', () => {
  const dir = mkdtempSync(join(tmpdir(), 'landing-'));
  try {
    writeFileSync(join(dir, 'phone.avif'), 'a');
    const before = landingVersion(dir);
    writeFileSync(join(dir, 'phone.avif'), 'b');
    expect(landingVersion(dir)).not.toBe(before);
    writeFileSync(join(dir, '_headers'), '');
    const plugin = versionLandingPictures();
    (plugin.configResolved as (c: unknown) => void)({ root: dir, build: { outDir: '.' } });
    (plugin.writeBundle as () => void)();
    const rules = parseHeaders(readFileSync(join(dir, '_headers'), 'utf8'));
    expect(rules.find((r) => r.path.test('/landing/phone@2x.avif'))?.headers).toEqual([
      ['Cache-Control', KEEP_A_YEAR],
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the entry asks for the pictures by the version the early scripts ask for', () => {
  // Without it the page's own picture misses the head's preload and the host's year-long rule
  const config = (versionLandingPictures().config as () => UserConfig)();
  expect(config.define?.__LANDING_VERSION__).toBe(JSON.stringify(landingVersion()));
});

test('the build runs the start page’s scripts', () => {
  const flat = (p: unknown): unknown[] => (Array.isArray(p) ? p.flatMap(flat) : [p]);
  const names = flat((config as UserConfig).plugins).map((p) => (p as { name?: string })?.name);
  expect(names).toEqual(
    expect.arrayContaining([
      'preload-landing-picture',
      'place-landing-picture-early',
      'version-landing-pictures',
      'keep-hashed-files',
    ]),
  );
});

/** Runs keepHashedFiles' build step on a build of these files, in a folder of its own. */
const keepFiles = (names: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'build-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, '_headers'), readFileSync(resolve(process.cwd(), 'public/_headers')));
  const plugin = keepHashedFiles();
  (plugin.configResolved as (c: unknown) => void)({ root: dir, build: { outDir: '.' } });
  const context = {
    error: (message: string) => {
      throw new Error(message);
    },
  };
  try {
    (plugin.writeBundle as (this: unknown, o: unknown, b: unknown) => void).call(
      context,
      {},
      Object.fromEntries(names.map((name) => [name, {}])),
    );
    return {
      rules: parseHeaders(readFileSync(join(dir, '_headers'), 'utf8')),
      notFound: existsSync(join(dir, 'assets/404.html')),
    };
  } finally {
    rmSync(dir, { recursive: true });
  }
};

test('the host keeps a year each file the build wrote under assets/, and nothing else', () => {
  const { rules, notFound } = keepFiles([
    'index.html',
    'assets/index-B2x9_kQe.js',
    'assets/manrope-latin-600-normal-4f0koTD-.woff2',
  ]);
  const cache = (path: string) =>
    rules
      .filter((r) => r.path.test(path))
      .flatMap((r) => r.headers)
      .find(([name]) => name === 'Cache-Control')?.[1];
  expect(cache('/assets/index-B2x9_kQe.js')).toBe(KEEP_A_YEAR);
  expect(cache('/assets/manrope-latin-600-normal-4f0koTD-.woff2')).toBe(KEEP_A_YEAR);
  // A name this deploy lacks (an old page's chunk) is never kept: the host
  // answers it from assets/404.html, not with the start page
  for (const path of ['/assets/index-ZZZZZZZZ.js', '/assets/404.html', '/', '/index.html'])
    expect(cache(path)).toBeUndefined();
  for (const path of ['/game/abc', '/landing/phone.avif', '/og.jpg'])
    expect(cache(path)).toBeUndefined();
  expect(notFound).toBe(true);
  // Every file keeps the host's other headers
  expect(rules.filter((r) => r.path.test('/assets/index-B2x9_kQe.js')).length).toBe(2);
});

test('the build fails on a file under assets/ with no hash in its name', () => {
  expect(() => keepFiles(['assets/logo.svg'])).toThrow(/no hash in assets\/logo.svg/);
  expect(() => keepFiles(['assets/a-B2x9_kQe.js', 'assets/b.js'])).toThrow(/assets\/b.js/);
});

test('the build fails past the host’s 100 rules', () => {
  const many = Array.from({ length: 100 }, (_, i) => `assets/c${i}-B2x9_kQe.js`);
  expect(() => keepFiles(many)).toThrow(/101 rules/);
});
