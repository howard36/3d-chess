#!/usr/bin/env node
// Records a board design in play, for comparing designs side by side.
//
//   node scripts/showcase.mjs --design synthwave --out /tmp/showcase
//   node scripts/showcase.mjs --design synthwave --stills --out /tmp/shots
//
// Needs the app and a backend already running (see the run-3d-chess skill):
// SHOWCASE_URL points at Vite (default http://127.0.0.1:5173), whose
// VITE_WS_URL must reach the backend. Two browser contexts take the seats;
// the page seated as White is recorded.
//
// The recorded page runs on a virtual clock: requestAnimationFrame and
// performance.now are replaced, and every frame is rendered and captured
// on command. A software-rendered scene that manages a few frames a second
// still yields a smooth, full-rate video, and every run is identical.
//
// --stills skips the video and saves a PNG at each key moment (start,
// selection, a capture mid-flight, check, mate, the result).
// --plies N stops after N moves, for a quick look.
// --pose yaw,pitch,zoom holds the camera still at that offset from the
// opening view (degrees, degrees, distance factor).
// Needs ffmpeg with libx264 on PATH, or FFMPEG=/path/to/ffmpeg.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const DESIGN = opt('design', 'classic');
const OUT = path.resolve(opt('out', 'showcase'));
const STILLS = flag('stills');
const FPS = Number(opt('fps', 30));
const WIDTH = Number(opt('width', 1280));
const HEIGHT = Number(opt('height', 720));
const BASE = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5173';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

// A short game that shows every kind of moment: quiet moves, captures both
// ways, checks, and a mate by White. Found by search over the rules engine.
const GAME = (
  opt('moves') ??
  [
    'Bb1-Ee4 Dd5-Aa2', // unicorns trade pawns across the whole cube
    'Bc1-Dc3 Dc4-Cc4',
    'Bd1-Ed4 Dc5-Ed4', // bishop takes with check; the queen takes back
    'Aa1-Aa2 Ed4-Cb4', // rook takes the unicorn
    'Dc3-Cb4 Db4-Db3', // queen trade
    'Ad1-Bd3 Cc4-Cc3',
    'Ba1-Ea4 Db5-Bd5',
    'Ea4-Db4 Bd5-Bb3',
    'Cb4-Dc5', // mate
  ].join(' ')
)
  .split(/\s+/)
  .filter(Boolean);
const PLIES = Number(opt('plies', GAME.length));

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// In-page helpers

/** Installed before any page script: the virtual clock. */
const VIRTUAL_CLOCK = () => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let now = null;
  let nextId = 1;
  const queue = new Map();
  window.__vclock = {
    enable() {
      if (now === null) now = realNow();
    },
    step(ms) {
      now += ms;
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) {
        try {
          cb(now);
        } catch (e) {
          console.error(e);
        }
      }
    },
  };
  performance.now = () => (now === null ? realNow() : now);
  window.requestAnimationFrame = (cb) => {
    if (now === null) return realRaf(cb);
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
    realCancel(id);
  };
};

/**
 * Installed before any page script: drops the dev server's hot-update pushes,
 * so a file saved elsewhere during a recording can't reload or patch the page.
 */
const NO_HOT_RELOAD = () => {
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      this.hmr = protocols === 'vite-hmr';
    }
    addEventListener(type, listener, options) {
      if (!this.hmr || type !== 'message') return super.addEventListener(type, listener, options);
      return super.addEventListener(
        type,
        (event) => {
          try {
            const { type: kind } = JSON.parse(event.data);
            if (kind === 'full-reload' || kind === 'update' || kind === 'prune') return;
          } catch {
            // Not a JSON push: pass it on
          }
          listener(event);
        },
        options,
      );
    }
  };
};

