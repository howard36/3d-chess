#!/usr/bin/env node
// Renders the picture at the top of the README: the start page's first frame,
// as a player sees it before three.js has arrived (the page's picture of its
// preview, LandingPicture, under the title and the ways in), the tower in its
// garden with every piece on its starting square. The same frame, drawn at 1x
// and cut to a link preview's 1.91:1, is the page's social image (og:image in
// index.html).
//
//   node scripts/readme-image.mjs                     # writes ../docs/preview.jpg and public/og.jpg
//   node scripts/readme-image.mjs --out /tmp/x.jpg    # somewhere else (.png for lossless)
//   node scripts/readme-image.mjs --og /tmp/og.jpg    # the social image somewhere else
//   node scripts/readme-image.mjs --width 1400 --height 800 --scale 2 --qscale 2 --og-quality 90
//
// Starts its own Vite (no backend: the start page asks nothing of the
// server), or uses SHOWCASE_URL if set. The preview's chunk is held back, so
// the page stays on its first frame however long the shot takes: the
// tower is the picture in public/landing/, which scripts/landing-pictures.mjs
// renders. Rerun this after anything visible changes on the start page (and
// that one first, after a change to the preview's opening), and commit the
// new pictures. ffmpeg encodes the JPEGs.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXECUTABLE, opt } from './lib/devScript.mjs';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(opt('out', path.join(CLIENT, '..', 'docs', 'preview.jpg')));
// At 2x the page shows the 2x picture of the preview (LANDING_PICTURES)
const WIDTH = Number(opt('width', '1400'));
const HEIGHT = Number(opt('height', '800'));
const SCALE = Number(opt('scale', '2'));
// The JPEGs' quantizer (ffmpeg's -q:v, lower is finer), their colour kept at
// full resolution (4:4:4): a browser's own JPEGs halve it (4:2:0), which
// blurs the thin neon edges, the title's gradient and the tiles' rims.
const QSCALE = opt('qscale', '2');
// The social image: the full width, 1.91:1 (1400 x 733 at the default size),
// cut evenly from the top and bottom, where the garden is empty. The page as
// a 1x screen draws it (the 1x picture): link previews show it at most 1200
// wide, and crawlers drop large files. It is the browser's own JPEG (JFIF,
// 4:2:0), the commonest kind there is, not ffmpeg's: X showed no picture in
// its card for ffmpeg's (no JFIF header, every channel sampled 1x2), and
// halves the colour of whatever it shows anyway.
const OG = path.resolve(opt('og', path.join(CLIENT, 'public', 'og.jpg')));
const OG_HEIGHT = Math.round(WIDTH / 1.91);
const OG_QUALITY = Number(opt('og-quality', '90'));

// The preview's chunk (src/screens/LandingPreview.tsx in dev,
// assets/LandingPreview-<hash>.js in a build), whose request is never answered
const PREVIEW_CHUNK = /\/LandingPreview[.-][^/]*$/;

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

/** The start page at a device scale, on its first frame once its picture and fonts are in. */
async function firstFrame(browser, deviceScaleFactor) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  await page.route(PREVIEW_CHUNK, () => {});
  await page.goto(`${base}/`);
  await page.waitForSelector('[data-testid="landing-picture"] img', { timeout: 60000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await document.querySelector('[data-testid="landing-picture"] img').decode();
  });
  // Nothing on the page has taken the picture's place
  if ((await page.locator('[data-testid="landing-canvas"]').count()) > 0)
    throw new Error('the preview drew over the picture');
  return page;
}

/**
 * A PNG as a 4:4:4 JPEG. -bitexact leaves ffmpeg's version out of the file,
 * so the same frame writes the same bytes.
 */
function writeJpeg(png, file) {
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'png_pipe', '-i', '-', '-frames:v', '1', '-update', '1']
      .concat(['-c:v', 'mjpeg', '-pix_fmt', 'yuvj444p', '-qmin', '1', '-q:v', QSCALE])
      .concat(['-bitexact', file]),
    { input: png },
  );
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });
try {
  const page = await firstFrame(browser, SCALE);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const shot = await page.screenshot({ type: 'png' });
  if (/\.png$/i.test(OUT)) fs.writeFileSync(OUT, shot);
  else writeJpeg(shot, OUT);
  console.log(OUT);

  const og = await firstFrame(browser, 1);
  fs.mkdirSync(path.dirname(OG), { recursive: true });
  await og.screenshot({
    type: 'jpeg',
    quality: OG_QUALITY,
    path: OG,
    clip: { x: 0, y: Math.round((HEIGHT - OG_HEIGHT) / 2), width: WIDTH, height: OG_HEIGHT },
  });
  console.log(OG);
} finally {
  await browser.close();
  await vite?.close();
}
