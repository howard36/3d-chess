#!/usr/bin/env node
// Browser end-to-end benchmark: what a player experiences, measured in
// headless Chromium against a production build of the client and a local
// backend.
//
//   node scripts/bench-browser.mjs --out /tmp/bench-browser.json [--quick]
//
// Self-contained: it picks free ports, starts the backend (server/.venv's
// uvicorn, or `uv run`), builds the client with VITE_WS_URL pointing at that
// backend (checked in the emitted JS, so the build can never reach the
// production server), serves the build with `vite preview`, runs the
// scenarios, writes the report and tears everything down again, also on an
// error or Ctrl-C. --quick runs fewer and shorter cases (about a minute
// instead of about three). --only a,b runs a subset of the scenarios, by key:
// bundle, cold-load, setup, move-latency, reopen, presence, select, render,
// typed-paste. --keep keeps the temporary build and logs. Every section's
// rows come with a metrics list (the row's primary number, keyed stably) for
// comparing runs, and raw.timings holds each step's wall time. A section that
// fails (the app's flow changed under it, say) becomes a "failed" row in the
// report, which is still written, and the script exits 1.
//
// Chromium comes from PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH when set, as for the
// e2e suite. BENCH_NO_IDLE_CALLBACK=1 takes requestIdleCallback away from every
// page, as Safari and every iOS browser have it (none), to time their path. The board is drawn by SwiftShader (software WebGL), so a frame
// costs CPU time, far more than on a real GPU; the report says so where it
// matters and leans on measures that hold anyway (main-thread work, network
// round trips, relative comparisons).
//
// How it measures: an init script in every page records, on the page's own
// clock (performance.timeOrigin + performance.now(), comparable across pages
// and with this process), long tasks, WebSocket messages as they arrive, the
// Enter key in the move box, the DOM hooks the e2e suite reads
// (move-announcer's data-move-count, opponent-presence's data-online, ...)
// the moment React commits them, and every renderer.render() call (start and
// main-thread duration) by wrapping the renderer the Canvas publishes as
// window.__r3fState. Games that need a long record or a flapping opponent are
// driven straight over WebSockets from here; the server checks turn order but
// not legality, and the long game below is legal anyway.

import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const OUT = opt('out');
if (!OUT) {
  console.error('usage: node scripts/bench-browser.mjs --out <path.json> [--quick]');
  process.exit(2);
}
const QUICK = flag('quick');
const KEEP = flag('keep');
const SECTION_KEYS = [
  'bundle',
  'cold-load',
  'setup',
  'move-latency',
  'reopen',
  'presence',
  'select',
  'render',
  'typed-paste',
];
const ONLY = opt('only', null)?.split(',').filter(Boolean);
if (ONLY?.some((k) => !SECTION_KEYS.includes(k))) {
  console.error(`--only takes a comma-separated list of: ${SECTION_KEYS.join(', ')}`);
  process.exit(2);
}
const wants = (key) => !ONLY || ONLY.includes(key);
const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.resolve(CLIENT, '../server');
const VITE = path.join(CLIENT, 'node_modules/vite/bin/vite.js');
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
];

// A long, quiet game that the draw rules never end (bench/longGame.ts: no
// capture, check or promotion, no position twice, a pawn move every forty
// plies), the same on every run: its moves are typed in the move-latency
// section and seeded for the reopen. (The knight shuffle played before it
// stood the opening position a third time at ply 8: a draw by repetition.)
const LONG_GAME = JSON.parse(
  fs.readFileSync(new URL('../bench/longGame.json', import.meta.url), 'utf8'),
);
const gameMove = (i) => {
  if (i >= LONG_GAME.length)
    throw new Error(`the long game has ${LONG_GAME.length} plies, not ${i + 1}`);
  return LONG_GAME[i];
};

const CFG = QUICK
  ? {
      coldRuns: 2,
      setupRuns: 1,
      moves: 3,
      selects: 3,
      selectsAfterTurn: 2,
      reopenPlies: [0, 100, 500],
      reopenRuns: 1,
      flaps: [50],
      idleMs: 1000,
      orbitMs: 1500,
      typedLengths: [5000, 20000],
    }
  : {
      coldRuns: 6,
      setupRuns: 2,
      moves: 10,
      selects: 8,
      selectsAfterTurn: 4,
      reopenPlies: [0, 100, 500, 2000],
      reopenRuns: 2,
      flaps: [0, 200],
      idleMs: 2000,
      orbitMs: 3000,
      typedLengths: [2500, 5000, 10000, 20000],
    };

const VIEWPORTS = {
  desktop: {
    label: 'desktop 1280×800, DPR 1',
    options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  },
  phone: {
    label: 'phone 390×844, DPR 3, touch',
    options: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
  },
};

const CLK_TCK = (() => {
  try {
    return Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) || 100;
  } catch {
    return 100;
  }
})();

// DevTools' "Fast 4G" preset (60 ms × 2.75 latency, 9 and 1.5 Mbit/s × 0.9)
const FAST_4G = {
  offline: false,
  latency: 165,
  downloadThroughput: (9e6 / 8) * 0.9,
  uploadThroughput: (1.5e6 / 8) * 0.9,
};

