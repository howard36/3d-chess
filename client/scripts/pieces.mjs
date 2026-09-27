#!/usr/bin/env node
// Saves the piece gallery (client/pieces.html) as a PNG: every piece of the
// shared set from the side, three-quarters and above, light and dark.
//
//   node scripts/pieces.mjs --out /tmp/pieces                  # the shared set
//   node scripts/pieces.mjs --design atelier --out /tmp/pieces # a design's own PieceBody
//   node scripts/pieces.mjs --piece knight --out /tmp/pieces   # one piece, 8 sides x 2 heights
//   node scripts/pieces.mjs --quality high --cell 320 --out /tmp/pieces
//   node scripts/pieces.mjs --silhouette --out /tmp/pieces        # solid black, 8 sides, low, top
//
// Needs Vite running (SHOWCASE_URL, default http://127.0.0.1:5173); no
// backend. Writes pieces[-<design>][-<piece>]-<quality>.png into --out.
// Renders in software (SwiftShader), like the showcase: a sheet takes a few
// seconds.

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const OUT = path.resolve(opt('out', 'pieces'));
const DESIGN = opt('design');
const PIECE = opt('piece');
const QUALITY = opt('quality', 'medium');
const CELL = opt('cell', '200');
const SILHOUETTE = argv.includes('--silhouette');
const BASE = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5173';
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

fs.mkdirSync(OUT, { recursive: true });

const query = new URLSearchParams({ quality: QUALITY, cell: CELL });
if (DESIGN) query.set('design', DESIGN);
if (PIECE) query.set('piece', PIECE);
if (SILHOUETTE) query.set('silhouette', '');
const name = ['pieces', DESIGN, PIECE, SILHOUETTE && 'silhouette', QUALITY]
  .filter(Boolean)
  .join('-');

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
  const page = await browser.newPage({ viewport: { width: 2400, height: 1800 } });
  page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  await page.goto(`${BASE}/pieces.html?${query}`);
  await page.waitForFunction(() => window.__galleryReady === true, null, { timeout: 120000 });
  const file = path.join(OUT, `${name}.png`);
  await page.getByTestId('piece-gallery').screenshot({ path: file });
  console.log(file);
} finally {
  await browser.close();
}
