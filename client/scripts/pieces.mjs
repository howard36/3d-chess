#!/usr/bin/env node
// Saves the piece gallery (client/pieces.html) as a PNG: every piece as the
// game draws it, from the side, three-quarters and above, light and dark.
//
//   node scripts/pieces.mjs --out /tmp/pieces                  # the pieces
//   node scripts/pieces.mjs --piece knight --out /tmp/pieces   # one piece, 8 sides x 2 heights
//   node scripts/pieces.mjs --cell 320 --out /tmp/pieces       # bigger pictures
//   node scripts/pieces.mjs --silhouette --out /tmp/pieces     # solid black, 8 sides, low, top
//   node scripts/pieces.mjs --silhouette --quality high --out /tmp/pieces
//
// Needs Vite running (SHOWCASE_URL, default http://127.0.0.1:5173); no
// backend. Writes pieces[-<piece>].png, or pieces-silhouette-<quality>.png,
// into --out.
// Renders in software (SwiftShader), like the showcase: a sheet takes a few
// seconds.

import fs from 'node:fs';
import path from 'node:path';
import { flag, launchSoftwareGl, opt } from './lib/devScript.mjs';

const OUT = path.resolve(opt('out', 'pieces'));
const PIECE = opt('piece');
const QUALITY = opt('quality', 'medium');
const CELL = opt('cell', '200');
const SILHOUETTE = flag('silhouette');
const BASE = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5173';

fs.mkdirSync(OUT, { recursive: true });

const query = new URLSearchParams({ cell: CELL });
if (PIECE) query.set('piece', PIECE);
if (SILHOUETTE) {
  query.set('silhouette', '');
  query.set('quality', QUALITY);
}
const name = ['pieces', PIECE, SILHOUETTE && `silhouette-${QUALITY}`].filter(Boolean).join('-');

const browser = await launchSoftwareGl();
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