// ---------------------------------------------------------------------------
// Formatting and statistics

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nodeNow = () => performance.timeOrigin + performance.now();
const other = (color) => (color === 'white' ? 'black' : 'white');

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const prec = (x) => (Math.abs(x) >= 999.5 ? x.toFixed(0) : x.toPrecision(3));
/** A duration in ms, to three significant figures in a unit fitting its size. */
function fmtMs(ms) {
  if (!ok(ms)) return '—';
  const a = Math.abs(ms);
  if (a === 0) return '0 ms';
  if (a < 1) return `${prec(ms * 1000)} µs`;
  if (a < 999.5) return `${prec(ms)} ms`;
  return `${prec(ms / 1000)} s`;
}
function fmtBytes(n) {
  if (!ok(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${prec(n / 1024)} KiB`;
  return `${prec(n / 1024 / 1024)} MiB`;
}
const fmtInt = (n) => (ok(n) ? String(Math.round(n)) : '—');
const fmtNum = (n) => (ok(n) ? prec(n) : '—');
const cell = (s) => String(s).replace(/\|/g, '\\|');

function quantile(xs, q) {
  const s = xs.filter(ok).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const median = (xs) => quantile(xs, 0.5);
const maxOf = (xs) => (xs.filter(ok).length ? Math.max(...xs.filter(ok)) : NaN);
const sum = (xs) => xs.filter(ok).reduce((a, b) => a + b, 0);
const stats = (xs) => ({
  median: median(xs),
  p95: quantile(xs, 0.95),
  max: maxOf(xs),
  n: xs.filter(ok).length,
});
/** A section row's primary number, for comparing runs (null where there is none). */
const metric = (value, unit = 'ms', better = 'lower') =>
  ok(value) ? { value: Number(value.toPrecision(6)), unit, better } : null;
/** A [label, median, p95, max, n, ...extra] row of durations, and its median as the metric. */
/** A stat row of counts (plain numbers, not durations). */
function countStat(label, xs, ...extra) {
  const s = stats(xs);
  const f = (v) => (ok(v) ? String(Number(v.toPrecision(3))) : '–');
  return [
    [label, f(s.median), f(s.p95), f(s.max), String(s.n), ...extra],
    metric(s.median, 'count'),
  ];
}
function stat(label, xs, ...extra) {
  const s = stats(xs);
  return [
    [label, fmtMs(s.median), fmtMs(s.p95), fmtMs(s.max), String(s.n), ...extra],
    metric(s.median),
  ];
}

const log = (...a) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------------------
// Processes: backend, build, preview server

const children = new Set();

function startProcess(cmd, args, { cwd, env = {}, logFile }) {
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', fd, fd],
    detached: true, // its own process group, so the whole tree is stopped together
  });
  fs.closeSync(fd);
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone
  }
}

async function stopProcess(child) {
  signalGroup(child, 'SIGTERM');
  const deadline = Date.now() + 4000;
  while (groupAlive(child.pid) && Date.now() < deadline) await sleep(100);
  if (groupAlive(child.pid)) signalGroup(child, 'SIGKILL');
  children.delete(child);
}

const tail = (file, lines = 25) => {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
};

async function runToEnd(cmd, args, opts, timeoutMs) {
  const child = startProcess(cmd, args, opts);
  const code = await Promise.race([
    new Promise((resolve) => child.once('exit', (c, s) => resolve(c ?? s))),
    sleep(timeoutMs).then(() => 'timeout'),
  ]);
  if (code !== 0) {
    await stopProcess(child);
    throw new Error(
      `${path.basename(cmd)} ${args.join(' ')} failed (${code}):\n${tail(opts.logFile)}`,
    );
  }
  children.delete(child);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitHttp(url, child, logFile, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${url}: process exited:\n${tail(logFile)}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // Not up yet
    }
    await sleep(200);
  }
  throw new Error(`${url} not up after ${timeoutMs} ms:\n${tail(logFile)}`);
}

// ---------------------------------------------------------------------------
// In-page instrumentation (an init script, before any page script)

const BENCH_INIT = () => {
  if (window.__bench) return;
  const now = () => performance.timeOrigin + performance.now();
  const b = {
    lt: [], // long tasks: [start, duration]
    rx: [], // WebSocket messages received: [time, type, data if short]
    wsOpen: [],
    wsUrls: [],
    clicks: [], // [time, target text]
    enter: [], // Enter keydowns in the move box
    renders: [], // renderer.render() calls: [start, main-thread duration]
    r3fAt: null,
    firsts: {}, // first time each landmark was in the DOM
    counts: [], // move-announcer data-move-count: [time, count, data-last-move]
    online: [], // opponent-presence data-online: [time, value]
    problems: [], // the move box's problem text: [time, text]
    links: [], // WebGL programs linked (compiled shaders): [time]
    syncs: [], // WebGL queries that held the main thread ≥ 2 ms: [time, name, duration]
    stage: [], // the route and the lobby's beat and scene as they change: [time, path, beat, scene]
    raf: [], // every animation frame's start (the page's frame pacing, canvases or not)
  };
  Object.defineProperty(window, '__bench', { value: b });
  Object.defineProperty(window, '__benchNow', { value: now });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        b.lt.push([performance.timeOrigin + e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    b.noLongtasks = true;
  }
  // Every shader program the page links: a new program is compiled and
  // linked inside the render() that first draws it
  for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    const link = Ctx?.prototype.linkProgram;
    if (!link) continue;
    Ctx.prototype.linkProgram = function (program) {
      b.links.push(now());
      // Which program: the start of its fragment shader's main
      const shaders = this.getAttachedShaders(program) ?? [];
      const src = shaders.map((sh) => this.getShaderSource(sh) ?? '').join('\n');
      // (and which canvas: the nearest test id above it)
      const where = this.canvas?.closest?.('[data-testid]')?.getAttribute('data-testid') ?? '?';
      (b.linked ??= []).push([
        now(),
        src.slice(src.lastIndexOf('void main')).replace(/\s+/g, ' ').slice(0, 90),
        where,
      ]);
      return link.call(this, program);
    };
  }
  // The queries that wait on the GPU process (a program's link status and
  // uniforms, a read-back): each one it had to wait for, and how long
  for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctx) continue;
    for (const name of Object.getOwnPropertyNames(Ctx.prototype)) {
      if (!/^(get|read|finish|clientWaitSync)/.test(name)) continue;
      const d = Object.getOwnPropertyDescriptor(Ctx.prototype, name);
      if (typeof d?.value !== 'function') continue;
      const f = d.value;
      Ctx.prototype[name] = function (...args) {
        const t0 = performance.now();
        try {
          return f.apply(this, args);
        } finally {
          const dt = performance.now() - t0;
          if (dt >= 2) {
            const what = name === 'getExtension' ? `${name}(${args[0]})` : name;
            b.syncs.push([performance.timeOrigin + t0, what, dt]);
          }
        }
      };
    }
  }
  // Timestamps each message as it arrives, ahead of the app's own handler
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      b.wsUrls.push(String(url));
      this.addEventListener('open', () => b.wsOpen.push(now()));
      this.addEventListener('message', (e) => {
        const d = typeof e.data === 'string' ? e.data : '';
        const m = /"type"\s*:\s*"(\w+)"/.exec(d.slice(0, 80));
        b.rx.push([now(), m ? m[1] : '?', d.length <= 200 ? d : null]);
      });
    }
  };
  addEventListener(
    'click',
    (e) => b.clicks.push([now(), (e.target?.textContent || '').trim().slice(0, 40)]),
    true,
  );
  addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && e.target?.id === 'typed-move') b.enter.push(now());
    },
    true,
  );
  const frame = (ts) => {
    b.raf.push(performance.timeOrigin + ts);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // The DOM hooks, stamped when React commits them
  let lastCount;
  let lastOnline;
  let lastProblem;
  const buttonNamed = (name, enabled) => {
    for (const el of document.querySelectorAll('button')) {
      if (el.textContent.trim() === name && (!enabled || !el.disabled)) return true;
    }
    return false;
  };
  let lastStage;
  const check = () => {
    const t = now();
    const f = b.firsts;
    const lobby = document.querySelector('[data-testid="lobby"]');
    const stage = [location.pathname, lobby?.dataset.beat ?? null, lobby?.dataset.scene ?? null];
    if (stage.join('|') !== lastStage) {
      lastStage = stage.join('|');
      b.stage.push([t, ...stage]);
    }
    const inGame = location.pathname.startsWith('/game/');
    if (
      !f.createButton &&
      !inGame &&
      (buttonNamed('Play a friend', true) || buttonNamed('Start a game', true))
    )
      f.createButton = t;
    if (
      inGame &&
      !f.joinButton &&
      !f.turnIndicator &&
      (buttonNamed('Join game') || buttonNamed('Join Game'))
    )
      f.joinButton = t;
    if (
      inGame &&
      !f.shareScreen &&
      document.querySelector('[data-testid="share-link"], p.break-all')
    )
      f.shareScreen = t;
    if (!f.turnIndicator && document.querySelector('[data-testid="turn-indicator"]')) {
      f.turnIndicator = t;
    }
    const ann = document.querySelector('[data-testid="move-announcer"]');
    const count = ann ? ann.getAttribute('data-move-count') : null;
    if (count !== lastCount) {
      lastCount = count;
      if (count !== null) b.counts.push([t, Number(count), ann.getAttribute('data-last-move')]);
    }
    const pres = document.querySelector('[data-testid="opponent-presence"]');
    const online = pres ? pres.getAttribute('data-online') : null;
    if (online !== lastOnline) {
      lastOnline = online;
      b.online.push([t, online]);
    }
    const prob = document.getElementById('typed-move-problem');
    const text = prob ? prob.textContent : null;
    if (text !== lastProblem) {
      lastProblem = text;
      b.problems.push([t, text]);
    }
  };
  new MutationObserver(check).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  // The Canvas publishes its r3f state here (GameScreen's onCreated); wrap
  // its renderer's render() to time every frame drawn
  let r3f;
  Object.defineProperty(window, '__r3fState', {
    configurable: true,
    get: () => r3f,
    set: (v) => {
      r3f = v;
      const gl = v?.gl;
      if (!gl || gl.__benchWrapped) return;
      gl.__benchWrapped = true;
      b.r3fAt = now();
      const render = gl.render;
      // How the frame drew the garden (scene/backdropCache.tsx): from its
      // copy ('cached'), in full and then copied ('capture'), or in full
      const parts = new WeakMap();
      const gardenMode = (scene) => {
        // (looked up until found: the cache adds them after the first frame)
        if (!parts.get(scene)?.copy)
          parts.set(scene, {
            copy: scene.getObjectByName('backdrop-copy'),
            take: scene.getObjectByName('backdrop-take'),
          });
        const { copy, take } = parts.get(scene);
        if (!copy) return null;
        return copy.visible ? 'cached' : take?.visible ? 'capture' : 'plain';
      };
      gl.render = function (scene, camera) {
        const t0 = performance.now();
        try {
          return render.call(this, scene, camera);
        } finally {
          b.renders.push([performance.timeOrigin + t0, performance.now() - t0, gardenMode(scene)]);
        }
      };
    },
  });
};

/** A copy of the page's recorded data (plus its time origin). */
const snap = (page) =>
  page.evaluate(() => ({ ...window.__bench, timeOrigin: performance.timeOrigin }));

const waitBoard = (page, timeout = 120000) =>
  page.waitForFunction(
    () =>
      window.__bench.renders.length > 0 &&
      !!window.__bench.firsts.turnIndicator &&
      // The game's entrance is over (the board takes no input while it plays)
      !document.querySelector('[data-intro="playing"]'),
    null,
    { polling: 100, timeout },
  );

/**
 * Waits until the canvas has no frame pending (r3f's demand loop counts the
 * frames asked for in internal.frames) and has drawn nothing for `quietMs`:
 * every animation is over. Returns false if that never happens within
 * `timeout`: once a move has been played the last-move line's shimmer asks
 * for a frame every frame, so the canvas never rests again.
 */
async function settle(page, { quietMs = 300, timeout = 15000 } = {}) {
  try {
    await page.waitForFunction(
      (q) => {
        if ((window.__r3fState?.get().internal.frames ?? 0) > 0) return false;
        const r = window.__bench.renders.at(-1);
        return !r || window.__benchNow() - (r[0] + r[1]) >= q;
      },
      quietMs,
      { polling: 100, timeout },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits until the page has drawn a frame and then run no long task (nor a
 * render() call over 50 ms) for `quietMs`: the board's first, costly frames
 * are behind it, whether or not the canvas ever rests.
 */
const quietMain = (page, quietMs = 300, timeout = 60000) =>
  page.waitForFunction(
    (q) => {
      const b = window.__bench;
      const r = b.renders.at(-1);
      if (!r) return false;
      const t = b.lt.at(-1);
      const busyUntil = Math.max(t ? t[0] + t[1] : 0, r[1] > 50 ? r[0] + r[1] : 0);
      return window.__benchNow() - busyUntil >= q;
    },
    quietMs,
    { polling: 50, timeout },
  );

/** Waits until the page has drawn a frame that started at or after `t`. */
const waitFrameAfter = (page, t, timeout = 60000) =>
  page.waitForFunction((from) => window.__bench.renders.some((r) => r[0] >= from), t, {
    polling: 50,
    timeout,
  });

const waitCount = (page, n, timeout = 60000) =>
  page.waitForFunction((k) => window.__bench.counts.some((c) => c[1] === k), n, {
    polling: 50,
    timeout,
  });

const firstFrameEnd = (b) => (b.renders.length ? b.renders[0][0] + b.renders[0][1] : NaN);
const inWindow = (entries, from, to) => entries.filter(([t]) => t >= from && t <= to);
/** Long tasks that overlap [from, to]. */
const tasksIn = (lt, from, to) => lt.filter(([s, d]) => s + d >= from && s <= to);

async function perfMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

// ---------------------------------------------------------------------------
// Browser contexts, and players driven over WebSockets from here

let BASE = '';
let WS_URL = '';
const offHost = [];
const isLocal = (url) =>
  /^(https?|wss?):\/\/127\.0\.0\.1[:/]/.test(url) || /^(data|blob|about|chrome):/.test(url);
const guard = (url) => {
  if (!isLocal(url)) offHost.push(url);
};

async function newBenchContext(browser, vp, role, extra = {}) {
  const ctx = await browser.newContext({ ...VIEWPORTS[vp].options, baseURL: BASE, ...extra });
  ctx.setDefaultTimeout(60000);
  await ctx.addInitScript(BENCH_INIT);
  if (process.env.BENCH_NO_IDLE_CALLBACK === '1')
    await ctx.addInitScript(() => {
      for (const name of ['requestIdleCallback', 'cancelIdleCallback'])
        Object.defineProperty(window, name, { value: undefined, configurable: true });
    });
  if (role) {
    await ctx.addInitScript(
      ([id, color]) => {
        // Not on the initial about:blank, whose storage is off limits
        if (location.protocol.startsWith('http')) localStorage.setItem(`3dchess:role:${id}`, color);
      },
      [role.gameId, role.color],
    );
  }
  ctx.on('request', (r) => guard(r.url()));
  ctx.on('page', (p) => {
    p.on('websocket', (ws) => guard(ws.url()));
    p.on('pageerror', (e) => log(`page error: ${e.message}`));
  });
  return ctx;
}

/** A player's socket, from this process (Node 22's WebSocket). */
class Sock {
  static async open(url, timeout = 10000) {
    const s = new Sock(url);
    await s.until(() => s.isOpen, timeout, 'open');
    return s;
  }
  constructor(url) {
    this.ws = new WebSocket(url);
    this.isOpen = false;
    this.closed = false;
    this.counts = {};
    this.last = {};
    this.error = null;
    this.waiters = new Set();
    const pump = () => this.waiters.forEach((w) => w());
    this.ws.addEventListener('open', () => {
      this.isOpen = true;
      pump();
    });
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data));
      this.counts[m.type] = (this.counts[m.type] ?? 0) + 1;
      this.last[m.type] = m;
      if (m.type === 'error') this.error = m;
      pump();
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      pump();
    });
  }
  until(pred, timeout = 10000, what = 'condition') {
    return new Promise((resolve, reject) => {
      let timer;
      const done = (fn) => {
        clearTimeout(timer);
        this.waiters.delete(check);
        fn();
      };
      const check = () => {
        if (pred()) return done(resolve);
        if (this.error) {
          const err = this.error;
          this.error = null;
          return done(() => reject(new Error(`server error ${err.code}: ${err.message}`)));
        }
        if (this.closed) done(() => reject(new Error(`socket closed waiting for ${what}`)));
      };
      timer = setTimeout(
        () => done(() => reject(new Error(`timed out waiting for ${what}`))),
        timeout,
      );
      this.waiters.add(check);
      check();
    });
  }
  count(type) {
    return this.counts[type] ?? 0;
  }
  waitType(type, n = 1, timeout = 10000) {
    return this.until(() => this.count(type) >= n, timeout, `${n}× ${type}`);
  }
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  async close(timeout = 5000) {
    if (this.closed) return;
    this.ws.close();
    await this.until(() => this.closed, timeout, 'close').catch(() => {});
  }
}

/** What a section opened (contexts, sockets), closed when it ends however it ends. */
class Scope {
  contexts = [];
  socks = [];
  ctx(c) {
    this.contexts.push(c);
    return c;
  }
  sock(s) {
    this.socks.push(s);
    return s;
  }
  async close() {
    await Promise.all(this.socks.map((s) => s.close(2000).catch(() => {})));
    await Promise.all(this.contexts.map((c) => c.close().catch(() => {})));
    this.socks = [];
    this.contexts = [];
  }
}

/**
 * A started game with `plies` of the long game recorded, both seats held
 * by sockets here: { gameId, seats: { white, black } }.
 */
async function seedGame(scope, plies) {
  const tag = Math.random().toString(36).slice(2, 10);
  const a = scope.sock(await Sock.open(WS_URL));
  a.send({ type: 'create_game', clientId: `bench-${tag}-a` });
  await a.waitType('game_created');
  const { gameId, color } = a.last.game_created;
  const b = scope.sock(await Sock.open(WS_URL));
  b.send({ type: 'join_game', gameId, clientId: `bench-${tag}-b` });
  await b.waitType('game_joined');
  await a.waitType('game_start');
  await b.waitType('game_start');
  const seats = { [color]: a, [other(color)]: b };
  const clientIds = { [color]: `bench-${tag}-a`, [other(color)]: `bench-${tag}-b` };
  for (let i = 0; i < plies; i++) {
    const s = seats[i % 2 === 0 ? 'white' : 'black'];
    const [from, to] = gameMove(i).split('-');
    s.send({ type: 'move', from, to });
    // Every seated socket hears every move: its (i+1)th echo is this one
    await s.waitType('move_made', i + 1);
  }
  return { gameId, seats, clientIds };
}

/** A fresh context and page seated as `color` in `gameId`, navigated there. */
async function openSeat(browser, scope, vp, gameId, color) {
  const ctx = scope.ctx(await newBenchContext(browser, vp, { gameId, color }));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${BASE}/game/${gameId}`, { waitUntil: 'commit' });
  return { ctx, page, cdp };
}

// ---------------------------------------------------------------------------
// Sections

const report = {
  tier: 'browser',
  title: 'Browser end to end (production build, headless Chromium)',
  meta: {},
  sections: [],
  findings: [],
  raw: {},
};
const raw = report.raw;
const ORDER = new Map();
/** Wall seconds per step and scenario (build, startup, each section, total). */
const TIMINGS = (raw.timings = {});
const SW_NOTE = `Frames are drawn by SwiftShader (software WebGL) on the CPU (${os.cpus().length} cores here), so frame times are CPU costs far above a real GPU’s: compare them with each other, not with a device.`;

async function section(key, def, run) {
  if (!wants(key) || aborted) return;
  const sec = {
    title: def.title,
    intro: def.intro,
    columns: def.columns,
    align: def.align,
    rows: [],
    metrics: [],
    notes: [],
  };
  // rows and metrics stay aligned: every row goes in through these
  // A metric's key names its row stably across runs (never a measured
  // value): by default the row's label, plain
  const plain = (label) => String(label).replace(/[*`]/g, '').trim();
  Object.defineProperties(sec, {
    add: {
      value: (row, m = null, metricKey = undefined) => {
        while (row.length < sec.columns.length) row.push('');
        sec.rows.push(row);
        sec.metrics.push(m ? { key: metricKey ?? plain(row[0]), ...m } : null);
      },
    },
    addAll: { value: (pairs) => pairs.forEach(([row, m, k]) => sec.add(row, m, k)) },
  });
  report.sections.push(sec);
  ORDER.set(sec, SECTION_KEYS.indexOf(key));
  const scope = new Scope();
  const t0 = Date.now();
  log(`${def.title}…`);
  let timer;
  try {
    await Promise.race([
      run(sec, scope),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`section timed out after ${def.timeoutMs / 1000} s`)),
          def.timeoutMs,
        );
      }),
    ]);
  } catch (e) {
    const msg = String(e?.message ?? e)
      .split('\n')[0]
      .slice(0, 300);
    log(`  failed: ${e?.stack ?? e}`);
    const row = Array(sec.columns.length).fill('—');
    row[0] = 'failed';
    row[row.length - 1] = `error: ${msg}`;
    sec.add(row);
    raw.errors = [...(raw.errors ?? []), { section: key, error: msg }];
  } finally {
    clearTimeout(timer);
    await scope.close();
  }
  sec.rows = sec.rows.map((r) => r.map(cell));
  // Keys are unique within a section
  const seen = new Map();
  for (const m of sec.metrics) {
    if (!m) continue;
    const n = (seen.get(m.key) ?? 0) + 1;
    seen.set(m.key, n);
    if (n > 1) m.key = `${m.key} #${n}`;
  }
  TIMINGS[key] = (Date.now() - t0) / 1000;
  log(`  done in ${TIMINGS[key].toFixed(1)} s`);
}

// 1. Bundle ------------------------------------------------------------------

/**
 * Every emitted file's size, raw and compressed. Started as soon as the build
 * is done: the compression runs on libuv's threads while the servers and the
 * browser start up, and is awaited before anything is timed.
 */
async function measureBundle(dist) {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dist);
  const gzip = promisify(zlib.gzip);
  const brotli = promisify(zlib.brotliCompress);
  const groupOf = (f) =>
    /\.m?js$/.test(f)
      ? 'JS'
      : /\.css$/.test(f)
        ? 'CSS'
        : /\.(woff2?|ttf|otf|eot)$/.test(f)
          ? 'fonts'
          : 'other';
  const rows = await Promise.all(
    files.map(async (f) => {
      const buf = await fs.promises.readFile(f);
      const [gz, br] = await Promise.all([
        gzip(buf, { level: 9 }),
        brotli(buf, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
          },
        }),
      ]);
      return {
        file: path.relative(dist, f),
        group: groupOf(f),
        raw: buf.length,
        gzip: gz.length,
        brotli: br.length,
        three: /\.m?js$/.test(f) && buf.includes('WebGLRenderer'),
      };
    }),
  );
  return rows.sort((a, b) => b.raw - a.raw);
}

