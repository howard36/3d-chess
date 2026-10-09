#!/usr/bin/env node
// Saves views of the garden's neon sculptures up close, through the dev-only
// sculpture viewer (client/sculptures.html): a sheet of one sculpture from
// several sides and heights, or a turn round it frame by frame.
//
//   node scripts/sculptures.mjs --out /tmp/s --target a4                 # 8 sides x 2 heights
//   node scripts/sculptures.mjs --out /tmp/s --target g2 --az 0,90 --el 5,40 --dist 10
//   node scripts/sculptures.mjs --out /tmp/s --target fallen:2
//   node scripts/sculptures.mjs --out /tmp/s --target a4 --orbit 2      # a frame every 2°, orbit.mp4
//
// --target a square ('a4'), 'fallen:<i>' or 'x,y,z'; --az / --el degrees (az
// 0 faces the board's centre); --dist world units; --size the square
// picture's side in px; --turn -1 for Black's garden; --name the sheet's
// file name. Needs only Vite running (SHOWCASE_URL, default
// http://127.0.0.1:5173); ffmpeg for an orbit, ImageMagick's montage for a
// sheet.
// Remote containers: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const list = (s) => s.split(',').map(Number);

const OUT = path.resolve(opt('out', 'sculptures'));
const TARGET_RAW = opt('target', 'a4');
const TARGET = /^-?[\d.]+,/.test(TARGET_RAW) ? list(TARGET_RAW) : TARGET_RAW;
const AZ = list(opt('az', '0,45,90,135,180,225,270,315'));
const EL = list(opt('el', '6,35'));
const DIST = Number(opt('dist', '14'));
const SIZE = Number(opt('size', '360'));
const TURN = opt('turn', '1');
const ORBIT = opt('orbit');
const FOV = Number(opt('fov', '30'));
const NAME = opt('name', `${String(TARGET_RAW).replace(/[^\w]+/g, '-')}`);
const BASE = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5173';
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

fs.mkdirSync(OUT, { recursive: true });
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
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  const query = new URLSearchParams({ turn: TURN });
  await page.goto(`${BASE}/sculptures.html?${query}`);
  await page.waitForFunction(() => window.__viewerReady === true, null, { timeout: 120000 });
  const shoot = async (view, file) => {
    await page.evaluate((v) => window.__view(v), view);
    await page.screenshot({ path: file });
  };
  if (ORBIT) {
    const step = Number(ORBIT);
    const dir = path.join(OUT, `${NAME}-orbit`);
    fs.mkdirSync(dir, { recursive: true });
    let k = 0;
    for (let az = 0; az < 360; az += step) {
      const file = path.join(dir, `f${String(k++).padStart(4, '0')}.png`);
      await shoot({ target: TARGET, az, el: EL[0], dist: DIST, fov: FOV }, file);
    }
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      '30',
      '-i',
      path.join(dir, 'f%04d.png'),
      '-pix_fmt',
      'yuv420p',
      path.join(OUT, `${NAME}-orbit.mp4`),
    ]);
    console.log(path.join(OUT, `${NAME}-orbit.mp4`));
  } else {
    const dir = path.join(OUT, `${NAME}-cells`);
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    for (const el of EL) {
      for (const az of AZ) {
        const file = path.join(dir, `el${el}-az${az}.png`);
        await shoot({ target: TARGET, az, el, dist: DIST, fov: FOV }, file);
        files.push({ file, label: `az ${az}  el ${el}` });
      }
    }
    const sheet = path.join(OUT, `${NAME}.png`);
    execFileSync('montage', [
      ...files.flatMap(({ file, label }) => ['-label', label, file]),
      '-tile',
      `${AZ.length}x${EL.length}`,
      '-geometry',
      '+2+2',
      '-background',
      '#20232b',
      '-fill',
      '#c8ccd4',
      '-pointsize',
      '13',
      sheet,
    ]);
    console.log(sheet);
  }
} finally {
  await browser.close();
}
