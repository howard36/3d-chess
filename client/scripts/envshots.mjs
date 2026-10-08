#!/usr/bin/env node
// ENV PREVIEW (temporary): the same views of the garden for each of several
// env-preview combinations, side by side, to compare environment features.
//
//   node scripts/envshots.mjs --out /tmp/shots \
//     --combo off=baseline --combo soft=aurora:soft --combo bold='aurora:bold,mist:on'
//
// Each --combo is name=list, the list as `?env=` takes it (feature:option
// pairs, comma-separated; `baseline` sets every feature to today's main,
// `recommended` to its default, and pairs after either win), or name=query
// for a whole query string (anything with an `=` in it: `env=baseline&x=1`).
// For each combo it saves <out>/<name>/<view>.png, and then <out>/sheet.png:
// a row per view, a column per combo. The views (--views to choose, in this
// order by default):
//   white  White's seat, the opening view, 1280x800
//   black  Black's seat, the opening view, 1280x800
//   phone  White's seat on a phone upright, 390x844 (touch, 2x pixels)
//   sky    White's seat, the camera as low as it goes (below the horizon),
//          zoomed in, looking up past the tower at the sky and its
//          constellations, 1280x800
//   top    White's seat, the camera high and steep, zoomed out, looking down
//          over the tower onto the garden's board, 1280x800
//   lobby  the side choice against the computer (/computer), 1280x800
// --sky and --top "elevation,zoom,turn" move those cameras (degrees above
// the horizon, distance as a share of the opening view's, degrees turned
// round from the opening azimuth; the orbit's limits apply, and the sheet
// gives the pose reached).
//
// Needs only Vite running (`npm run dev`; any VITE_WS_URL, none needed): the
// game views open a game whose server is stood in for in the page (as e2e's
// openStandInGame does), at the opening position with both players seated,
// and the lobby asks no server. ENVSHOTS_URL points at Vite (default
// http://127.0.0.1:5173). The pages ask for reduced motion, so the entrance
// is a short fade (--motion full for the full one: slower). The menu is kept
// off the pictures (envpanel=0) unless --panel. About 10-30 s a combo.
// Remote containers: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium.

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const opts = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));

const BASE = (process.env.ENVSHOTS_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT = path.resolve(opt('out', 'envshots'));
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const ALL_VIEWS = ['white', 'black', 'phone', 'sky', 'top', 'lobby'];
const VIEWS = (opt('views', ALL_VIEWS.join(',')) ?? '').split(',').filter(Boolean);
const PANEL = flag('panel');
const MOTION = opt('motion', 'reduced');

for (const v of VIEWS) if (!ALL_VIEWS.includes(v)) throw new Error(`unknown view "${v}"`);
const combos = opts('combo').map((c) => {
  const at = c.indexOf('=');
  if (at <= 0) throw new Error(`--combo ${c}: expected name=list`);
  const name = c.slice(0, at);
  const value = c.slice(at + 1);
  const query = value.includes('=') ? value : `env=${value}`;
  return { name, query: PANEL || /(^|&)envpanel=/.test(query) ? query : `${query}&envpanel=0` };
});
if (!combos.length) {
  console.error('usage: node scripts/envshots.mjs --out <dir> --combo <name>=<list> [...]');
  process.exit(2);
}

/** Where each view's page stands, and what it opens. */
const PAGES = [
  { name: 'white', seat: 'white', viewport: [1280, 800], shots: ['white', 'sky', 'top'] },
  { name: 'black', seat: 'black', viewport: [1280, 800], shots: ['black'] },
  { name: 'phone', seat: 'white', viewport: [390, 844], phone: true, shots: ['phone'] },
  { name: 'lobby', lobby: true, viewport: [1280, 800], shots: ['lobby'] },
];

/** The camera for each shot: elevation (degrees), distance (of the opening's), azimuth turned (degrees). */
const POSES = {
  sky: { elevation: -14, zoom: 0.7, turn: 0 },
  top: { elevation: 48, zoom: 1.5, turn: 0 },
};
// --sky / --top "elevation,zoom,turn" move those two cameras
for (const view of ['sky', 'top']) {
  const given = opt(view);
  if (!given) continue;
  const [elevation, zoom, turn] = given.split(',').map(Number);
  POSES[view] = { elevation, zoom: zoom || 1, turn: turn || 0 };
}

/** Stands in for the server: on joining, a game at the opening with both seated. */
async function standIn(page, seat) {
  const opponent = seat === 'white' ? 'black' : 'white';
  await page.routeWebSocket(/\/ws$/, (ws) => {
    ws.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== 'rejoin_game') return;
      ws.send(JSON.stringify({ type: 'game_state', color: seat, started: true, moves: [] }));
      ws.send(JSON.stringify({ type: 'presence', color: opponent, online: true }));
    });
  });
}

/** Frames drawn on the page's own clock, asking for each (the canvas draws on demand). */
const frames = (page, n) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        let i = 0;
        const step = () => {
          window.__r3fState?.get().invalidate();
          if (++i >= n) done();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );

/** The camera to a pose about the orbit target, through the controls (their limits apply). */
const pose = (page, { elevation, zoom, turn }) =>
  page.evaluate(
    ({ elevation, zoom, turn }) => {
      const st = window.__r3fState.get();
      const { camera, controls } = st;
      const target = controls.target;
      window.__envshotsBase ??= (() => {
        const d = camera.position.clone().sub(target);
        return { r: d.length(), yaw: Math.atan2(d.x, d.z) };
      })();
      const { r, yaw } = window.__envshotsBase;
      const p = (Math.max(-80, Math.min(89.9, elevation)) * Math.PI) / 180;
      const y = yaw + (turn * Math.PI) / 180;
      camera.position.set(
        target.x + r * zoom * Math.cos(p) * Math.sin(y),
        target.y + r * zoom * Math.sin(p),
        target.z + r * zoom * Math.cos(p) * Math.cos(y),
      );
      camera.lookAt(target);
      controls.update();
      st.invalidate();
    },
    { elevation, zoom, turn },
  );

/** Where the camera ended up (the controls clamp), for the sheet. */
const where = (page) =>
  page.evaluate(() => {
    const { camera, controls } = window.__r3fState.get();
    const d = camera.position.clone().sub(controls.target);
    return `el ${((Math.asin(d.y / d.length()) * 180) / Math.PI).toFixed(1)}°, ${d.length().toFixed(1)} away`;
  });

async function shootPage(browser, combo, spec, dir) {
  const [width, height] = spec.viewport;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: spec.phone ? 2 : 1,
    isMobile: !!spec.phone,
    hasTouch: !!spec.phone,
    reducedMotion: MOTION === 'full' ? 'no-preference' : 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  const shots = [];
  try {
    if (spec.lobby) {
      await page.goto(`${BASE}/computer?${combo.query}`);
      await page.waitForSelector('[data-testid="lobby-canvas"]');
      await page.locator('.lobby-choice').first().waitFor({ state: 'visible' });
      // The kings formed and the buttons in
      await page.waitForTimeout(MOTION === 'full' ? 4000 : 1500);
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(dir, 'lobby.png');
      await page.screenshot({ path: file });
      shots.push({ view: 'lobby', file, note: '/computer' });
      return shots;
    }
    await standIn(page, spec.seat);
    await page.addInitScript((s) => localStorage.setItem('3dchess:role:ENVSHOT', s), spec.seat);
    await page.goto(`${BASE}/game/ENVSHOT?${combo.query}`);
    await page.waitForFunction(() => !!window.__r3fState);
    await page.locator('[data-intro="done"]').waitFor({ state: 'attached' });
    await page.evaluate(() => document.fonts.ready);
    for (const view of spec.shots) {
      if (POSES[view]) await pose(page, POSES[view]);
      // The camera's damped turn and anything easing in settle
      await frames(page, 24);
      const file = path.join(dir, `${view}.png`);
      await page.screenshot({ path: file });
      shots.push({ view, file, note: await where(page) });
    }
    return shots;
  } finally {
    await context.close();
  }
}

async function sheet(browser, results) {
  const height = 300;
  const widthOf = (view) => (view === 'phone' ? (height * 390) / 844 : (height * 1280) / 800);
  const rows = VIEWS.map((view) => {
    const cells = combos
      .map(({ name }) => {
        const shot = results[name].find((s) => s.view === view);
        if (!shot) return `<figure><div class="missing">no picture</div></figure>`;
        const src = `data:image/png;base64,${fs.readFileSync(shot.file).toString('base64')}`;
        return `<figure><img src="${src}" style="width:${widthOf(view)}px"><figcaption>${name} · ${shot.note}</figcaption></figure>`;
      })
      .join('');
    return `<h2>${view}</h2><div class="row">${cells}</div>`;
  });
  const width = Math.max(800, Math.ceil(combos.length * (widthOf('white') + 10) + 40));
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const queries = combos.map((c) => `<li><b>${c.name}</b> <code>?${c.query}</code></li>`).join('');
  await page.setContent(
    `<style>body{margin:0;padding:12px 20px;background:#101216;color:#dfe4ec;font:13px system-ui,sans-serif}
    h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:14px 0 6px}ul{margin:0;padding-left:18px;color:#aab3c0}
    .row{display:flex;gap:10px;align-items:flex-start}figure{margin:0}img{display:block;height:${height}px;border-radius:3px}
    figcaption{font-size:11px;color:#aab3c0;padding-top:3px}.missing{width:200px;height:${height}px;display:grid;place-items:center;background:#222}</style>
    <h1>Environment combos</h1><ul>${queries}</ul>${rows.join('')}`,
  );
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const file = path.join(OUT, 'sheet.png');
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return file;
}

async function main() {
  const started = Date.now();
  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const results = {};
    for (const combo of combos) {
      const dir = path.join(OUT, combo.name);
      fs.mkdirSync(dir, { recursive: true });
      results[combo.name] = [];
      for (const spec of PAGES) {
        if (!spec.shots.some((s) => VIEWS.includes(s))) continue;
        const wanted = { ...spec, shots: spec.shots.filter((s) => VIEWS.includes(s)) };
        const shots = await shootPage(browser, combo, wanted, dir);
        results[combo.name].push(...shots);
        for (const s of shots) console.log(`${combo.name} ${s.view}: ${s.file}`);
      }
    }
    console.log(await sheet(browser, results));
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