async function bundleSection(bundle) {
  await section(
    'bundle',
    {
      title: 'Bundle',
      intro:
        'Every file `vite build` emits, raw and compressed at the highest gzip and brotli levels (what a host could precompress). This is what a first visit downloads, before anything is drawn; `vite preview`, used below, gzips on the fly at the default level.',
      columns: ['Asset', 'Group', 'Raw', 'gzip -9', 'brotli -11', 'Notes'],
      align: ['l', 'l', 'r', 'r', 'r', 'l'],
      timeoutMs: 120000,
    },
    async (sec) => {
      const rows = await bundle;
      raw.bundle = rows;
      // Content hashes change with every edit; the label must not
      const stable = (f) => f.replace(/-[\w-]{8}(\.\w+)$/, '-[hash]$1');
      const sizes = (list) => [
        fmtBytes(sum(list.map((r) => r.raw))),
        fmtBytes(sum(list.map((r) => r.gzip))),
        fmtBytes(sum(list.map((r) => r.brotli))),
      ];
      const gz = (list) => metric(sum(list.map((r) => r.gzip)), 'bytes');
      const groups = ['JS', 'CSS', 'fonts', 'other'];
      for (const g of groups) {
        const inGroup = rows.filter((r) => r.group === g);
        if (g === 'fonts') {
          const woff2 = inGroup.filter((r) => r.file.endsWith('.woff2'));
          sec.add(
            [
              `${inGroup.length} font files`,
              'fonts',
              ...sizes(inGroup),
              `${woff2.length} woff2 (${fmtBytes(sum(woff2.map((r) => r.raw)))}) + woff fallbacks; a browser fetches only the woff2 of each weight it uses`,
            ],
            gz(inGroup),
            'font files',
          );
          continue;
        }
        for (const r of inGroup) {
          sec.add(
            [
              stable(r.file),
              g,
              ...sizes([r]),
              [r.file, r.three ? 'contains three.js (WebGLRenderer)' : '']
                .filter(Boolean)
                .join('; '),
            ],
            gz([r]),
          );
        }
      }
      for (const g of groups) {
        const inGroup = rows.filter((r) => r.group === g);
        if (!inGroup.length) continue;
        sec.add(
          [
            `**Total ${g}**`,
            g,
            ...sizes(inGroup),
            `${inGroup.length} file${inGroup.length > 1 ? 's' : ''}`,
          ],
          gz(inGroup),
        );
      }
      sec.add(['**Total**', 'all', ...sizes(rows), `${rows.length} files`], gz(rows));
      if (rows.filter((r) => r.group === 'JS').length === 1) {
        sec.notes.push(
          'The build emits a single JS chunk (no code splitting): the start screen loads the whole app, 3D scene included, before its button works.',
        );
      }
      sec.notes.push('Metric: gzip -9 bytes.');
    },
  );
}

// 2. Cold load of the start screen -------------------------------------------

async function coldSection(browser) {
  const cases = [
    { key: 'desktop', label: 'desktop', vp: 'desktop' },
    { key: 'phone', label: 'phone', vp: 'phone' },
    { key: 'phone-cpu4-4g', label: 'phone, 4× CPU, Fast 4G', vp: 'phone', cpu: 4, net: FAST_4G },
  ];
  await section(
    'cold-load',
    {
      title: 'Cold load of the start screen',
      intro: `A first visit: a fresh browser context (empty cache) opens \`/\` until the “Play a friend” button is enabled and the socket to the server is open, ${CFG.coldRuns} runs per case. Desktop is ${VIEWPORTS.desktop.label}, phone ${VIEWPORTS.phone.label}; the third case models a mid-range phone on a mobile network: DevTools’ 4× CPU throttling and its “Fast 4G” preset (165 ms RTT, 8.1 Mbit/s down). Served from localhost by \`vite preview\` (gzip); nothing here draws WebGL.`,
      columns: ['Case', 'Metric', 'median', 'p95', 'max', 'n'],
      align: ['l', 'l', 'r', 'r', 'r', 'r'],
      timeoutMs: QUICK ? 120000 : 300000,
    },
    async (sec) => {
      /** One cold load: a fresh context opens `/` until the page can create a game. */
      const coldRun = async (c) => {
        const ctx = await newBenchContext(browser, c.vp);
        try {
          const page = await ctx.newPage();
          const cdp = await ctx.newCDPSession(page);
          await cdp.send('Performance.enable');
          if (c.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.cpu });
          if (c.net) {
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions', c.net);
          }
          await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 });
          await page.waitForFunction(
            () => window.__bench.firsts.createButton && window.__bench.wsOpen.length > 0,
            null,
            { polling: 20, timeout: 30000 },
          );
          const pm = await perfMetrics(cdp);
          await page
            .waitForFunction(
              () => performance.getEntriesByName('first-contentful-paint').length > 0,
              null,
              { timeout: 5000 },
            )
            .catch(() => {});
          const m = await page.evaluate(() => {
            const b = window.__bench;
            const t0 = performance.timeOrigin;
            const nav = performance.getEntriesByType('navigation')[0];
            const fcp = performance.getEntriesByName('first-contentful-paint')[0];
            const res = performance.getEntriesByType('resource');
            const ready = Math.max(b.firsts.createButton, b.wsOpen[0]);
            const lts = b.lt.filter(([s]) => s <= ready);
            return {
              html: nav.responseEnd,
              fcp: fcp ? fcp.startTime : null,
              dcl: nav.domContentLoadedEventEnd,
              load: nav.loadEventEnd,
              button: b.firsts.createButton - t0,
              socket: b.wsOpen[0] - t0,
              ready: ready - t0,
              longest: lts.length ? Math.max(...lts.map((l) => l[1])) : 0,
              transfer: nav.transferSize + res.reduce((s, r) => s + (r.transferSize || 0), 0),
              jsTransfer: res
                .filter((r) => /\.js$/.test(r.name))
                .reduce((s, r) => s + (r.transferSize || 0), 0),
            };
          });
          m.script = pm.ScriptDuration * 1000;
          return m;
        } finally {
          await ctx.close();
        }
      };
      // Round robin, so drift over the section falls on every case alike
      raw.cold = Object.fromEntries(cases.map((c) => [c.key, []]));
      for (let i = 0; i < CFG.coldRuns; i++) {
        for (const c of cases) raw.cold[c.key].push(await coldRun(c));
      }
      for (const c of cases) {
        const runs = raw.cold[c.key];
        const col = (k) => runs.map((r) => r[k]);
        const metrics = [
          ['HTML received', 'html'],
          ['first contentful paint', 'fcp'],
          ['DOMContentLoaded', 'dcl'],
          ['create button enabled', 'button'],
          ['socket open', 'socket'],
          ['main-thread script, to ready', 'script'],
          ['longest task, to ready', 'longest'],
        ];
        metrics.forEach(([label, k], i) => {
          const [row, m] = stat(label, col(k));
          sec.add([i === 0 ? `**${c.label}**` : '', ...row], m, `${c.label} · ${label}`);
        });
        sec.add(
          [
            '',
            'bytes transferred (all / JS)',
            `${fmtBytes(median(col('transfer')))} / ${fmtBytes(median(col('jsTransfer')))}`,
            '',
            '',
            String(runs.length),
          ],
          metric(median(col('transfer')), 'bytes'),
          `${c.label} · bytes transferred`,
        );
      }
      sec.notes.push(
        'Times are from navigation start. “ready” is the later of the button enabled and the socket open; “main-thread script” is Chromium’s ScriptDuration (CDP Performance metrics) until then, throttled time under 4× CPU. DevTools network emulation delays response bodies, not headers, hence “HTML received” (responseEnd) rather than TTFB. The browser has already drawn a board (the warm-up), and the cases take turns.',
      );
    },
  );
}

// 3. Game setup through the UI ----------------------------------------------

