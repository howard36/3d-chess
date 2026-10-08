#!/usr/bin/env node
// Renders the picture at the top of the README: a game against the computer
// in the middle of play, White's queen picked up with her moves ringed on
// the tower, as the game draws it.
//
//   node scripts/readme-image.mjs                     # writes ../docs/preview.jpg
//   node scripts/readme-image.mjs --out /tmp/x.jpg    # somewhere else (.png for lossless)
//   node scripts/readme-image.mjs --width 1400 --height 800 --scale 2 --quality 90 --zoom 0.85
//
// Starts its own Vite (no backend: a game against the computer lives in the
// browser), or uses SHOWCASE_URL if set. Renders in software (SwiftShader),
// like the showcase: about half a minute. Rerun it after anything visible
// changes, and commit the new picture.

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
// Nearer than the fitted view (the player's zoom reaches 0.7 of it)
const ZOOM = Number(opt('zoom', '0.85'));
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

// The landing page's demo game (game/demo.ts), up to the queen trade: two
// captures each way behind it, White to move, the queen on Cc4 in the middle
// of the tower with Black's queen to take on Db3.
const MOVES = [
  'Ab2-De5',
  'Ed4-Ba1',
  'Ac2-Cc4',
  'Dc4-Dc3',
  'Ad2-Dd5',
  'Ec4-Dd5',
  'Aa1-Ba1',
  'Dd5-Db3',
];
const PICK = 'Cc4';
const GAME_ID = 'readme';

const game = {
  id: GAME_ID,
  color: 'white',
  difficulty: 'medium',
  started: true,
  moves: MOVES.map((m, i) => {
    const [from, to] = m.split('-');
    return { by: i % 2 === 0 ? 'white' : 'black', from, to };
  }),
};

let vite = null;
let base = process.env.SHOWCASE_URL;
if (!base) {
  const { createServer } = await import('vite');
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
  });
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`3dchess:computer:${GAME_ID}`, JSON.stringify(game)],
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  await page.goto(`${base}/computer/${GAME_ID}`);
  await page.waitForSelector('[data-intro="done"]', { state: 'attached', timeout: 180000 });
  await page.evaluate((k) => {
    const { camera, controls, invalidate } = window.__r3fState.get();
    camera.position.sub(controls.target).multiplyScalar(k).add(controls.target);
    controls.update();
    invalidate();
  }, ZOOM);
  await page.waitForTimeout(500);

  // Pick the queen up: aim at her body (a little above her square's centre),
  // trying a few heights until her moves light up.
  const ringed = () =>
    page.evaluate(() => {
      let n = 0;
      window.__r3fState
        .get()
        .scene.traverse((o) => o.userData?.cube && o.userData.highlight && n++);
      return n;
    });
  for (const lift of [0.25, 0.15, 0.35, 0.05]) {
    const at = await page.evaluate(
      ([zxy, dy]) => {
        const { camera, scene, size } = window.__r3fState.get();
        scene.updateMatrixWorld(true);
        let cube = null;
        scene.traverse((o) => {
          if (o.userData?.cube && o.userData.zxy === zxy) cube = o;
        });
        const p = cube.getWorldPosition(cube.position.clone());
        p.y += dy;
        p.project(camera);
        return { x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height };
      },
      [PICK, lift],
    );
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(300);
    if ((await ringed()) > 0) break;
  }
  if ((await ringed()) === 0) throw new Error(`Could not pick up the piece on ${PICK}`);
  // Off the board, so nothing is hovered; then let the lift and the light settle
  await page.mouse.move(WIDTH - 4, HEIGHT - 4);
  await page.waitForTimeout(2500);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const jpeg = !/\.png$/i.test(OUT);
  await page.screenshot({
    path: OUT,
    type: jpeg ? 'jpeg' : 'png',
    ...(jpeg ? { quality: QUALITY } : {}),
  });
  console.log(OUT);
} finally {
  await browser.close();
  await vite?.close();
}
