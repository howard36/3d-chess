#!/usr/bin/env node
// Renders the picture at the top of the README: the start page as a player
// first sees it, the tower in its garden with the pieces on their starting
// squares, before the demo's first move. The same frame, cut to a link
// preview's 1.91:1, is the page's social image (og:image in index.html).
//
//   node scripts/readme-image.mjs                     # writes ../docs/preview.jpg and public/og.jpg
//   node scripts/readme-image.mjs --out /tmp/x.jpg    # somewhere else (.png for lossless)
//   node scripts/readme-image.mjs --og /tmp/og.jpg    # the social image somewhere else
//   node scripts/readme-image.mjs --width 1400 --height 800 --scale 2 --quality 90
//
// Starts its own Vite (no backend: the start page asks nothing of the
// server), or uses SHOWCASE_URL if set. Renders in software (SwiftShader),
// like the showcase. Rerun it after anything visible changes, and commit the
// new picture.

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(opt('out', path.join(CLIENT, '..', 'docs', 'preview.jpg')));
// The canvas draws at most 4.5 million device pixels (three/pixelBudget.ts):
// 1400 x 800 at 2x is just under, so nothing is drawn small and scaled up.
const WIDTH = Number(opt('width', '1400'));
const HEIGHT = Number(opt('height', '800'));
const SCALE = Number(opt('scale', '2'));
const QUALITY = Number(opt('quality', '90'));
// The social image: the full width, 1.91:1 (1400 x 733 at the default size),
// cut evenly from the top and bottom, where the garden is empty. Drawn at CSS
// size, not the device scale: link previews show it at most 1200 wide, and
// crawlers drop large files.
const OG = path.resolve(opt('og', path.join(CLIENT, 'public', 'og.jpg')));
const OG_HEIGHT = Math.round(WIDTH / 1.91);
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

/**
 * Installed before any page script: a clock that stands still unless
 * stepped. The demo (game/demo.ts) and the camera's turn run on r3f's clock,
 * so held here the preview stays on the opening position, at the angle the
 * page opens on, however long software rendering takes to draw it.
 */
const STILL_CLOCK = () => {
  let now = performance.now();
  const queue = new Map();
  let nextId = 1;
  window.__step = (ms) => {
    now += ms;
    const due = [...queue.values()];
    queue.clear();
    for (const cb of due) cb(now);
  };
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => {
    queue.set(nextId, cb);
    return nextId++;
  };
  window.cancelAnimationFrame = (id) => queue.delete(id);
};

let vite = null;
let base = process.env.SHOWCASE_URL;
if (!base) {
  const { createServer } = await import('vite');
  // Tailwind finds the classes it generates (sr-only and the rest) from the
  // working directory: run from anywhere else, the page loses them.
  process.chdir(CLIENT);
  vite = await createServer({ root: CLIENT, logLevel: 'error', server: { port: 5199 } });
  await vite.listen();
  base = vite.resolvedUrls.local[0].replace(/\/$/, '');
}

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});
try {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: SCALE,
    reducedMotion: 'no-preference',
  });
  await context.addInitScript(STILL_CLOCK);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  await page.goto(`${base}/`);
  await page.waitForSelector('[data-testid="landing-canvas"] canvas', { timeout: 180000 });

  // Draw frames until the picture stops changing (the piece set and the
  // garden build over the first few): a quarter of a second of the demo's
  // clock, then frames that take no time at all. Its first move waits almost
  // three seconds.
  let last = null;
  for (let i = 0, same = 0; i < 120 && same < 3; i++) {
    await page.evaluate((ms) => window.__step(ms), i < 16 ? 16 : 0);
    await page.waitForTimeout(300);
    const shot = await page.screenshot({ type: 'png', scale: 'css' });
    same = last && shot.equals(last) ? same + 1 : 0;
    last = shot;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const jpeg = !/\.png$/i.test(OUT);
  await page.screenshot({
    path: OUT,
    type: jpeg ? 'jpeg' : 'png',
    ...(jpeg ? { quality: QUALITY } : {}),
  });
  console.log(OUT);

  fs.mkdirSync(path.dirname(OG), { recursive: true });
  await page.screenshot({
    path: OG,
    type: 'jpeg',
    quality: QUALITY,
    scale: 'css',
    clip: { x: 0, y: Math.round((HEIGHT - OG_HEIGHT) / 2), width: WIDTH, height: OG_HEIGHT },
  });
  console.log(OG);
} finally {
  await browser.close();
  await vite?.close();
}