/** Creator clicks create, joiner opens the link and joins; both boards up. */
async function setupViaUI(browser, scope) {
  const ctxA = scope.ctx(await newBenchContext(browser, 'desktop'));
  const ctxB = scope.ctx(await newBenchContext(browser, 'desktop'));
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await pageA.goto(`${BASE}/`);
  await pageA.waitForFunction(
    () => window.__bench.firsts.createButton && window.__bench.wsOpen.length > 0,
    null,
    { polling: 50 },
  );
  // By role and the start of the name, as the e2e suite finds them
  // (e2e/helpers/game.ts): a button's accessible name can carry more than its
  // label (the home page's tiles end in a drawn "→"). It was named "Start a
  // game" before the home page had two ways to play, as a base commit may
  // still have it.
  await pageA.getByRole('button', { name: /^(Play a friend|Start a game)\b/ }).click();
  // The side choice (/new), where a pick asks the server for the game; a
  // build without one asks on "Play a friend" and goes straight to the game
  await pageA.waitForURL(/\/(new|game\/)/);
  const chose = new URL(pageA.url()).pathname === '/new';
  if (chose) await pageA.getByRole('button', { name: /^White\b/ }).click();
  await pageA.waitForFunction(() => window.__bench.firsts.shareScreen, null, { polling: 50 });
  await pageB.goto(pageA.url());
  await pageB.getByRole('button', { name: /^Join game\b/i }).click();
  await Promise.all([waitBoard(pageA), waitBoard(pageB)]);
  const [a, b] = await Promise.all([snap(pageA), snap(pageB)]);
  // The programs the joiner's board has linked: each one's shaders, briefly
  const programs = await pageB.evaluate(() => {
    const { gl } = window.__r3fState.get();
    const ctx = gl.getContext();
    return gl.info.programs.map((p) => {
      const src = ctx.getShaderSource(p.fragmentShader) ?? '';
      const body = src.slice(src.lastIndexOf('void main')).replace(/\s+/g, ' ');
      return [src.length, body.slice(0, 140)];
    });
  });
  const clickA = a.clicks.find((c) =>
    chose ? c[1].startsWith('White') : /^(Play a friend|Start a game)\b/.test(c[1]),
  )?.[0];
  const clickB = b.clicks.find((c) => /^Join game$/i.test(c[1]))?.[0];
  const rxOf = (s, type) => s.rx.find((r) => r[1] === type)?.[0];
  const frameB = firstFrameEnd(b);
  const t = {
    createRtt: rxOf(a, 'game_created') - clickA,
    createShown: a.firsts.shareScreen - clickA,
    // Where the creator's wait goes: what happened from the pick to the link
    createTrace: {
      created: rxOf(a, 'game_created') - clickA,
      stages: a.stage
        .filter(([s]) => s >= clickA - 1 && s <= a.firsts.shareScreen + 1)
        .map(([s, ...rest]) => [Math.round(s - clickA), ...rest]),
      longTasks: tasksIn(a.lt, clickA, a.firsts.shareScreen).map(([s, d]) => [
        Math.round(s - clickA),
        Math.round(d),
      ]),
      links: (a.linked ?? [])
        .filter(([l]) => l >= clickA && l <= a.firsts.shareScreen)
        .map(([l, what]) => [Math.round(l - clickA), what]),
      syncs: (a.syncs ?? [])
        .filter(([u]) => u >= clickA && u <= a.firsts.shareScreen)
        .map(([u, n, d]) => [Math.round(u - clickA), n, Math.round(d)]),
      frames: a.raf.filter((s) => s >= clickA && s <= a.firsts.shareScreen).length,
      longestFrame: maxOf(
        a.raf
          .filter((s) => s >= clickA && s <= a.firsts.shareScreen)
          .map((s, i, all) => (i ? s - all[i - 1] : 0)),
      ),
    },
    // Where the joiner's wait goes: what happened from the click to its first frame
    joinTrace: {
      stages: b.stage
        .filter(([t]) => t >= clickB - 1 && t <= frameB + 1)
        .map(([t, ...rest]) => [Math.round(t - clickB), ...rest]),
      longTasks: tasksIn(b.lt, clickB - 2000, frameB).map(([t, d]) => [
        Math.round(t - clickB),
        Math.round(d),
      ]),
      links: (b.linked ?? [])
        .filter(([l]) => l >= clickB - 2000 && l <= frameB)
        .map(([l, what, where]) => [Math.round(l - clickB), where, what.slice(0, 40)]),
      syncs: (b.syncs ?? [])
        .filter(([u]) => u >= clickB - 2000 && u <= frameB)
        .map(([u, n, d]) => [Math.round(u - clickB), n, Math.round(d)]),
      renders: b.renders
        .filter(([t]) => t >= clickB - 2000 && t <= frameB)
        .map(([t, d, m]) => [Math.round(t - clickB), Math.round(d), m]),
    },
    joinButton: b.firsts.joinButton - b.timeOrigin,
    joinStart: rxOf(b, 'game_start') - clickB,
    joinerFrame: frameB - clickB,
    creatorFrame: firstFrameEnd(a) - clickB,
    firstRenderCpu: b.renders[0][1],
    joinerLongest: maxOf(tasksIn(b.lt, clickB, frameB).map((l) => l[1])),
    joinerLongTotal: sum(tasksIn(b.lt, clickB, frameB).map((l) => l[1])),
    programs,
    joinerLinks: (b.links ?? []).filter((l) => l >= clickB && l <= frameB).length,
    firstRenderSyncs: (b.syncs ?? [])
      .filter(([t]) => t >= b.renders[0][0] && t <= b.renders[0][0] + b.renders[0][1])
      .map(([t, n, d]) => [Math.round(t - b.renders[0][0]), n, Math.round(d)]),
    firstRenderLinks: (b.links ?? []).filter(
      (l) => l >= b.renders[0][0] && l <= b.renders[0][0] + b.renders[0][1],
    ).length,
  };
  const seatA = await pageA.getByTestId('seat').getAttribute('data-seat');
  const seats = { [seatA]: pageA, [other(seatA)]: pageB };
  return { t, seats };
}

async function setupSection(browser, shared) {
  await section(
    'setup',
    {
      title: 'Game setup',
      intro: `Two players meet: the creator clicks “Play a friend”, picks White and gets the share link (“create: click” is the pick, which asks the server for the game); the joiner (a second fresh context) opens it and clicks “Join game”; done when both pages have the board mounted, its first frame drawn and the game’s entrance over. ${CFG.setupRuns} run(s), desktop viewport, both pages on the same VM. The first frame includes building the scene and its shader programs, which SwiftShader does on the CPU (the browser drew a board before this section, so the GPU process’s shader cache is warm, as for a returning player). ${SW_NOTE}`,
      columns: ['Step', 'median', 'p95', 'max', 'n', 'Notes'],
      align: ['l', 'r', 'r', 'r', 'r', 'l'],
      timeoutMs: QUICK ? 150000 : 300000,
    },
    async (sec) => {
      const runs = [];
      for (let i = 0; i < CFG.setupRuns; i++) {
        const last = i === CFG.setupRuns - 1;
        // The last run's game is kept for the move-latency section
        const runScope = last ? shared.scope : new Scope();
        try {
          const { t, seats } = await setupViaUI(browser, runScope);
          runs.push(t);
          if (last) shared.game = seats;
        } finally {
          if (!last) await runScope.close();
        }
      }
      raw.setup = runs;
      const col = (k) => runs.map((r) => r[k]);
      sec.addAll([
        stat('create: click → game_created received', col('createRtt'), 'server round trip'),
        stat('create: click → share link shown', col('createShown')),
        stat('join: navigation → Join button', col('joinButton'), 'cold page load'),
        stat('join: click → game_start received', col('joinStart')),
        stat('join: click → joiner’s first frame', col('joinerFrame'), 'board usable'),
        stat('join: click → creator’s first frame', col('creatorFrame')),
        stat(
          'joiner’s first render() call',
          col('firstRenderCpu'),
          'main thread, incl. shader setup',
        ),
        stat('joiner: longest task, click → frame', col('joinerLongest')),
        stat('joiner: long tasks total, click → frame', col('joinerLongTotal')),
        countStat(
          'joiner: shader programs linked, click → frame',
          col('joinerLinks'),
          'count; lobby’s and board’s',
        ),
        countStat(
          'joiner’s first render(): shader programs linked',
          col('firstRenderLinks'),
          'count',
        ),
      ]);
    },
  );
}

// 4. Move latency through the real UI ---------------------------------------

async function movesSection(browser, shared) {
  await section(
    'move-latency',
    {
      title: 'Move latency through the move box',
      intro: `${CFG.moves} plies of the bench’s long game (quiet moves, no capture or check), each typed into the move box (\`#typed-move\`) and sent with Enter on the page of the side to move, the next once both pages have drawn it. Timed on the pages’ clocks from the Enter keydown to the move-announcer’s \`data-move-count\` changing (React’s commit) on the mover’s page and on the opponent’s. Both players’ pages run on the same VM. ${SW_NOTE}`,
      columns: ['Measure', 'median', 'p95', 'max', 'n', 'Notes'],
      align: ['l', 'r', 'r', 'r', 'r', 'l'],
      timeoutMs: QUICK ? 150000 : 300000,
    },
    async (sec, scope) => {
      let seats = shared.game;
      if (!seats) {
        log('  (setup section gave no game; starting one)');
        seats = (await setupViaUI(browser, scope)).seats;
      }
      await Promise.all([settle(seats.white), settle(seats.black)]);
      const moves = [];
      for (let i = 0; i < CFG.moves; i++) {
        const side = i % 2 === 0 ? 'white' : 'black';
        const mover = seats[side];
        const opp = seats[other(side)];
        const text = gameMove(i);
        await mover.focus('#typed-move');
        await mover.keyboard.insertText(text);
        await mover.keyboard.press('Enter');
        await Promise.all([waitCount(mover, i + 1), waitCount(opp, i + 1)]);
        const commitOf = async (page) =>
          page.evaluate((n) => window.__bench.counts.find((c) => c[1] === n)[0], i + 1);
        await Promise.all(
          [mover, opp].map(async (page) => waitFrameAfter(page, await commitOf(page))),
        );
        const [m, o] = await Promise.all([snap(mover), snap(opp)]);
        const enter = m.enter.at(-1);
        const shownM = m.counts.find((c) => c[1] === i + 1);
        const shownO = o.counts.find((c) => c[1] === i + 1);
        if (shownM[2] !== text || shownO[2] !== text) {
          throw new Error(`ply ${i + 1}: expected ${text}, pages show ${shownM[2]} / ${shownO[2]}`);
        }
        const echo = m.rx.find((r) => r[0] >= enter && r[1] === 'move_made')?.[0];
        const oRx = o.rx.find((r) => r[0] >= enter && r[1] === 'move_made')?.[0];
        const frameM = m.renders.find((f) => f[0] >= shownM[0]);
        const frameO = o.renders.find((f) => f[0] >= shownO[0]);
        const drawnM = frameM[0] + frameM[1];
        const drawnO = frameO[0] + frameO[1];
        const tasksM = tasksIn(m.lt, enter, drawnM).map((l) => l[1]);
        const tasksO = tasksIn(o.lt, enter, drawnO).map((l) => l[1]);
        moves.push({
          ply: i + 1,
          wire: oRx - enter,
          echo: echo - enter,
          own: shownM[0] - enter,
          opp: shownO[0] - enter,
          oppRxToShown: shownO[0] - oRx,
          ownFrame: drawnM - enter,
          oppFrame: drawnO - enter,
          longestMover: maxOf([0, ...tasksM]),
          longMover: sum(tasksM),
          longestOpp: maxOf([0, ...tasksO]),
          longestRenderMover: maxOf(inWindow(m.renders, enter, drawnM).map((f) => f[1])),
          linksMover: (m.links ?? []).filter((l) => l >= enter && l <= drawnM).length,
          syncsMover: (m.syncs ?? [])
            .filter(([t]) => t >= enter && t <= drawnM)
            .map(([t, n, d]) => [Math.round(t - enter), n, Math.round(d)]),
          linksOpp: (o.links ?? []).filter((l) => l >= enter && l <= drawnO).length,
        });
      }
      raw.moves = moves;
      const col = (k) => moves.map((r) => r[k]);
      sec.addAll([
        stat('Enter → opponent’s page handles move_made', col('wire'), 'send, server, relay'),
        stat('Enter → mover’s page handles its echo', col('echo')),
        stat('Enter → mover’s announcer updated', col('own'), 'echo, replay, React commit'),
        stat('Enter → opponent’s announcer updated', col('opp')),
        stat(
          'opponent: move_made handled → announcer',
          col('oppRxToShown'),
          'client-side work only',
        ),
        stat('Enter → mover’s first frame with the move', col('ownFrame'), 'what the player sees'),
        stat('Enter → opponent’s first frame with the move', col('oppFrame')),
        stat('mover: longest task, Enter → drawn', col('longestMover')),
        stat('mover: long tasks total, Enter → drawn', col('longMover'), 'tasks ≥ 50 ms'),
        stat('opponent: longest task, Enter → drawn', col('longestOpp')),
        stat(
          'mover: longest render() call, Enter → drawn',
          col('longestRenderMover'),
          'steady frames take a few ms',
        ),
        countStat('mover: shader programs linked, Enter → drawn', col('linksMover'), 'count'),
        countStat('opponent: shader programs linked, Enter → drawn', col('linksOpp'), 'count'),
      ]);
      sec.notes.push(
        `A “page handles” time is when the message event is dispatched on that page’s main thread, so it includes any wait for the thread (a frame being drawn). After the first ply both pages keep drawing (the last-move line’s shimmer asks for every frame; see Rendering), so later plies compete with that. The next move is typed as soon as both pages have drawn this one. Correctness guard: both pages’ data-last-move matched the typed move every ply.`,
      );
    },
  );
}

