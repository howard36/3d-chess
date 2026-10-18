#!/usr/bin/env node
// Renders the start page's pictures of its preview (three/landingLens.ts,
// LANDING_PICTURES: one for each of its layouts, and a phone's cut for the
// taller phones): the opening position from
// the preview's first angle, through the dev-only landing-pictures.html, as
// AVIF and WebP into public/landing/. The start page shows the picture while
// three.js loads and fades the live preview in over it, so a picture out of
// date shows as a change at the handover: rerun this, and commit the
// pictures, after anything visible changes in the preview's opening (the
// tower, the pieces, the garden, the lens), as for scripts/readme-image.mjs.
//
//   node scripts/landing-pictures.mjs                      # every picture, 1x and 2x
//   node scripts/landing-pictures.mjs --picture wide --density 2x --out /tmp/pictures
//
// Starts its own Vite (no backend), or uses SHOWCASE_URL if set; ffmpeg (with
// libaom-av1 and libwebp) encodes. Renders in software (SwiftShader).
// Remote containers: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(opt('out', path.join(CLIENT, 'public', 'landing')));
const PICTURES = opt('picture', 'phone-tall,phone,tablet,wide').split(',');
const DENSITIES = opt('density', '1x,2x').split(',');
// --keep-png also writes the lossless render beside them (for comparing encodings)
const KEEP_PNG = argv.includes('--keep-png');
// Drawn at twice the CSS size, the picture's pixels (the canvas's buffer)
const SCALE = 2;
// AVIF's quality (CRF, lower is finer) and WebP's
const AVIF_CRF = '32';
const WEBP_QUALITY = '75';
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

/** A clock that stands still unless stepped: nothing in the scene moves while it draws. */
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
  process.chdir(CLIENT);
  vite = await createServer({ root: CLIENT, logLevel: 'error', server: { port: 5198 } });
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
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-pictures-'));
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const picture of PICTURES)
    for (const density of DENSITIES) {
      const context = await browser.newContext({
        viewport: { width: 400, height: 400 },
        deviceScaleFactor: SCALE,
        reducedMotion: 'no-preference',
      });
      await context.addInitScript(STILL_CLOCK);
      const page = await context.newPage();
      page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
      await page.goto(`${base}/landing-pictures.html?picture=${picture}&density=${density}`);
      const { width, height } = await page.evaluate(() => window.__picture);
      await page.setViewportSize({ width: width / SCALE, height: height / SCALE });
      await page.waitForSelector('[data-testid="landing-canvas"] canvas', { timeout: 180000 });
      // Frames until the picture stops changing (the piece set and the garden
      // build over the first few), on a clock that never moves
      let last = null;
      for (let i = 0, same = 0; i < 120 && same < 3; i++) {
        await page.evaluate(() => window.__step(0));
        await page.waitForTimeout(400);
        const shot = await page.screenshot({ type: 'png' });
        same = last && shot.equals(last) ? same + 1 : 0;
        last = shot;
      }
      const name = density === '1x' ? picture : `${picture}@2x`;
      const png = path.join(KEEP_PNG ? OUT : work, `${name}.png`);
      fs.writeFileSync(png, last);
      const encode = (args, file) =>
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, ...args, file]);
      const avif = path.join(OUT, `${name}.avif`);
      const webp = path.join(OUT, `${name}.webp`);
      encode(
        [
          '-c:v',
          'libaom-av1',
          '-still-picture',
          '1',
          '-crf',
          AVIF_CRF,
          '-cpu-used',
          '4',
          '-pix_fmt',
          'yuv420p',
        ],
        avif,
      );
      encode(['-c:v', 'libwebp', '-quality', WEBP_QUALITY], webp);
      const kb = (f) => `${Math.round(fs.statSync(f).size / 1024)} KB`;
      console.log(`${name}: ${width}x${height}, ${avif} (${kb(avif)}), ${webp} (${kb(webp)})`);
      await context.close();
    }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
  await browser.close();
  await vite?.close();
}