/** Installed before any page script: scene queries, camera orbit, the cursor. */
const SHOW_HELPERS = () => {
  const store = () => {
    const s = window.__r3fState;
    if (!s) return null;
    return s.get ? s.get() : s;
  };
  let base = null;
  window.__show = {
    /** The chosen design's own canvas is up and its board is in the scene. */
    ready(design) {
      const el = document.querySelector('[data-testid="r3f-canvas"]');
      if (!el || (design && el.dataset.design !== design)) return false;
      let cubes = 0;
      store()?.scene.traverse((o) => {
        if (o.userData?.cube) cubes++;
      });
      return cubes === 125;
    },
    cube(zxy) {
      let found = null;
      store()?.scene.traverse((o) => {
        if (o.userData?.cube && o.userData.zxy === zxy) found = o;
      });
      return found;
    },
    isDestination(zxy) {
      return !!window.__show.cube(zxy)?.userData.highlight;
    },
    /** Viewport pixel whose ray reaches `zxy`'s piece (or destination cell) first. */
    pixelFor(zxy, kind) {
      const st = store();
      const cube = window.__show.cube(zxy);
      if (!st || !cube) return null;
      const { camera, size, scene, raycaster } = st;
      camera.updateMatrixWorld();
      scene.updateMatrixWorld(true);
      const c = cube.position;
      const near = (a, b) => Math.abs(a - b) < 1e-6;
      const at = (o) =>
        near(o.position.x, c.x) && near(o.position.y, c.y) && near(o.position.z, c.z);
      // A destination holding a piece to capture is clicked on that piece.
      const isTarget = (o) => (o.userData.piece ? at(o) : kind === 'cell' && o === cube);
      const interactive = (hit) => {
        for (let o = hit; o; o = o.parent) {
          if (o.userData.piece) return o;
          if (o.userData.cube) return o.userData.highlight ? o : null;
        }
        return null;
      };
      const V = cube.position.constructor;
      const box = cube.geometry.parameters;
      const offsets = kind === 'piece' ? [0.1, -0.1, 0.25, 0] : [0, 0.3, -0.3];
      const canvas = document.querySelector('canvas');
      const r = canvas.getBoundingClientRect();
      for (const oy of offsets)
        for (const ox of [0, 0.25, -0.25])
          for (const oz of [0, 0.25, -0.25]) {
            const p = new V(c.x + ox * box.width, c.y + oy * box.height, c.z + oz * box.depth);
            p.project(camera);
            // Aim at a whole page pixel: a click event reports whole-pixel
            // offsets, so the ray r3f casts for the click comes from there.
            const x = Math.round(r.left + (p.x * 0.5 + 0.5) * size.width);
            const y = Math.round(r.top + (-p.y * 0.5 + 0.5) * size.height);
            const ndc = {
              x: ((x - r.left) / size.width) * 2 - 1,
              y: -((y - r.top) / size.height) * 2 + 1,
            };
            raycaster.setFromCamera(ndc, camera);
            let first = null;
            for (const hit of raycaster.intersectObjects(scene.children, true)) {
              first = interactive(hit.object);
              if (first) break;
            }
            if (first && isTarget(first) && document.elementFromPoint(x, y) === canvas) {
              return { x, y };
            }
          }
      return null;
    },
    /** World position of a colour's king, if it is on the board. */
    kingAt(color) {
      let found = null;
      store()?.scene.traverse((o) => {
        const p = o.userData?.piece;
        if (p && p.type === 'King' && p.color === color) {
          found = o.getWorldPosition(o.position.clone());
        }
      });
      return found && [found.x, found.y, found.z];
    },
    /** What r3f itself hits at a page pixel: its interaction list, nearest first. */
    probe(x, y) {
      const st = store();
      const canvas = document.querySelector('canvas');
      const r = canvas.getBoundingClientRect();
      const ndc = { x: ((x - r.left) / r.width) * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 };
      st.raycaster.setFromCamera(ndc, st.camera);
      const hits = st.raycaster.intersectObjects(st.internal.interaction, true);
      const describe = (o) => {
        let t = o;
        while (t.parent && !t.userData.piece && !t.userData.cube) t = t.parent;
        return `${t.name || t.type}:${Object.keys(t.userData).slice(0, 2).join('+')}(${t.position.x.toFixed(1)},${t.position.y.toFixed(1)},${t.position.z.toFixed(1)})`;
      };
      return {
        initialClick: st.internal.initialClick,
        initialHits: st.internal.initialHits.map(describe),
        captured: st.internal.capturedMap?.size,
        size: [st.size.width, st.size.height, r.width, r.height],
        hovered: st.internal.hovered.size,
        disabled: document.querySelector('[data-testid="turn-indicator"]')?.textContent,
        hits: hits.slice(0, 5).map((h) => {
          let o = h.object;
          while (o.parent && !o.userData.piece && !o.userData.cube) o = o.parent;
          const p = o.position;
          return `${Object.keys(o.userData).slice(0, 2).join('+')}@${h.distance.toFixed(2)} (${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
        }),
      };
    },
    /** What the ray through a cell's centre hits first, for diagnosing a failed aim. */
    explain(zxy) {
      const st = store();
      const cube = window.__show.cube(zxy);
      if (!st) return 'no r3f state';
      if (!cube) {
        const zxys = [];
        let n = 0;
        st.scene.traverse((o) => {
          n++;
          if (o.userData?.cube) zxys.push(o.userData.zxy);
        });
        return { objects: n, cubes: zxys.length, sample: zxys.slice(0, 5) };
      }
      const { camera, scene, raycaster, size } = st;
      const p = cube.position.clone();
      p.project(camera);
      raycaster.setFromCamera({ x: p.x, y: p.y }, camera);
      const hits = raycaster
        .intersectObjects(scene.children, true)
        .slice(0, 6)
        .map((h) => {
          let o = h.object;
          while (o.parent && !o.userData.piece && !o.userData.cube) o = o.parent;
          return `${h.object.type}:${Object.keys(o.userData).join('+')}@${h.distance.toFixed(2)}`;
        });
      const canvas = document.querySelector('canvas');
      const r = canvas.getBoundingClientRect();
      const px = [
        (p.x * 0.5 + 0.5) * size.width + r.left,
        (-p.y * 0.5 + 0.5) * size.height + r.top,
      ];
      const under = document.elementFromPoint(px[0], px[1]);
      return { px, under: `${under?.tagName}.${under?.className}`, hits };
    },
    /**
     * Swings the camera around the board: yaw/pitch in degrees off the opening
     * view, distance scaled by `zoom`, and the look-at point pulled `pull` of
     * the way from the board's centre toward `focus`.
     */
    orbit(yawDeg, pitchDeg, zoom, focus, pull) {
      const st = store();
      if (!st) return;
      const { camera, controls } = st;
      const target = controls?.target ?? new camera.position.constructor();
      if (!base) {
        const d = camera.position.clone().sub(target);
        base = {
          r: d.length(),
          yaw: Math.atan2(d.x, d.z),
          pitch: Math.asin(d.y / d.length()),
          centre: target.clone(),
        };
      }
      if (focus) {
        target.set(
          base.centre.x + (focus[0] - base.centre.x) * pull,
          base.centre.y + (focus[1] - base.centre.y) * pull,
          base.centre.z + (focus[2] - base.centre.z) * pull,
        );
      }
      const yaw = base.yaw + (yawDeg * Math.PI) / 180;
      const pitch = Math.max(-1.4, Math.min(1.4, base.pitch + (pitchDeg * Math.PI) / 180));
      const r = base.r * zoom;
      camera.position.set(
        target.x + r * Math.cos(pitch) * Math.sin(yaw),
        target.y + r * Math.sin(pitch),
        target.z + r * Math.cos(pitch) * Math.cos(yaw),
      );
      camera.lookAt(target);
      controls?.update?.();
      st.invalidate();
    },
    cursor(x, y, press) {
      let el = document.getElementById('__cursor');
      if (!el) {
        el = document.createElement('div');
        el.id = '__cursor';
        el.style.cssText =
          'position:fixed;left:0;top:0;width:0;height:0;z-index:99999;pointer-events:none;';
        el.innerHTML =
          '<div id="__ring" style="position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;border:3px solid rgba(255,255,255,0.9);box-shadow:0 0 12px rgba(0,0,0,0.5);opacity:0"></div>' +
          '<svg width="26" height="30" viewBox="0 0 26 30" style="position:absolute;left:-3px;top:-2px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45))"><path d="M3 2 L3 24 L9 18.5 L13 27 L17 25.2 L13 16.8 L21 16.5 Z" fill="white" stroke="black" stroke-width="1.6" stroke-linejoin="round"/></svg>';
        document.body.appendChild(el);
      }
      el.style.transform = `translate(${x}px, ${y}px)`;
      const ring = document.getElementById('__ring');
      ring.style.opacity = String(press);
      ring.style.transform = `scale(${1.6 - press * 0.8})`;
    },
    turnText: () => document.querySelector('[data-testid="turn-indicator"]')?.textContent ?? '',
  };
};

// ---------------------------------------------------------------------------
// Recording

// waitForFunction polls on requestAnimationFrame by default, which the
// virtual clock holds still between frames: poll on a timer instead.
const POLL = { polling: 50, timeout: 60000 };

const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

async function main() {
  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
    ],
  });
  const contexts = await Promise.all(
    [0, 1].map(() => browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })),
  );
  for (const ctx of contexts) {
    await ctx.addInitScript(NO_HOT_RELOAD);
    await ctx.addInitScript(VIRTUAL_CLOCK);
    await ctx.addInitScript(SHOW_HELPERS);
  }
  const [pageA, pageB] = await Promise.all(contexts.map((c) => c.newPage()));
  for (const p of [pageA, pageB]) {
    p.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  }

  await pageA.goto(`${BASE}/?design=${DESIGN}`);
  await pageA.getByRole('button', { name: 'Start New Game' }).click();
  await pageA.waitForURL(/\/game\/[A-Z0-9]+/);
  await pageB.goto(`${pageA.url()}?design=classic`);
  await pageB.getByRole('button', { name: 'Join Game' }).click();
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => window.__show?.ready(), null, { timeout: 120000 });
  }

  const colorOf = async (p) =>
    (await p.locator('text=/You are playing as/').textContent()).match(/as (white|black)/)[1];
  const white = (await colorOf(pageA)) === 'white' ? pageA : pageB;
  const black = white === pageA ? pageB : pageA;
  // The opponent's page is only there to answer; keep its renderer cheap.
  await black.setViewportSize({ width: 400, height: 300 });
  if (white === pageB) {
    // The joiner opened the game with the classic look; switch it over.
    await white.goto(`${white.url().split('?')[0]}?design=${DESIGN}`);
  }
  await white.waitForFunction((d) => window.__show?.ready(d), DESIGN, { timeout: 120000 });
  await white.evaluate(() => document.fonts.ready);
  // Let the design's chunk, fonts and first frames settle in real time
  await white.waitForTimeout(1500);
  await white.evaluate(() => window.__vclock.enable());

  const cdp = await white.context().newCDPSession(white);
  let ffmpeg = null;
  if (!STILLS) {
    ffmpeg = spawn(
      FFMPEG,
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        String(FPS),
        '-c:v',
        'mjpeg',
        '-i',
        '-',
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        path.join(OUT, `${DESIGN}.mp4`),
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
  }

  let frame = 0;
  let cursor = { x: WIDTH * 0.62, y: HEIGHT * 0.92 };
  let press = 0;
  // Camera path: a slow reveal, then a gentle sway for the rest of the game.
  const pose = opt('pose');
  const camera = (f) => {
    if (pose) return pose.split(',').map(Number);
    const t = f / FPS;
    // Stills skip the opening swing and show each design from its own view
    const intro = STILLS ? 1 : Math.min(t / 2.5, 1);
    const k = ease(intro);
    const yaw = -18 * (1 - k) + 8 * Math.sin((t - 2.5) * 0.3) * k;
    const pitch = 8 * (1 - k) + 2 * Math.sin(t * 0.21) * k;
    const zoom = 1.12 - 0.12 * k;
    return [yaw, pitch, zoom];
  };

  // The finale: once mate lands, the camera leans in on the fallen king.
  let finale = null;
  const step = async (capture = !STILLS) => {
    let [yaw, pitch, zoom] = camera(frame);
    let pull = 0;
    if (finale) {
      const k = ease(Math.min((frame - finale.frame) / (FPS * 1.6), 1));
      zoom *= 1 - 0.18 * k;
      pull = 0.3 * k;
    }
    await white.evaluate(
      ({ ms, yaw, pitch, zoom, focus, pull, cx, cy, press }) => {
        window.__show.orbit(yaw, pitch, zoom, focus, pull);
        window.__show.cursor(cx, cy, press);
        window.__vclock.step(ms);
      },
      {
        ms: 1000 / FPS,
        yaw,
        pitch,
        zoom,
        focus: finale?.king ?? null,
        pull,
        cx: cursor.x,
        cy: cursor.y,
        press,
      },
    );
    frame++;
    press = Math.max(0, press - 0.12);
    if (capture && ffmpeg) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      if (!ffmpeg.stdin.write(Buffer.from(data, 'base64'))) {
        await new Promise((r) => ffmpeg.stdin.once('drain', r));
      }
    }
  };
  const hold = async (seconds) => {
    for (let i = 0; i < Math.round(seconds * FPS); i++) await step();
  };
  const still = async (name) => {
    if (!STILLS) return;
    await step(false);
    const file = path.join(OUT, `${DESIGN}-${name}.png`);
    await white.screenshot({ path: file, timeout: 120000 });
    console.log(file);
  };
  const locate = (zxy, kind) =>
    white.evaluate(({ zxy, kind }) => window.__show.pixelFor(zxy, kind), { zxy, kind });
  // Glides the cursor onto a piece or cell, re-aiming every frame (the camera
  // keeps swaying), and leaves it exactly on target for the click.
  const glideTo = async (zxy, kind, seconds = 0.45) => {
    const from = { ...cursor };
    const n = Math.max(1, Math.round(seconds * FPS));
    let target = null;
    for (let i = 1; i <= n + 40; i++) {
      target = (await locate(zxy, kind)) ?? target;
      if (i > n && target) break;
      if (target) {
        const k = ease(Math.min(i / n, 1));
        cursor = { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k };
        await white.mouse.move(cursor.x, cursor.y);
      }
      await step();
    }
    target = await locate(zxy, kind);
    if (!target) {
      const why = await white.evaluate((z) => window.__show.explain(z), zxy);
      throw new Error(`no pixel reaches ${kind} ${zxy}: ${JSON.stringify(why)}`);
    }
    cursor = target;
    await white.mouse.move(cursor.x, cursor.y);
  };
  const waitTurn = async (page, text) => {
    await page.waitForFunction((t) => window.__show.turnText().startsWith(t), text, {
      ...POLL,
      timeout: 60000,
    });
  };

  await hold(STILLS ? 0.2 : 2.8);
  await still('start');

  for (let i = 0; i < Math.min(PLIES, GAME.length); i++) {
    const [from, to] = GAME[i].split('-');
    const whiteMoves = i % 2 === 0;
    const next = whiteMoves ? 'Black to move' : 'White to move';
    if (whiteMoves) {
      await glideTo(from, 'piece');
      await white.mouse.click(cursor.x, cursor.y);
      press = 1;
      const selectedNow = () =>
        white.waitForFunction((z) => window.__show.isDestination(z), to, {
          ...POLL,
          timeout: 8000,
        });
      await selectedNow()
        .catch(async () => {
          console.log(`retrying the click on ${from}`);
          await step();
          await white.mouse.click(cursor.x, cursor.y);
          return selectedNow();
        })
        .catch(async (e) => {
          const why = {
            aim: await white.evaluate((z) => window.__show.explain(z), from),
            r3f: await white.evaluate(({ x, y }) => window.__show.probe(x, y), cursor),
          };
          throw new Error(
            `selecting ${from} at ${JSON.stringify(cursor)} did nothing: ${JSON.stringify(why)}`,
            { cause: e },
          );
        });
      await hold(0.55);
      if (i === 0) await still('selected');
      await glideTo(to, 'cell', 0.5);
      await white.mouse.click(cursor.x, cursor.y);
      press = 1;
      await waitTurn(white, next);
    } else {
      await black.fill('#typed-move', `${from}-${to}`);
      await black.press('#typed-move', 'Enter');
      await waitTurn(white, next);
      // Drift the cursor aside while the opponent's piece moves
      cursor = {
        x: cursor.x + (WIDTH * 0.8 - cursor.x) * 0.15,
        y: cursor.y + (HEIGHT * 0.85 - cursor.y) * 0.15,
      };
    }
    const mid = STILLS && i === 5;
    if (mid) {
      for (let k = 0; k < 6; k++) await step(false);
      await still('capture-midflight');
    }
    if (i === GAME.length - 1) break;
    await hold(whiteMoves ? 0.9 : 1.1);
    if ((await white.evaluate(() => window.__show.turnText())).includes('check'))
      await still('check');
  }

  if (PLIES >= GAME.length) {
    // The mate: lean in while the design plays it out, then the result card
    // (the app holds it back for a moment on designs with a mate animation).
    const loser = GAME.length % 2 === 1 ? 'black' : 'white';
    finale = { frame, king: await white.evaluate((c) => window.__show.kingAt(c), loser) };
    await hold(1.3);
    await still('mate');
    await hold(2.6);
    await still('result');
    await hold(1.5);
  } else {
    await hold(0.6);
    await still('end');
  }

  if (ffmpeg) {
    ffmpeg.stdin.end();
    await new Promise((r) => ffmpeg.on('close', r));
    console.log(path.join(OUT, `${DESIGN}.mp4`), `${frame} frames`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