// 4b. Selecting a piece -------------------------------------------------------

/**
 * The pixel on the canvas whose ray reaches the square `zxy` (its piece or
 * its click box) before anything else a click could go to, as the e2e
 * suite's clickSquare finds it (e2e/helpers/board.ts), or null.
 */
const squarePixel = (page, zxy) =>
  page.evaluate((target) => {
    const { camera, size, scene, raycaster } = window.__r3fState.get();
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    let cube = null;
    scene.traverse((o) => {
      if (o.userData.cube && o.userData.zxy === target) cube = o;
    });
    if (!cube) return null;
    const at = cube.position;
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const interactive = (hit) => {
      for (let o = hit; o; o = o.parent) {
        if (o.userData.piece) return o;
        if (o.userData.cube) return o.userData.highlight ? o : null;
      }
      return null;
    };
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    for (const dx of [0, 0.3, -0.3])
      for (const dy of [0.4, 0.2, 0])
        for (const dz of [0, 0.3, -0.3]) {
          const v = at.clone();
          v.x += dx;
          v.y += dy;
          v.z += dz;
          v.project(camera);
          raycaster.setFromCamera({ x: v.x, y: v.y }, camera);
          let first = null;
          for (const h of raycaster.intersectObjects(scene.children, true)) {
            first = interactive(h.object);
            if (first) break;
          }
          if (!first) continue;
          const p = first.position;
          if (!(near(p.x, at.x) && near(p.y, at.y) && near(p.z, at.z))) continue;
          const x = rect.left + (v.x * 0.5 + 0.5) * size.width;
          const y = rect.top + (-v.y * 0.5 + 0.5) * size.height;
          if (document.elementFromPoint(x, y) === canvas) return { x, y };
        }
    return null;
  }, zxy);

/**
 * The first frame begun after the canvas took a click made at or after `t`,
 * or null if the click drew nothing (it picked nothing up: counted as missed,
 * never timed). A click is a move, a press and a release: the move alone (a
 * hover lifting the piece) can ask for a frame that begins before the click
 * lands, and that frame does not hold the piece. Throws when the page saw no
 * click.
 */
function frameAfterClick(s, t) {
  const click = s.clicks.find((c) => c[0] >= t)?.[0];
  if (click == null) throw new Error('select: the page saw no click');
  return s.renders.find((r) => r[0] >= click) ?? null;
}

async function selectSection(browser) {
  await section(
    'select',
    {
      title: 'Selecting a piece',
      intro: `A new game from White’s seat (${VIEWPORTS.desktop.label}), at rest: White’s pieces are picked up one after another with a real click through the app’s raycasting (as the e2e suite clicks), each put down again by a click on empty space before the next is picked up. ${CFG.selects} picks. Timed on the page’s clock from the click to the end of the first frame drawn after it (the piece held, its destinations shown), with that frame’s render() call and the shader programs linked on the way. ${SW_NOTE}`,
      columns: ['Measure', 'median', 'p95', 'max', 'n', 'Notes'],
      align: ['l', 'r', 'r', 'r', 'r', 'l'],
      timeoutMs: QUICK ? 150000 : 300000,
    },
    async (sec, scope) => {
      const game = await seedGame(scope, 0);
      await game.seats.white.close();
      const { page } = await openSeat(browser, scope, 'desktop', game.gameId, 'white');
      await waitBoard(page);
      await settle(page);
      // The board's frames from its first to rest (the entrance, and the
      // frame that warms the marks' programs up): the longest one's render()
      const rest = await snap(page);
      const afterFirst = rest.renders.slice(1).map((r) => r[1]);
      const squares = ['Bb2', 'Bc2', 'Bd2', 'Ab1', 'Ad1', 'Ba2', 'Be2', 'Bb1'];
      const picks = [];
      for (let i = 0; i < CFG.selects; i++) {
        const zxy = squares[i % squares.length];
        const at = await squarePixel(page, zxy);
        if (!at) throw new Error(`no pixel reaches ${zxy}`);
        const t = await page.evaluate(() => window.__benchNow());
        await page.mouse.click(at.x, at.y);
        await waitFrameAfter(page, t);
        await quietMain(page);
        const s = await snap(page);
        const frame = frameAfterClick(s, t);
        const drawn = frame ? frame[0] + frame[1] : 0;
        picks.push(
          frame && {
            frame: drawn - t,
            render: frame[1],
            mode: frame[2],
            // A hover frame began between the press's start and the click
            hoverFirst: s.renders.find((r) => r[0] >= t) !== frame,
            links: s.links.filter((l) => l >= t && l <= drawn).length,
            syncs: (s.syncs ?? [])
              .filter(([u]) => u >= t && u <= drawn)
              .map(([u, n, d]) => [Math.round(u - t), n, Math.round(d)]),
            longest: maxOf([0, ...tasksIn(s.lt, t, drawn).map((l) => l[1])]),
          },
        );
        // Put it down: a click on empty space beside the tower
        const box = await page.locator('canvas').boundingBox();
        const t2 = await page.evaluate(() => window.__benchNow());
        await page.mouse.click(box.x + box.width * 0.04, box.y + box.height * 0.5);
        await waitFrameAfter(page, t2);
        await quietMain(page);
      }
      // After a turn of the view: the camera comes to rest, the page goes
      // quiet, then a piece is picked up (the first click after an orbit)
      const turned = [];
      for (let i = 0; i < CFG.selectsAfterTurn; i++) {
        await page.evaluate(ORBIT, { ms: 400, degPerSec: 40 });
        await quietMain(page);
        await page.waitForTimeout(500);
        const zxy = squares[i % squares.length];
        const at = await squarePixel(page, zxy);
        if (!at) throw new Error(`no pixel reaches ${zxy}`);
        const t = await page.evaluate(() => window.__benchNow());
        await page.mouse.click(at.x, at.y);
        await waitFrameAfter(page, t);
        await quietMain(page);
        const s = await snap(page);
        const frame = frameAfterClick(s, t);
        turned.push(frame && { frame: frame[0] + frame[1] - t, mode: frame[2] });
        const box = await page.locator('canvas').boundingBox();
        const t2 = await page.evaluate(() => window.__benchNow());
        await page.mouse.click(box.x + box.width * 0.04, box.y + box.height * 0.5);
        await waitFrameAfter(page, t2);
        await quietMain(page);
      }
      raw.selects = picks;
      raw.selectsAfterTurn = turned;
      // A click that drew nothing (null) picked nothing up: counted, not timed
      const missed = picks.filter((p) => !p).length + turned.filter((p) => !p).length;
      const timed = picks.filter(Boolean);
      const timedTurned = turned.filter(Boolean);
      const col = (k) => timed.map((r) => r[k]);
      raw.selectRest = afterFirst;
      raw.selectRestPrograms = await page.evaluate(() => {
        const { gl } = window.__r3fState.get();
        const ctx = gl.getContext();
        return gl.info.programs.map((p) => {
          const src = ctx.getShaderSource(p.fragmentShader) ?? '';
          return src.slice(src.lastIndexOf('void main')).replace(/\s+/g, ' ').slice(0, 110);
        });
      });
      // Each long frame to rest: when, how long, and the programs it linked
      raw.selectRestFrames = rest.renders
        .filter((r) => r[1] > 100)
        .map(([t, d]) => [
          Math.round(t - rest.renders[0][0]),
          Math.round(d),
          (rest.links ?? []).filter((l) => l >= t && l <= t + d).length,
          (rest.syncs ?? [])
            .filter(([u]) => u >= t && u <= t + d)
            .map(([, n, e]) => `${n} ${Math.round(e)}`)
            .slice(0, 6),
        ]);
      sec.addAll([
        stat(
          'before any click: longest render() after the first frame',
          [maxOf([0, ...afterFirst])],
          'the entrance and the warm-up, to rest',
        ),
        stat('click → first frame with the piece held', col('frame'), 'what the player sees'),
        stat('that frame’s render() call', col('render'), 'main thread'),
        stat('longest task, click → frame', col('longest')),
        countStat('shader programs linked, click → frame', col('links'), 'count'),
        countStat(
          'first frames that drew the garden in full',
          [timed.filter((p) => p.mode !== 'cached').length],
          `count of ${timed.length}; the rest from its copy`,
        ),
        countStat(
          'picks where a hover frame came before the click’s',
          [timed.filter((p) => p.hoverFirst).length],
          `count of ${timed.length}; never timed`,
        ),
        countStat(
          'clicks that picked nothing up (no frame drawn)',
          [missed],
          `count of ${picks.length + turned.length}; left out of the times`,
        ),
        stat(
          'after a turn of the view: click → first frame with the piece held',
          timedTurned.map((r) => r.frame),
          'the first click once the camera rests',
        ),
        countStat(
          'after a turn of the view: first frames that drew the garden in full',
          [timedTurned.filter((p) => p.mode !== 'cached').length],
          `count of ${timedTurned.length}`,
        ),
      ]);
    },
  );
}

// 5. Reopen into a long game ------------------------------------------------

async function reopenSection(browser) {
  const plies = CFG.reopenPlies;
  await section(
    'reopen',
    {
      title: 'Reopening a long game',
      intro: `A player reloads mid-game (adversarial for long games): a game with H plies already recorded (seeded over WebSockets) is opened in a fresh context with Black’s seat in localStorage, so the page rejoins and replays the whole record from the start. Then White (a socket) plays one more move. Cells are medians of ${CFG.reopenRuns} run(s) (a new game each; max and all runs in \`raw\`). ${SW_NOTE}`,
      columns: ['Metric', ...plies.map((h) => `H = ${h}`), 'Notes'],
      align: ['l', ...plies.map(() => 'r'), 'l'],
      timeoutMs: QUICK ? 180000 : 420000,
    },
    async (sec) => {
      raw.reopen = {};
      for (const H of plies) {
        const runs = [];
        for (let r = 0; r < CFG.reopenRuns; r++) {
          const scope = new Scope();
          try {
            const tSeed = nodeNow();
            const game = await seedGame(scope, H);
            const seedMs = nodeNow() - tSeed;
            await game.seats.black.close();
            const { page, cdp } = await openSeat(browser, scope, 'desktop', game.gameId, 'black');
            await waitCount(page, H, 120000);
            await waitBoard(page);
            // Past the first, costly frames (with a last move the canvas never rests)
            await quietMain(page);
            const s = await snap(page);
            const pm = await perfMetrics(cdp);
            await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
            const heap = await cdp.send('Runtime.getHeapUsage').catch(() => null);
            const shown = s.counts.find((c) => c[1] === H);
            const expected = H > 0 ? gameMove(H - 1) : null;
            const lastMove = await page
              .getByTestId('move-announcer')
              .getAttribute('data-last-move');
            if (Number(shown[1]) !== H || (lastMove ?? null) !== expected) {
              throw new Error(
                `H=${H}: shows ${shown[1]} plies, last ${lastMove}; expected ${expected}`,
              );
            }
            const frame = firstFrameEnd(s);
            const ready = Math.max(shown[0], frame);
            const lts = tasksIn(s.lt, s.timeOrigin, ready);
            // One more move from White: its arrival until the page shows it
            const [from, to] = gameMove(H).split('-');
            game.seats.white.send({ type: 'move', from, to });
            await waitCount(page, H + 1);
            const s2 = await snap(page);
            const rx = s2.rx.find((m) => m[1] === 'move_made' && m[0] >= ready)?.[0];
            const shown2 = s2.counts.find((c) => c[1] === H + 1)?.[0];
            const nextTasks = tasksIn(s2.lt, rx, shown2);
            runs.push({
              seedMs,
              stateRx: s.rx.find((m) => m[1] === 'game_state')?.[0] - s.timeOrigin,
              replay: shown[0] - s.rx.find((m) => m[1] === 'game_state')?.[0],
              recordShown: shown[0] - s.timeOrigin,
              firstFrame: frame - s.timeOrigin,
              ltTotal: sum(lts.map((l) => l[1])),
              longest: maxOf([0, ...lts.map((l) => l[1])]),
              script: pm.ScriptDuration * 1000,
              heapMiB: heap ? heap.usedSize / 1024 / 1024 : NaN,
              nodes: pm.Nodes,
              nextShown: shown2 - rx,
              nextLongest: maxOf([0, ...nextTasks.map((l) => l[1])]),
              lastMove,
            });
          } finally {
            await scope.close();
          }
        }
        raw.reopen[H] = runs;
      }
      const med = (H, k) => median(raw.reopen[H].map((r) => r[k]));
      const top = plies.at(-1);
      // The metric is the largest game's median, the adversarial case
      const row = (label, k, fmt, note = '', unit = 'ms') => [
        [label, ...plies.map((H) => fmt(med(H, k))), note],
        unit ? metric(med(top, k) * (unit === 'bytes' ? 1024 * 1024 : 1), unit) : null,
        `${label} · H = ${top}`,
      ];
      sec.addAll([
        row('navigation → game_state received', 'stateRx', fmtMs, 'page load + socket + rejoin'),
        row('navigation → record shown (announcer = H)', 'recordShown', fmtMs),
        row(
          'game_state handled → record shown',
          'replay',
          fmtMs,
          'replay + React render and commit',
        ),
        row('navigation → first frame drawn', 'firstFrame', fmtMs, 'incl. shader setup'),
        row(
          'long tasks total, to ready',
          'ltTotal',
          fmtMs,
          'ready = record shown and a frame drawn',
        ),
        row('longest task, to ready', 'longest', fmtMs),
        row('main-thread script, to loaded', 'script', fmtMs, 'CDP ScriptDuration'),
        row(
          'JS heap used, loaded',
          'heapMiB',
          (x) => (ok(x) ? `${prec(x)} MiB` : '—'),
          'after a forced GC',
          'bytes',
        ),
        row(
          'DOM nodes, loaded',
          'nodes',
          fmtInt,
          'the hidden move list has a row per two plies',
          null,
        ),
        row(
          'next move: received → shown',
          'nextShown',
          fmtMs,
          'White’s move H+1 on the reopened page',
        ),
        row('next move: longest task', 'nextLongest', fmtMs),
        row(
          'seeding the game over WebSockets',
          'seedMs',
          fmtMs,
          'one round trip per ply (not the page)',
        ),
      ]);
      sec.notes.push(
        `Correctness guard: every run showed data-move-count = H and data-last-move = the long game’s H-th move, then H+1 after White’s move.`,
      );
    },
  );
}

// 6. Presence flapping ------------------------------------------------------

async function presenceSection(browser) {
  await section(
    'presence',
    {
      title: 'Opponent presence flapping',
      intro:
        'An opponent on a flaky phone (adversarial): with Black’s page seated and the board up, White’s connection drops and rejoins (`rejoin_game`) F times in a row, each as soon as the server has answered, so the page is told “offline” then “online” 2F times. Each presence message is appended to the page’s message log and re-renders the game screen. Measured from the first drop until the page has caught up (no message for 200 ms, the opponent shown online); then White plays a move and the page is timed until it shows it.',
      columns: [
        'Flaps F',
        'presence msgs received',
        'long tasks total',
        'longest task',
        'frames drawn',
        'main thread busy',
        'marker move lag',
        'Notes',
      ],
      align: ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
      timeoutMs: QUICK ? 150000 : 300000,
    },
    async (sec) => {
      raw.presence = [];
      for (const F of CFG.flaps) {
        const scope = new Scope();
        try {
          const game = await seedGame(scope, 0);
          await game.seats.black.close();
          const { page, cdp } = await openSeat(browser, scope, 'desktop', game.gameId, 'black');
          await waitBoard(page);
          await page.waitForFunction(() => window.__bench.online.at(-1)?.[1] === 'true', null, {
            polling: 50,
          });
          await settle(page);
          const before = await perfMetrics(cdp);
          const tStart = nodeNow();
          let white = game.seats.white;
          for (let k = 0; k < F; k++) {
            await white.close();
            white = scope.sock(await Sock.open(WS_URL));
            white.send({
              type: 'rejoin_game',
              gameId: game.gameId,
              color: 'white',
              clientId: game.clientIds.white,
              takeover: true,
            });
            await white.waitType('game_state');
          }
          const tFlapped = nodeNow();
          // Until the page has caught up: no message for 200 ms, the opponent shown online
          await page.waitForFunction(
            () =>
              window.__benchNow() - (window.__bench.rx.at(-1)?.[0] ?? 0) >= 200 &&
              window.__bench.online.at(-1)?.[1] === 'true',
            null,
            { polling: 50, timeout: 120000 },
          );
          const after = await perfMetrics(cdp);
          const caughtUp = await page.evaluate(() => window.__benchNow());
          // Then a move: how long the page takes to show it
          white.send({ type: 'move', from: 'Ab1', to: 'Aa3' });
          const tSend = nodeNow();
          await waitCount(page, 1, 120000);
          const s = await snap(page);
          const shown = s.counts.find((c) => c[1] === 1)[0];
          const lts = tasksIn(s.lt, tStart, caughtUp);
          const finalOnline = s.online.at(-1)?.[1];
          if (finalOnline !== 'true')
            throw new Error(`F=${F}: page ends showing online=${finalOnline}`);
          const r = {
            F,
            flapMs: tFlapped - tStart,
            presenceRx: s.rx.filter((m) => m[1] === 'presence' && m[0] >= tStart).length,
            onlineChanges: s.online.filter((o) => o[0] >= tStart).length,
            ltTotal: sum(lts.map((l) => l[1])),
            longest: maxOf([0, ...lts.map((l) => l[1])]),
            frames: inWindow(s.renders, tStart, caughtUp).length,
            busy: (after.TaskDuration - before.TaskDuration) * 1000,
            script: (after.ScriptDuration - before.ScriptDuration) * 1000,
            lag: shown - tSend,
            finalOnline,
          };
          raw.presence.push(r);
          sec.add(
            [
              String(F),
              String(r.presenceRx),
              fmtMs(r.ltTotal),
              fmtMs(r.longest),
              String(r.frames),
              fmtMs(r.busy),
              fmtMs(r.lag),
              F === 0
                ? 'control: the move alone'
                : `the ${F} drops and rejoins took ${fmtMs(r.flapMs)}; ${r.onlineChanges} presence changes committed`,
            ],
            metric(r.busy),
            `F = ${F} · main thread busy`,
          );
        } finally {
          await scope.close();
        }
      }
      sec.notes.push(
        '“main thread busy” is the change in CDP TaskDuration from just before the first drop until the page had caught up (including the 200 ms of quiet); long tasks and “frames drawn” (renderer.render() calls) cover the same span; “marker move lag” is from sending the move to the page committing it. The board was at rest before the first drop, and the page ended showing the opponent online every time (guard).',
      );
    },
  );
}

// 7. Rendering ---------------------------------------------------------------

/** Turns the camera about the tower for `ms`, one step per animation frame. */
const ORBIT = async ({ ms, degPerSec }) => {
  const st = window.__r3fState.get();
  const { camera, controls } = st;
  const target = controls.target.clone();
  const d = camera.position.clone().sub(target);
  const r = d.length();
  const yaw0 = Math.atan2(d.x, d.z);
  const pitch = Math.asin(d.y / r);
  const start = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const t = performance.now() - start;
      const yaw = yaw0 + ((degPerSec * Math.PI) / 180) * (t / 1000);
      camera.position.set(
        target.x + r * Math.cos(pitch) * Math.sin(yaw),
        target.y + r * Math.sin(pitch),
        target.z + r * Math.cos(pitch) * Math.cos(yaw),
      );
      camera.lookAt(target);
      controls.update();
      st.invalidate();
      if (t >= ms) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return { from: performance.timeOrigin + start, to: performance.timeOrigin + performance.now() };
};

/** A page pixel whose ray reaches the piece on `zxy` before anything else clickable. */
const PIECE_PIXEL = (zxy) => {
  const st = window.__r3fState?.get();
  if (!st) return null;
  const { camera, size, scene, raycaster } = st;
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  let cube = null;
  scene.traverse((o) => {
    if (o.userData?.cube && o.userData.zxy === zxy) cube = o;
  });
  if (!cube) return null;
  const c = cube.position;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const at = (o) => near(o.position.x, c.x) && near(o.position.y, c.y) && near(o.position.z, c.z);
  let piece = null;
  scene.traverse((o) => {
    if (!piece && o.userData?.piece && at(o)) piece = o;
  });
  if (!piece) return null;
  const interactive = (hit) => {
    for (let o = hit; o; o = o.parent) {
      if (o.userData.piece) return o;
      if (o.userData.cube) return o.userData.highlight ? o : null;
    }
    return null;
  };
  const g = cube.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const bounds = g.boundingBox.clone().setFromObject(piece);
  const V = c.constructor;
  const mid = bounds.getCenter(new V());
  const ext = bounds.getSize(new V());
  const canvas = document.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  const steps = [0, 0.2, -0.2, 0.4, -0.4];
  for (const oy of steps) {
    for (const ox of steps) {
      for (const oz of steps) {
        const p = new V(mid.x + ox * ext.x, mid.y + (oy + 0.1) * ext.y, mid.z + oz * ext.z);
        p.project(camera);
        const x = Math.round(rect.left + (p.x * 0.5 + 0.5) * size.width);
        const y = Math.round(rect.top + (-p.y * 0.5 + 0.5) * size.height);
        const ndc = {
          x: ((x - rect.left) / size.width) * 2 - 1,
          y: -((y - rect.top) / size.height) * 2 + 1,
        };
        raycaster.setFromCamera(ndc, camera);
        let first = null;
        for (const h of raycaster.intersectObjects(scene.children, true)) {
          first = interactive(h.object);
          if (first) break;
        }
        if (first?.userData.piece && at(first) && document.elementFromPoint(x, y) === canvas) {
          return { x, y };
        }
      }
    }
  }
  return null;
};

const HIGHLIGHTS = () => {
  let n = 0;
  window.__r3fState.get().scene.traverse((o) => {
    if (o.userData?.cube && o.userData.highlight) n++;
  });
  return n;
};

function frameStats(renders, from, to) {
  const frames = inWindow(renders, from, to);
  const starts = frames.map((f) => f[0]);
  const intervals = starts.slice(1).map((t, i) => t - starts[i]);
  return {
    frames: frames.length,
    fps: frames.length / ((to - from) / 1000),
    intervalMedian: median(intervals),
    intervalP95: quantile(intervals, 0.95),
    intervalMax: maxOf(intervals),
    cpuMedian: median(frames.map((f) => f[1])),
    cpuP95: quantile(
      frames.map((f) => f[1]),
      0.95,
    ),
  };
}

/**
 * CPU time (ms) used so far by this script's Chromium: all its processes, and
 * its GPU process alone (where SwiftShader draws). From /proc, so Linux only;
 * NaN elsewhere. Only descendants of this process count, so another
 * Chromium on the machine never does.
 */
function browserCpu() {
  try {
    const procs = new Map();
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
        const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        procs.set(Number(d), { ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]) });
      } catch {
        // Gone meanwhile
      }
    }
    const mine = new Set([process.pid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const [pid, p] of procs) {
        if (!mine.has(pid) && mine.has(p.ppid)) {
          mine.add(pid);
          grew = true;
        }
      }
    }
    let all = 0;
    let gpu = 0;
    for (const pid of mine) {
      if (pid === process.pid) continue;
      let cmd = '';
      try {
        cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      } catch {
        continue;
      }
      if (!/chrom/i.test(cmd)) continue;
      const ms = (procs.get(pid).ticks * 1000) / CLK_TCK;
      all += ms;
      if (cmd.includes('--type=gpu-process')) gpu += ms;
    }
    return { all, gpu };
  } catch {
    return { all: NaN, gpu: NaN };
  }
}

/** Leaves the page alone for `ms` and measures what it does meanwhile. */
async function idleWindow(page, cdp, ms) {
  const m0 = await perfMetrics(cdp);
  const c0 = browserCpu();
  const t0 = await page.evaluate(() => window.__benchNow());
  await sleep(ms);
  const t1 = await page.evaluate(() => window.__benchNow());
  const c1 = browserCpu();
  const m1 = await perfMetrics(cdp);
  const s = await snap(page);
  const secs = (t1 - t0) / 1000;
  return {
    ...frameStats(s.renders, t0, t1),
    mainBusyPerSec: ((m1.TaskDuration - m0.TaskDuration) * 1000) / secs,
    cpuPct: ((c1.all - c0.all) / (t1 - t0)) * 100,
    gpuPct: ((c1.gpu - c0.gpu) / (t1 - t0)) * 100,
  };
}

/** Turns the view for CFG.orbitMs and measures the frames drawn meanwhile. */
async function orbitWindow(page) {
  const c0 = browserCpu();
  // A full turn: the camera ends where it started
  const w = await page.evaluate(ORBIT, { ms: CFG.orbitMs, degPerSec: 360000 / CFG.orbitMs });
  const c1 = browserCpu();
  const s = await snap(page);
  return {
    ...frameStats(s.renders, w.from, w.to),
    longTasks: sum(tasksIn(s.lt, w.from, w.to).map((l) => l[1])),
    cpuPct: ((c1.all - c0.all) / (w.to - w.from)) * 100,
    gpuPct: ((c1.gpu - c0.gpu) / (w.to - w.from)) * 100,
  };
}

async function renderSection(browser) {
  const phone = !QUICK;
  await section(
    'render',
    {
      title: 'Rendering (SwiftShader, relative only)',
      intro: `The board at rest and while the view turns, from White’s seat, ${VIEWPORTS.desktop.label}${phone ? ` (orbits also on the ${VIEWPORTS.phone.label})` : ''}. Idle: ${CFG.idleMs / 1000} s untouched, in a new game (no move yet), with White’s knight on Ab1 selected, and in a game with a last move on the board (reopened, so no move is animating)${QUICK ? '' : ', also under prefers-reduced-motion'}. The canvas renders on demand, so an idle board should draw nothing. Orbit: the camera turns once round the tower in ${CFG.orbitMs / 1000} s, one step per animation frame, as a drag would, without and with the knight selected. ${SW_NOTE} The app caps the canvas at 2× device pixels (and a 4.5 MP budget), so the 3× phone draws at 2×.`,
      columns: [
        'Case',
        'frames',
        'frames/s',
        'interval median',
        'interval p95',
        'render() median',
        'Chromium CPU',
        'Notes',
      ],
      align: ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
      timeoutMs: QUICK ? 120000 : 180000,
    },
    async (sec) => {
      raw.render = {};
      const pct = (x) => (ok(x) ? `${Math.round(x)}%` : '—');
      const cells = (label, f, note) => [
        label,
        String(f.frames),
        fmtNum(f.fps),
        fmtMs(f.intervalMedian),
        fmtMs(f.intervalP95),
        fmtMs(f.cpuMedian),
        pct(f.cpuPct),
        note,
      ];
      // An idle board's metric is the frames it draws a second (fewer is better)
      const idleRow = (label, f, note) => [
        cells(
          label,
          f,
          `${note}main thread busy ${fmtMs(f.mainBusyPerSec)}/s; GPU process ${pct(f.gpuPct)}`,
        ),
        metric(f.fps, 'per_s'),
      ];
      const orbitRow = (label, f, note) => [
        cells(label, f, `${note}long tasks ${fmtMs(f.longTasks)}`),
        metric(f.fps, 'fps', 'higher'),
      ];
      /** A page seated as White in a fresh game with `plies` recorded, its board drawn. */
      const openBoard = async (scope, vp, plies, extra) => {
        const game = await seedGame(scope, plies);
        await game.seats.white.close();
        const ctx = scope.ctx(
          await newBenchContext(browser, vp, { gameId: game.gameId, color: 'white' }, extra),
        );
        const page = await ctx.newPage();
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Performance.enable');
        await page.goto(`${BASE}/game/${game.gameId}`, { waitUntil: 'commit' });
        await waitBoard(page);
        const canvas = await page.evaluate(() => {
          const c = document.querySelector('canvas');
          return `${c.width}×${c.height}`;
        });
        return { page, cdp, canvas };
      };
      /** Selects White's knight on Ab1 with a click; resolves once two frames show it. */
      const selectKnight = async (page) => {
        const px = await page.evaluate(PIECE_PIXEL, 'Ab1');
        if (!px) throw new Error('no pixel reaches the knight on Ab1');
        await page.mouse.click(px.x, px.y);
        await page.waitForFunction(HIGHLIGHTS, null, { polling: 50, timeout: 30000 });
        const t = await page.evaluate(() => window.__benchNow());
        await page.waitForFunction(
          (from) => window.__bench.renders.filter((r) => r[0] >= from).length >= 2,
          t,
          { polling: 50, timeout: 30000 },
        );
        return page.evaluate(HIGHLIGHTS);
      };

      // A new game: at rest, turning, a piece selected
      for (const vp of phone ? ['desktop', 'phone'] : ['desktop']) {
        const scope = new Scope();
        try {
          const { page, cdp, canvas } = await openBoard(scope, vp, 0);
          const r = { canvas };
          r.rested = await settle(page, { quietMs: 500, timeout: 20000 });
          if (vp === 'desktop') r.idle = await idleWindow(page, cdp, CFG.idleMs);
          r.orbit = await orbitWindow(page);
          r.destinations = await selectKnight(page);
          if (vp === 'desktop') r.idleSelected = await idleWindow(page, cdp, CFG.idleMs);
          r.orbitSelected = await orbitWindow(page);
          raw.render[vp] = r;
          if (r.idle) sec.add(...idleRow(`${vp}: idle, new game`, r.idle, ''));
          sec.add(...orbitRow(`${vp}: orbit`, r.orbit, `canvas ${canvas} device px; `));
          if (r.idleSelected) {
            sec.add(
              ...idleRow(
                `${vp}: idle, knight selected`,
                r.idleSelected,
                `${r.destinations} destinations marked; `,
              ),
            );
          }
          sec.add(...orbitRow(`${vp}: orbit, knight selected`, r.orbitSelected, ''));
        } finally {
          await scope.close();
        }
      }

      // A game with a last move: its line's shimmer, and the same for a
      // player who asks for less motion
      const lastMoveCases = [['lastMove', 'desktop: idle, a last move on the board', {}]];
      if (!QUICK) {
        lastMoveCases.push([
          'reducedMotion',
          'desktop, reduced motion: idle, a last move on the board',
          { reducedMotion: 'reduce' },
        ]);
      }
      for (const [key, label, extra] of lastMoveCases) {
        const scope = new Scope();
        try {
          const { page, cdp } = await openBoard(scope, 'desktop', 2, extra);
          // Past the first frames (with the shimmer the canvas never rests)
          await quietMain(page);
          // Without the shimmer, the canvas comes to rest
          if (extra.reducedMotion) await settle(page, { quietMs: 500, timeout: 10000 });
          const idle = await idleWindow(page, cdp, CFG.idleMs);
          raw.render[key] = { idle };
          sec.add(
            ...idleRow(
              label,
              idle,
              extra.reducedMotion
                ? 'prefers-reduced-motion: reduce; '
                : `Black’s ${gameMove(1)} last; `,
            ),
          );
        } finally {
          await scope.close();
        }
      }
      sec.notes.push(
        '“interval” is the time between successive renderer.render() calls (the frame period the player sees); “render()” the main-thread time inside one call (three.js building and submitting draw calls). “Chromium CPU” is the CPU time of all of this script’s Chromium processes per wall second (100% = one core; only this page is open), read from /proc; the GPU process share is where SwiftShader rasterises. Metric: frames/s (fewer is better when idle, more when turning).',
      );
    },
  );
}

// 8. Typed-move validation on a pasted long string --------------------------

async function typedSection(browser, warm) {
  await section(
    'typed-paste',
    {
      title: 'Move box: validating a long pasted string',
      intro:
        'Adversarial input to the move box: a paste of `Ab1Aa3` + N spaces + `!` submitted with Enter on White’s turn. `parseTypedMove`’s pattern has three adjacent `\\s*` runs at its end, so a long run of trailing whitespace that fails to match makes the regex backtrack over every split of it before the error shows, all on the main thread (the page cannot draw or take input meanwhile). Timed from the Enter keydown to the error text being committed; not a GPU cost, so the numbers hold on real devices of similar CPU speed.',
      columns: ['Input', 'Enter → error shown', 'longest task', 'Notes'],
      align: ['l', 'r', 'r', 'l'],
      timeoutMs: QUICK ? 120000 : 240000,
    },
    async (sec, scope) => {
      // The warm-up's board (a new game, White to move, at rest) when there is one
      let page = warm;
      if (!page) {
        const game = await seedGame(scope, 0);
        await game.seats.white.close();
        ({ page } = await openSeat(browser, scope, 'desktop', game.gameId, 'white'));
        await waitBoard(page);
        await settle(page);
      }
      const cases = [
        { label: 'control: `Ab1-Ab3` (a legal-looking but illegal move)', text: 'Ab1-Ab3' },
        { label: 'control: `Ab1Aa3 !` (short, no match)', text: 'Ab1Aa3 !' },
        ...CFG.typedLengths.map((n) => ({
          label: `\`Ab1Aa3\` + ${n.toLocaleString('en-US')} spaces + \`!\``,
          text: `Ab1Aa3${' '.repeat(n)}!`,
          n,
        })),
      ];
      raw.typed = [];
      for (const c of cases) {
        // Paste it (as React sees a paste: the value set, one input event)
        await page.evaluate((text) => {
          const input = document.getElementById('typed-move');
          input.focus();
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(input, text);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, c.text);
        await page.waitForFunction(
          () => !document.getElementById('typed-move-problem').textContent,
        );
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          () => !!document.getElementById('typed-move-problem').textContent,
          null,
          { polling: 50, timeout: 120000 },
        );
        const s = await snap(page);
        const enter = s.enter.at(-1);
        const shown = s.problems.find((p) => p[0] >= enter && p[1])?.[0];
        const problem = s.problems.find((p) => p[0] >= enter && p[1])?.[1];
        const longest = maxOf([0, ...tasksIn(s.lt, enter, shown).map((l) => l[1])]);
        raw.typed.push({ label: c.label, n: c.n ?? null, ms: shown - enter, longest, problem });
        sec.add(
          [c.label, fmtMs(shown - enter), fmtMs(longest), `“${problem}”`],
          metric(shown - enter),
        );
        // Clear the box for the next case
        await page.evaluate(() => {
          const input = document.getElementById('typed-move');
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }
      const big = raw.typed.filter((t) => t.n);
      if (big.length >= 2) {
        const [a, b] = [big.at(-2), big.at(-1)];
        sec.notes.push(
          `From ${a.n.toLocaleString('en-US')} to ${b.n.toLocaleString('en-US')} spaces (×${prec(b.n / a.n)}) the time grew ×${prec(b.ms / a.ms)}; quadratic growth would be ×${prec((b.n / a.n) ** 2)}.`,
        );
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Findings: each backed by a number measured above

function findings() {
  const f = [];
  const tryAdd = (fn) => {
    try {
      const s = fn();
      if (s) f.push(s);
    } catch {
      // A section that failed or was skipped has nothing to say
    }
  };
  const pct = (x) => `${Math.round(x)}%`;
  tryAdd(() => {
    const js = raw.bundle.filter((r) => r.group === 'JS');
    if (js.length !== 1) return null;
    return `The build ships one JS chunk of ${fmtBytes(js[0].raw)} (${fmtBytes(js[0].gzip)} gzip, ${fmtBytes(js[0].brotli)} brotli)${js[0].three ? ', three.js included' : ''}; the start screen, which draws no 3D, downloads and runs all of it before its button works.`;
  });
  tryAdd(() => {
    const d = raw.cold.desktop;
    const t = raw.cold['phone-cpu4-4g'];
    const label = '4× CPU on Fast 4G';
    return `Cold start screen: the create button is enabled ${fmtMs(median(d.map((r) => r.button)))} after navigation on desktop (median; ${fmtMs(median(d.map((r) => r.script)))} of main-thread script, longest task ${fmtMs(median(d.map((r) => r.longest)))}) and ${fmtMs(median(t.map((r) => r.button)))} for a phone at ${label} (longest task ${fmtMs(median(t.map((r) => r.longest)))}); the socket opens ${fmtMs(median(t.map((r) => r.socket)))} in.`;
  });
  tryAdd(() => {
    const s = raw.setup;
    return `Joining a game takes ${fmtMs(median(s.map((r) => r.joinerFrame)))} (median) from the Join click to the joiner’s first frame, of which the server’s answer is ${fmtMs(median(s.map((r) => r.joinStart)))}; the first render() call alone holds the main thread for ${fmtMs(median(s.map((r) => r.firstRenderCpu)))} under SwiftShader.`;
  });
  tryAdd(() => {
    const m = raw.moves;
    return `A typed move reaches the opponent’s announcer ${fmtMs(median(m.map((r) => r.opp)))} after Enter (median over ${m.length} plies; the mover’s own ${fmtMs(median(m.map((r) => r.own)))}, as it waits for the server’s echo), of which the send, server and relay take ${fmtMs(median(m.map((r) => r.wire)))}. It is drawn ${fmtMs(median(m.map((r) => r.oppFrame)))} after Enter on the opponent’s page: the first frame after each move holds the main thread in a single render() call (${fmtMs(median(m.map((r) => r.longestRenderMover)))} median on the mover’s page under SwiftShader), where steady frames take a few ms.`;
  });
  tryAdd(() => {
    const hs = Object.keys(raw.reopen)
      .map(Number)
      .sort((a, b) => a - b);
    const lo = hs[0];
    const hi = hs.at(-1);
    const med = (H, k) => median(raw.reopen[H].map((r) => r[k]));
    return `Every move re-derives the game from the opening: on a reopened ${hi}-ply game an incoming move takes ${fmtMs(med(hi, 'nextShown'))} from arrival to display (longest task ${fmtMs(med(hi, 'nextLongest'))}) vs ${fmtMs(med(lo, 'nextShown'))} at ${lo} plies, and the reopen itself spends ${fmtMs(med(hi, 'replay'))} from game_state to the record shown vs ${fmtMs(med(lo, 'replay'))}.`;
  });
  tryAdd(() => {
    const p = raw.presence;
    const base = p.find((r) => r.F === 0);
    const top = p.filter((r) => r.F > 0).at(-1);
    const control = base
      ? ` (control, no flaps: ${fmtMs(base.busy)} over the 200 ms wait, ${base.frames} frames, the move shown after ${fmtMs(base.lag)})`
      : '';
    return `${top.F} opponent disconnect/rejoin flaps (${top.presenceRx} presence messages in ${fmtMs(top.flapMs)}) cost the page ${fmtMs(top.busy)} of main-thread time and ${top.frames} frames until it caught up; a move sent after them was shown ${fmtMs(top.lag)} later${control}.`;
  });
  tryAdd(() => {
    const r = raw.render.desktop;
    const lm = raw.render.lastMove.idle;
    const rm = raw.render.reducedMotion?.idle;
    return `On-demand rendering holds only until the first move: an untouched new game drew ${r.idle.frames} frames in ${CFG.idleMs / 1000} s (Chromium ${pct(r.idle.cpuPct)} CPU), but with a last move on the board its line’s shimmer asks for a frame every frame, so the untouched page drew ${fmtNum(lm.fps)} frames/s, as many as SwiftShader could, with Chromium at ${pct(lm.cpuPct)} CPU (100% = one core), for as long as nobody moves${rm ? `; under prefers-reduced-motion it drew ${rm.frames}` : ''}. A selected piece keeps the canvas drawing too (${fmtNum(r.idleSelected.fps)} frames/s).`;
  });
  tryAdd(() => {
    const vps = ['desktop', 'phone'].filter((v) => raw.render[v]);
    return `Turning the view, SwiftShader drew ${vps.map((v) => `${fmtNum(raw.render[v].orbit.fps)} frames/s on ${v} (${raw.render[v].canvas} px)`).join(' and ')}, with render() itself ${vps.map((v) => fmtMs(raw.render[v].orbit.cpuMedian)).join(' / ')} of main thread per frame: the frame rate is bound by rasterising, not by the scene’s JavaScript.`;
  });
  tryAdd(() => {
    const t = raw.typed.filter((x) => x.n);
    const [a, big] = [t.at(-2), t.at(-1)];
    const ctl = raw.typed.find((x) => !x.n && x.label.includes('short'));
    return `Pasting \`Ab1Aa3\` + ${big.n.toLocaleString('en-US')} spaces + \`!\` into the move box and pressing Enter blocks the main thread for ${fmtMs(big.longest)} before the error shows, vs ${fmtMs(ctl.ms)} for a short invalid string: \`parseTypedMove\`’s pattern backtracks over trailing whitespace, and the cost grows about quadratically with its length (${a.n.toLocaleString('en-US')} → ${big.n.toLocaleString('en-US')} spaces: ${fmtMs(a.ms)} → ${fmtMs(big.ms)}, ×${prec(big.ms / a.ms)} for ×${prec(big.n / a.n)} the length).`;
  });
  if (offHost.length) {
    f.push(
      `Guard: pages requested hosts other than 127.0.0.1: ${[...new Set(offHost)].slice(0, 5).join(', ')}.`,
    );
  }
  return f;
}

// ---------------------------------------------------------------------------
// Main

let browser = null;
let tmp = null;
let cleaning = null;
let aborted = false;

/** Stops the browser and servers and drops the build; every caller shares one run of it. */
const cleanup = () =>
  (cleaning ??= (async () => {
    if (browser) await browser.close().catch(() => {});
    await Promise.all([...children].map((c) => stopProcess(c)));
    if (tmp && !KEEP) fs.rmSync(tmp, { recursive: true, force: true });
  })());

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    log(`${sig}: tearing down`);
    aborted = true;
    cleanup().finally(() => process.exit(130));
  });
}
process.on('exit', () => {
  // Last resort if cleanup never finished: stop the process groups, drop the build
  for (const c of children) signalGroup(c, 'SIGKILL');
  if (tmp && !KEEP) fs.rmSync(tmp, { recursive: true, force: true });
});

async function main() {
  const started = Date.now();
  const timed = async (name, fn) => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      TIMINGS[name] = (Date.now() - t) / 1000;
    }
  };
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-browser-'));
  const dist = path.join(tmp, 'dist');
  const wsPort = await freePort();
  const webPort = await freePort();
  const deadPort = await freePort();
  WS_URL = `ws://127.0.0.1:${wsPort}/ws`;
  BASE = `http://127.0.0.1:${webPort}`;

  // The backend starts while the client builds
  const backendLog = path.join(tmp, 'backend.log');
  const python = path.join(SERVER, '.venv/bin/python');
  const uvicornArgs = [
    'modal_app:create_web_app',
    '--factory',
    '--host',
    '127.0.0.1',
    '--port',
    String(wsPort),
  ];
  const backend = fs.existsSync(python)
    ? startProcess(python, ['-m', 'uvicorn', ...uvicornArgs], { cwd: SERVER, logFile: backendLog })
    : startProcess(
        'uv',
        ['run', '--project', SERVER, '--extra', 'test', 'uvicorn', ...uvicornArgs],
        {
          cwd: SERVER,
          logFile: backendLog,
        },
      );

  // Build, pointed at that backend: VITE_WS_URL is inlined at build time
  log(`building the client for ${WS_URL}…`);
  await timed('build', () =>
    runToEnd(
      process.execPath,
      [VITE, 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'warn'],
      { cwd: CLIENT, env: { VITE_WS_URL: WS_URL }, logFile: path.join(tmp, 'build.log') },
      240000,
    ),
  );
  log(`  built in ${TIMINGS.build.toFixed(1)} s`);
  const js = [];
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name)) js.push(fs.readFileSync(p, 'utf8'));
    });
  walk(dist);
  if (!js.some((s) => s.includes(WS_URL))) {
    throw new Error(
      `the build does not contain ${WS_URL}: VITE_WS_URL was not inlined; refusing to run`,
    );
  }
  if (js.some((s) => /modal\.run/.test(s))) {
    throw new Error('the build still contains the production (modal.run) URL; refusing to run');
  }
  // Compressed off the main thread while everything starts; awaited before any timing
  const bundle = wants('bundle') ? measureBundle(dist) : null;
  bundle?.catch(() => {});

  await timed('startup', async () => {
    await waitHttp(`http://127.0.0.1:${wsPort}/health`, backend, backendLog, 60000);
    const previewLog = path.join(tmp, 'preview.log');
    const preview = startProcess(
      process.execPath,
      [
        VITE,
        'preview',
        '--outDir',
        dist,
        '--port',
        String(webPort),
        '--strictPort',
        '--host',
        '127.0.0.1',
      ],
      { cwd: CLIENT, logFile: previewLog },
    );
    await waitHttp(`${BASE}/`, preview, previewLog, 60000);
    browser = await chromium.launch({
      executablePath: EXECUTABLE,
      args: CHROMIUM_ARGS,
      timeout: 60000,
      // Everything but this machine goes to a closed port, so the browser's
      // own background traffic fails at once instead of reaching the network
      proxy: { server: `http://127.0.0.1:${deadPort}`, bypass: '127.0.0.1,localhost' },
      // Our own handlers tear everything down (Playwright's would exit first)
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  });
  const pwVersion = JSON.parse(
    fs.readFileSync(path.join(CLIENT, 'node_modules/@playwright/test/package.json'), 'utf8'),
  ).version;
  const renderer = await (async () => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      return await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      });
    } finally {
      await ctx.close();
    }
  })();
  report.meta = {
    Chromium: browser.version(),
    Playwright: pwVersion,
    Renderer: /swiftshader/i.test(renderer)
      ? 'SwiftShader (software WebGL)'
      : `${renderer} (expected SwiftShader)`,
    Mode: `${QUICK ? 'quick' : 'full'}${ONLY ? ` (only ${ONLY.join(', ')})` : ''}`,
    Viewports: `${VIEWPORTS.desktop.label}; ${VIEWPORTS.phone.label}`,
    Machine: `${os.cpus().length} × ${os.cpus()[0]?.model?.trim() ?? 'CPU'}, Node ${process.version}`,
    Serving: `vite build (production) served by vite preview; backend uvicorn on localhost (in-memory store); build took ${fmtMs(TIMINGS.build * 1000)}`,
  };
  raw.rendererString = renderer;

  const board = SECTION_KEYS.slice(1).some(wants);
  if (bundle && !board) await bundleSection(bundle);
  if (board) {
    // One board drawn first, so the GPU process's shader cache is as warm for
    // the first measured board as for the rest. The typed-paste section then
    // uses it (a new game, White to move, at rest) rather than load another.
    const warmScope = new Scope();
    try {
      const warm = await timed('warm-up', async () => {
        const game = await seedGame(warmScope, 0);
        await game.seats.white.close();
        const { page } = await openSeat(browser, warmScope, 'desktop', game.gameId, 'white');
        await waitBoard(page);
        await settle(page);
        return page;
      });
      report.meta['Warm-up'] = 'one board drawn before the first measured one';
      // Nothing is timed until the bundle's compression (overlapping the warm-up) is done
      if (bundle) await bundleSection(bundle);
      await typedSection(browser, warm);
    } finally {
      await warmScope.close();
    }
  }
  await coldSection(browser);
  const shared = { scope: new Scope(), game: null };
  try {
    await setupSection(browser, shared);
    await movesSection(browser, shared);
  } finally {
    await shared.scope.close();
  }
  await reopenSection(browser);
  await presenceSection(browser);
  await selectSection(browser);
  await renderSection(browser);
  // The report lists the sections in their natural order, whatever order they ran in
  report.sections.sort((a, b) => ORDER.get(a) - ORDER.get(b));

  if (aborted) return;
  report.findings = findings();
  raw.offHost = [...new Set(offHost)];
  TIMINGS.total = (Date.now() - started) / 1000;
  report.meta['Wall time'] = fmtMs(TIMINGS.total * 1000);
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  log(`wrote ${OUT}`);
  log(
    `timings (s): ${Object.entries(TIMINGS)
      .map(([k, v]) => `${k} ${v.toFixed(1)}`)
      .join(' · ')}`,
  );
}

let exitCode = 0;
try {
  await main();
  // A failed section is a row in the report, which is still written; the
  // exit code says so too, so bench/run.mjs reports the tier as failed
  // rather than passing a run that measured nothing
  if (raw.errors?.length) {
    log(
      `${raw.errors.length} section(s) failed: ${raw.errors
        .map((e) => `${e.section} (${e.error})`)
        .join('; ')}`,
    );
    exitCode = 1;
  }
} catch (e) {
  log(`fatal: ${e?.stack ?? e}`);
  exitCode = 1;
} finally {
  await cleanup();
}
process.exit(exitCode);
