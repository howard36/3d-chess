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
// --stills-fast saves the same stills several times faster: the game still
// plays out frame by frame on the virtual clock, but only the saved frames
// are drawn (a full --stills draws every frame, 15 minutes and more on a
// busy machine). A design that renders to a texture once, when something
// mounts mid-game, may need plain --stills.
// --plies N stops after N moves, for a quick look.
// --profile times 20 frames of the opening position and reports what the
// renderer draws (a slow recording is almost always a heavy scene).
// --tour swings the camera about ±40° around the board during the game, to
// show a design from several sides.
// --pose yaw,pitch,zoom holds the camera still at that offset from the
// opening view (degrees, degrees, distance factor).
// --knight arc|straight sets how knights move (the picker's setting;
// straight by default), e.g. to compare the two.
// Needs ffmpeg with libx264 on PATH, or FFMPEG=/path/to/ffmpeg.
//
// --review is a clarity review instead of a recording (no ffmpeg needed):
//
//   node scripts/showcase.mjs --design kit-demo --review --out /tmp/review
//
// Both seats open the design, the scripted game is typed in, and four states
// are photographed from both White's and Black's page: the opening; a piece
// of the side to move selected that has both quiet and capture destinations
// (picked with the rules engine, from Vite's /src, once a few moves are in);
// the last move's trace after a move between levels; and a check. Each is
// shot from 12 poses: 8 azimuths round the tower at the design's own
// elevation, and a low and a high view at two azimuths (the design's orbit
// limits apply, so the labels give the elevation actually reached). It
// writes every shot as <seat>-<state>-<pose>.png plus labelled contact
// sheets: review-states.png (every state from both seats, opening view),
// review-white.png and review-black.png (every state, every pose, and the
// selection twice more from the opening view: the pointer on one of its
// destinations, then on another of the side's pieces). One to three minutes
// for a moderately heavy scene; --quick shoots the opening view only.
// --poses "az,el;az,el" replaces the 12 poses: az in degrees round from the
// seat's opening view, el the elevation in degrees (orbit limits apply),
// e.g. --poses "0,18;180,18;0,45".

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
// The player's knight setting, carried in every address the pages open
const KNIGHT = opt('knight', 'straight');
const SETTINGS = `design=${DESIGN}&knight=${KNIGHT}`;
const OUT = path.resolve(opt('out', 'showcase'));
// --stills-fast takes the same stills, but draws only the frames it saves
const STILLS_FAST = flag('stills-fast');
const STILLS = flag('stills') || STILLS_FAST;
const TOUR = flag('tour');
const REVIEW = flag('review');
const QUICK = flag('quick');
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
    'Ab2-De5 Ed4-Ba1', // unicorns trade pawns across the whole cube
    'Ac2-Cc4 Dc4-Dc3',
    'Ad2-Dd5 Ec4-Dd5', // bishop takes with check; the queen takes back
    'Aa1-Ba1 Dd5-Db3', // rook takes the unicorn
    'Cc4-Db3 Db4-Cb4', // queen trade
    'Ad1-Cd2 Dc3-Cc3',
    'Aa2-Da5 Eb4-Ed2',
    'Da5-Db4 Ed2-Cb2',
    'Db3-Ec4', // mate
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
      // The volume to aim through, in world space: the cell's click box, or,
      // for a piece on a layout whose click boxes are thin slabs on the
      // floor (a hitHeight), the piece's own bounds
      const g = cube.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      let bounds = g.boundingBox.clone().applyMatrix4(cube.matrixWorld);
      if (kind === 'piece' && Math.abs(g.boundingBox.getCenter(new V()).y) > 1e-6) {
        scene.traverse((o) => {
          if (o.userData?.piece && at(o)) {
            const b = g.boundingBox.clone().setFromObject(o);
            if (!b.isEmpty()) bounds = b;
          }
        });
      }
      const mid = bounds.getCenter(new V());
      const extent = bounds.getSize(new V());
      const box = { width: extent.x, height: extent.y, depth: extent.z };
      // Points through that volume, nearest its middle first (a piece's from
      // just above its middle, where its body is): on a crowded board the
      // ray through the middle is often blocked while one near an edge is not.
      const steps = [-0.4, -0.2, 0, 0.2, 0.4];
      const lift = kind === 'piece' ? 0.1 : 0;
      const samples = steps
        .flatMap((ox) => steps.flatMap((oy) => steps.map((oz) => [ox, oy + lift, oz])))
        .sort((a, b) => Math.hypot(a[0], a[1] - lift, a[2]) - Math.hypot(b[0], b[1] - lift, b[2]));
      const canvas = document.querySelector('canvas');
      const r = canvas.getBoundingClientRect();
      for (const [ox, oy, oz] of samples) {
        const p = new V(mid.x + ox * box.width, mid.y + oy * box.height, mid.z + oz * box.depth);
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
    /** As orbit, but to an absolute elevation (degrees above the horizon). */
    orbitTo(yawDeg, elevationDeg, zoom = 1) {
      window.__show.orbit(0, 0, 1, null, 0);
      const pitchDeg = elevationDeg - (base.pitch * 180) / Math.PI;
      window.__show.orbit(yawDeg, pitchDeg, zoom, null, 0);
    },
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
    /**
     * Runs `frames` frames of `ms` each on the virtual clock, so animations
     * settle, but draws only the last (or none, without `drawLast`): under a
     * software renderer the draws are nearly all of a frame's cost, and only
     * the last one is seen.
     */
    settle(frames, ms, drawLast = true) {
      const st = store();
      const gl = st?.gl;
      const draw = gl?.render;
      for (let i = 0; i < frames; i++) {
        if (gl && (i < frames - 1 || !drawLast)) gl.render = () => {};
        try {
          st?.invalidate();
          window.__vclock.step(ms);
        } finally {
          if (gl) gl.render = draw;
        }
      }
    },
    /** The camera's azimuth and elevation about the orbit target, in degrees. */
    pose() {
      const st = store();
      const { camera, controls } = st;
      const t = controls?.target ?? new camera.position.constructor();
      const d = camera.position.clone().sub(t);
      return {
        azimuth: Math.round((Math.atan2(d.x, d.z) * 180) / Math.PI),
        elevation: Math.round((Math.asin(d.y / d.length()) * 180) / Math.PI),
      };
    },
    /**
     * The pieces of `color` with both quiet and capture destinations in the
     * position on screen, best first, found with the rules engine (served by
     * Vite from /src). The position is read off the scene: each piece stands
     * exactly on its cell's box.
     */
    async richPieces(color) {
      const { Board } = await import('/src/engine/index.ts');
      const { fromZXY } = await import('/src/engine/coords.ts');
      const st = store();
      const cubes = [];
      const pieces = [];
      st.scene.traverse((o) => {
        if (o.userData?.cube) cubes.push(o);
        else if (o.userData?.piece) {
          for (let a = o.parent; a; a = a.parent) if (a.userData?.ghostPiece) return;
          pieces.push(o);
        }
      });
      const board = new Board();
      const where = new Map();
      for (const p of pieces) {
        const cube = cubes.find((c) => c.position.distanceTo(p.position) < 1e-4);
        if (!cube) continue;
        board.setPiece(fromZXY(cube.userData.zxy), p.userData.piece);
        where.set(cube.userData.zxy, p.userData.piece);
      }
      const found = [];
      for (const [zxy, piece] of where) {
        if (piece.color !== color) continue;
        const moves = board.generateLegalMoves(fromZXY(zxy));
        const to = new Set(moves.map((m) => `${m.to.x},${m.to.y},${m.to.z}`));
        const targets = [...to].map((k) => k.split(',').map(Number));
        const capture = targets.filter(([x, y, z]) => board.getPiece({ x, y, z })).length;
        const quiet = targets.length - capture;
        if (capture > 0 && quiet > 0) found.push({ zxy, quiet, capture });
      }
      // Both kinds on show, without a queen's worth of clutter
      const score = (f) =>
        Math.min(f.capture, 3) * 20 + Math.min(f.quiet, 10) - Math.max(f.quiet - 16, 0) * 2;
      return found.sort((a, b) => score(b) - score(a));
    },
  };
};

// ---------------------------------------------------------------------------
// Recording

// How long each beat of the video lasts, in seconds.
const PACE = {
  intro: 1.8, // the opening swing onto the board and a moment's look
  swing: 1.6,
  aim: 0.35, // cursor onto the piece
  consider: 0.45, // the legal moves on show
  place: 0.4, // cursor onto the destination
  afterWhite: 0.7,
  afterBlack: 0.8,
  mate: 1.2, // the mate playing out, before the result card
  result: 2.0,
  tail: 1.0,
};

// waitForFunction polls on requestAnimationFrame by default, which the
// virtual clock holds still between frames: poll on a timer instead.
const POLL = { polling: 50, timeout: 60000 };

const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

// ---------------------------------------------------------------------------
// Review

const REVIEW_STATES = {
  opening: 'Opening position',
  selected: 'Selected: quiet and capture destinations',
  lastmove: 'Last move, between levels',
  check: 'Check',
};

// Camera poses, as offsets from the seat's opening view: 8 azimuths round the
// board, then a low and a high view at two azimuths. --poses "az,el;az,el"
// replaces them: az in degrees round from the seat's opening view, el the
// elevation in degrees (the design's orbit limits still apply).
const CUSTOM_POSES = opt('poses');
const REVIEW_POSES = CUSTOM_POSES
  ? CUSTOM_POSES.split(';')
      .map((p) => p.split(',').map(Number))
      .filter(([a, e]) => Number.isFinite(a) && Number.isFinite(e))
      .map(([a, e]) => ({ id: `az${a}-el${e}`, yaw: a, elevation: e }))
  : QUICK
    ? [{ id: 'az0', yaw: 0, pitch: 0 }]
    : [
        ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({ id: `az${a}`, yaw: a, pitch: 0 })),
        { id: 'low-az0', yaw: 0, pitch: -14 },
        { id: 'high-az0', yaw: 0, pitch: 26 },
        { id: 'low-az135', yaw: 135, pitch: -14 },
        { id: 'high-az135', yaw: 135, pitch: 26 },
      ];

const HOVER_CAPTIONS = {
  hover: 'pointer on a destination',
  'hover-piece': 'pointer on a piece',
};

async function review(seats) {
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
  const cdps = {};
  for (const [seat, page] of Object.entries(seats)) {
    cdps[seat] = await page.context().newCDPSession(page);
  }
  // shots[seat][state] = [{ pose, file, azimuth, elevation }]
  const shots = { white: {}, black: {} };
  const notes = { white: {}, black: {} };

  const shoot = async (seat, state, note) => {
    const page = seats[seat];
    // Nothing under the pointer: park it on the page's edge
    await page.mouse.move(WIDTH - 2, HEIGHT / 2);
    // Moves and captures finish playing before the first shot
    await page.evaluate(() => window.__show.settle(24, 1000 / 30));
    shots[seat][state] = [];
    notes[seat][state] = note;
    for (const pose of REVIEW_POSES) {
      const at = await page.evaluate(({ yaw, pitch, elevation }) => {
        if (elevation !== undefined) window.__show.orbitTo(yaw, elevation);
        else window.__show.orbit(yaw, pitch, 1, null, 0);
        // Labels crossfade to their new anchors over a few frames
        window.__show.settle(6, 50);
        return window.__show.pose();
      }, pose);
      const { data } = await cdps[seat].send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, `${seat}-${state}-${pose.id}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      shots[seat][state].push({ pose: pose.id, file, ...at });
    }
    // Back to the opening view for whatever comes next
    await page.evaluate(() => {
      window.__show.orbit(0, 0, 1, null, 0);
      window.__show.settle(2, 50);
    });
    console.log(`${elapsed()} ${seat} ${state}${note ? ` (${note})` : ''}`);
  };

  // The selection once more from the opening view, the pointer resting on
  // one of the side's other pieces (piece hover feedback, the HUD readout)
  const shootPieceHover = async (seat, selectedZxy) => {
    const page = seats[seat];
    const at = await page.evaluate(
      ({ color, exclude }) => {
        const cubes = [];
        const own = [];
        window.__r3fState.get().scene.traverse((o) => {
          if (o.userData?.cube) cubes.push(o);
          const p = o.userData?.piece;
          if (!p || p.color !== color) return;
          for (let a = o.parent; a; a = a.parent) if (a.userData?.ghostPiece) return;
          own.push(o);
        });
        for (const piece of own) {
          const cube = cubes.find((c) => c.position.distanceTo(piece.position) < 1e-4);
          if (!cube || cube.userData.zxy === exclude) continue;
          const px = window.__show.pixelFor(cube.userData.zxy, 'piece');
          if (px) return px;
        }
        return null;
      },
      { color: seat, exclude: selectedZxy },
    );
    if (!at) return;
    await page.mouse.move(at.x, at.y);
    // HUD fades (the readout's) run on the real clock, not the virtual one
    await page.waitForTimeout(250);
    const pose = await page.evaluate(() => {
      window.__show.settle(4, 50);
      return window.__show.pose();
    });
    const { data } = await cdps[seat].send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, `${seat}-selected-hover-piece.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    shots[seat].selected.push({ pose: 'hover-piece', file, ...pose });
  };

  // The selection once more from the opening view, the pointer resting on
  // one of its quiet destinations (how a design shows hover)
  const shootHover = async (seat) => {
    const page = seats[seat];
    const at = await page.evaluate(() => {
      const cells = [];
      const pieces = [];
      window.__r3fState.get().scene.traverse((o) => {
        if (o.userData?.cube && o.userData.highlight) cells.push(o);
        if (o.userData?.piece) pieces.push(o.position);
      });
      for (const cell of cells) {
        if (pieces.some((p) => p.distanceTo(cell.position) < 1e-4)) continue;
        const px = window.__show.pixelFor(cell.userData.zxy, 'cell');
        if (px) return px;
      }
      return null;
    });
    if (!at) return;
    await page.mouse.move(at.x, at.y);
    // HUD fades (the readout's) run on the real clock, not the virtual one
    await page.waitForTimeout(250);
    const pose = await page.evaluate(() => {
      window.__show.settle(3, 50);
      return window.__show.pose();
    });
    const { data } = await cdps[seat].send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, `${seat}-selected-hover.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    shots[seat].selected.push({ pose: 'hover', file, ...pose });
  };

  const has = (state) => !!shots.white[state] && !!shots.black[state];
  await shoot('white', 'opening');
  await shoot('black', 'opening');

  const turn = (p) => p.evaluate(() => window.__show.turnText());
  for (let i = 0; i < GAME.length; i++) {
    if (has('selected') && has('lastmove') && has('check')) break;
    const [from, to] = GAME[i].split('-');
    const mover = i % 2 === 0 ? seats.white : seats.black;
    const next = i % 2 === 0 ? 'Black to move' : 'White to move';
    await mover.fill('#typed-move', `${from}-${to}`);
    await mover.press('#typed-move', 'Enter');
    for (const p of Object.values(seats)) {
      await p.waitForFunction((t) => window.__show.turnText().startsWith(t), next, POLL);
    }
    const plies = i + 1;
    const last = i === GAME.length - 1;
    if (!has('check') && (await turn(seats.white)).includes('check')) {
      for (const seat of ['white', 'black']) await shoot(seat, 'check', `after ${GAME[i]}`);
    }
    if (!has('lastmove') && ((plies >= 3 && from[0] !== to[0]) || last)) {
      for (const seat of ['white', 'black']) await shoot(seat, 'lastmove', `${from}-${to}`);
    }
    // The side to move shows a piece with both kinds of destination
    const seat = i % 2 === 0 ? 'black' : 'white';
    if (!shots[seat].selected && (plies >= 3 || GAME.length - plies < 2)) {
      const page = seats[seat];
      let candidates = [];
      try {
        candidates = await page.evaluate((c) => window.__show.richPieces(c), seat);
      } catch (e) {
        console.log(`no rules engine in the page (${e.message.split('\n')[0]}); skipping`);
      }
      for (const { zxy, quiet, capture } of candidates) {
        await page.evaluate(() => window.__show.settle(2, 1000 / 30));
        const at = await page.evaluate((z) => window.__show.pixelFor(z, 'piece'), zxy);
        if (!at) continue;
        await page.mouse.click(at.x, at.y);
        const selected = await page
          .waitForFunction(
            () => {
              let n = 0;
              window.__r3fState.get().scene.traverse((o) => o.userData?.highlight && n++);
              return n > 0;
            },
            null,
            { ...POLL, timeout: 5000 },
          )
          .then(
            () => true,
            () => false,
          );
        if (!selected) continue;
        await shoot(seat, 'selected', `${zxy}: ${quiet} quiet, ${capture} capture`);
        await shootHover(seat);
        await shootPieceHover(seat, zxy);
        break;
      }
    }
  }
  console.log(`${elapsed()} states done, building sheets`);
  await sheets(seats.white.context(), shots, notes);
  console.log(`review of ${DESIGN} took ${elapsed()}`);
}

/** Lays the shots out as labelled contact sheets, drawn by the browser itself. */
async function sheets(context, shots, notes) {
  const page = await context.newPage();
  const files = new Map();
  await page.route('http://review.local/**', (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    if (files.has(name)) return route.fulfill({ path: files.get(name) });
    return route.fulfill({ body: files.get('/html') ?? '', contentType: 'text/html' });
  });
  const img = (shot) => {
    const name = path.basename(shot.file);
    files.set(name, shot.file);
    return `http://review.local/${encodeURIComponent(name)}`;
  };
  const style = `
    body { margin: 0; padding: 20px 24px; background: #111418; color: #e6eaf0;
      font: 14px/1.35 system-ui, sans-serif; }
    h1 { font-size: 22px; margin: 0 0 14px; }
    h2 { font-size: 16px; margin: 22px 0 8px; color: #fff; }
    h2 small { font-weight: 400; color: #9aa4b2; margin-left: 8px; }
    .row { display: flex; gap: 8px; margin-bottom: 8px; }
    figure { margin: 0; }
    figure img { display: block; border-radius: 4px; }
    /* Pose thumbnails show the board, not the HUD round it */
    img.board { object-fit: cover; object-view-box: inset(7% 22% 3% 22%); }
    figcaption { font-size: 12px; color: #aeb7c4; padding: 3px 2px 0; }
    .missing { color: #ff8a80; }`;
  const caption = (s) =>
    `${HOVER_CAPTIONS[s.pose] ?? s.pose} · azimuth ${s.azimuth}° · elevation ${s.elevation}°`;
  const render = async (name, html) => {
    files.set(
      '/html',
      `<!doctype html><meta charset="utf-8"><style>${style}</style><body>${html}</body>`,
    );
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('http://review.local/index.html');
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const width = await page.evaluate(() => document.body.scrollWidth);
    await page.setViewportSize({ width, height: 600 });
    const file = path.join(OUT, name);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  };
  const title = (state, seat) =>
    `${REVIEW_STATES[state]}${notes[seat]?.[state] ? `<small>${notes[seat][state]}</small>` : ''}`;

  // Every state from both seats, from each seat's opening view
  let html = `<h1>${DESIGN}: states from both seats (opening view)</h1>`;
  for (const state of Object.keys(REVIEW_STATES)) {
    html += `<h2>${REVIEW_STATES[state]}</h2><div class="row">`;
    for (const seat of ['white', 'black']) {
      const s = shots[seat][state]?.[0];
      html += s
        ? `<figure><img src="${img(s)}" width="720"><figcaption>${seat} · ${notes[seat][state] ?? ''}</figcaption></figure>`
        : `<figure class="missing">${seat}: not reached in the scripted game</figure>`;
    }
    html += '</div>';
  }
  await render('review-states.png', html);

  // Per seat: every state from every pose
  for (const seat of ['white', 'black']) {
    html = `<h1>${DESIGN}: ${seat}'s seat, ${REVIEW_POSES.length} poses</h1>`;
    for (const state of Object.keys(REVIEW_STATES)) {
      const list = shots[seat][state];
      html += `<h2>${title(state, seat)}</h2>`;
      if (!list) {
        html += '<p class="missing">Not reached in the scripted game.</p>';
        continue;
      }
      const azimuths = list.filter((s) => s.pose.startsWith('az'));
      const others = list.filter((s) => !s.pose.startsWith('az'));
      for (const group of [azimuths, others]) {
        if (!group.length) continue;
        html += '<div class="row">';
        for (const s of group) {
          html += `<figure><img class="board" src="${img(s)}" width="300" height="300"><figcaption>${caption(s)}</figcaption></figure>`;
        }
        html += '</div>';
      }
    }
    await render(`review-${seat}.png`, html);
  }
  await page.close();
}

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

  await pageA.goto(`${BASE}/?${SETTINGS}`);
  await pageA.getByRole('button', { name: 'Start New Game' }).click();
  await pageA.waitForURL(/\/game\/[A-Z0-9]+/);
  // A review shows the design from both seats; a recording only needs one
  await pageB.goto(`${pageA.url()}?${REVIEW ? SETTINGS : 'design=classic'}`);
  await pageB.getByRole('button', { name: 'Join Game' }).click();
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => window.__show?.ready(), null, { timeout: 120000 });
  }

  const colorOf = async (p) =>
    (await p.locator('text=/You are playing as/').textContent()).match(/as (white|black)/)[1];
  const white = (await colorOf(pageA)) === 'white' ? pageA : pageB;
  const black = white === pageA ? pageB : pageA;
  if (REVIEW) {
    for (const p of [white, black]) {
      await p.waitForFunction((d) => window.__show?.ready(d), DESIGN, { timeout: 120000 });
      await p.evaluate(() => document.fonts.ready);
    }
    await white.waitForTimeout(1500);
    for (const p of [white, black]) await p.evaluate(() => window.__vclock.enable());
    await review({ white, black });
    await browser.close();
    return;
  }
  // The opponent's page is only there to answer; keep its renderer cheap.
  await black.setViewportSize({ width: 400, height: 300 });
  if (white === pageB) {
    // The joiner opened the game with the classic look; switch it over.
    await white.goto(`${white.url().split('?')[0]}?${SETTINGS}`);
  }
  await white.waitForFunction((d) => window.__show?.ready(d), DESIGN, { timeout: 120000 });
  await white.evaluate(() => document.fonts.ready);
  // Let the design's chunk, fonts and first frames settle in real time
  await white.waitForTimeout(1500);
  await white.evaluate(() => window.__vclock.enable());

  const cdp = await white.context().newCDPSession(white);
  if (flag('profile')) {
    // Where a frame's time goes: render (in the page, real clock) and capture.
    const renders = [];
    const captures = [];
    for (let i = 0; i < 20; i++) {
      renders.push(
        await white.evaluate(() => {
          const t = Date.now();
          window.__r3fState.get().invalidate(); // on-demand designs draw too
          window.__vclock.step(1000 / 30);
          return Date.now() - t;
        }),
      );
      const t = Date.now();
      await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      captures.push(Date.now() - t);
    }
    const stats = await white.evaluate(() => {
      const { gl, scene } = window.__r3fState.get();
      // Count a whole frame, every pass (shadow maps, bloom) included
      gl.info.autoReset = false;
      gl.info.reset();
      window.__r3fState.get().invalidate();
      window.__vclock.step(1000 / 30);
      gl.info.autoReset = true;
      const shadows = [];
      let meshes = 0;
      let transparent = 0;
      scene.traverse((o) => {
        if (o.isMesh || o.isPoints || o.isLine) meshes++;
        if (o.material?.transparent) transparent++;
        if (o.isLight && o.castShadow) shadows.push(o.shadow.mapSize.x);
      });
      // The heaviest geometries in the scene, instances multiplied out
      const heavy = new Map();
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const g = o.geometry;
        const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
        const n = o.isInstancedMesh ? o.count : 1;
        const key = g.uuid;
        const e = heavy.get(key) ?? { tris, uses: 0, type: g.type, shadow: o.castShadow };
        e.uses += n;
        heavy.set(key, e);
      });
      const top = [...heavy.values()]
        .map((e) => ({ ...e, total: e.tris * e.uses }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 6)
        .map((e) => `${e.type} ${e.tris}x${e.uses}${e.shadow ? ' +shadow' : ''}`);
      return {
        top,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        programs: gl.info.programs?.length,
        objects: meshes,
        transparent,
        shadowMaps: shadows,
        shadowType: gl.shadowMap.enabled ? gl.shadowMap.type : 'off',
        pixelRatio: gl.getPixelRatio(),
      };
    });
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    console.log(
      JSON.stringify({
        design: DESIGN,
        renderMs: med(renders),
        captureMs: med(captures),
        ...stats,
      }),
    );
    await browser.close();
    return;
  }
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
    const intro = STILLS ? 1 : Math.min(t / PACE.swing, 1);
    const k = ease(intro);
    // --tour swings wide (about ±40°) so a video shows the board from several
    // sides; otherwise the camera only sways.
    const sway = TOUR ? 40 : 8;
    const rate = TOUR ? (2 * Math.PI) / 26 : 0.3;
    const yaw = -18 * (1 - k) + sway * Math.sin((t - PACE.swing) * rate) * k;
    const pitch = 8 * (1 - k) + (TOUR ? 5 : 2) * Math.sin(t * 0.21) * k;
    const zoom = 1.12 - 0.12 * k;
    return [yaw, pitch, zoom];
  };

  // The finale: once mate lands, the camera leans in on the fallen king.
  let finale = null;
  // --stills-fast draws only the frames it saves: the clock, the animations
  // and the camera still advance every frame, just without a picture.
  const step = async (capture = !STILLS, draw = !STILLS_FAST || capture) => {
    let [yaw, pitch, zoom] = camera(frame);
    let pull = 0;
    if (finale) {
      const k = ease(Math.min((frame - finale.frame) / (FPS * 1.6), 1));
      zoom *= 1 - 0.18 * k;
      pull = 0.3 * k;
    }
    await white.evaluate(
      ({ ms, yaw, pitch, zoom, focus, pull, cx, cy, press, draw }) => {
        window.__show.orbit(yaw, pitch, zoom, focus, pull);
        window.__show.cursor(cx, cy, press);
        if (draw) window.__vclock.step(ms);
        else window.__show.settle(1, ms, false);
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
        draw,
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
    await step(false, true);
    const file = path.join(OUT, `${DESIGN}-${name}.png`);
    await white.screenshot({ path: file, timeout: 120000 });
    console.log(file);
  };
  const locate = (zxy, kind) =>
    white.evaluate(({ zxy, kind }) => window.__show.pixelFor(zxy, kind), { zxy, kind });
  // Glides the cursor onto a piece or cell, re-aiming every frame (the camera
  // keeps swaying), and leaves it exactly on target for the click.
  const glideTo = async (zxy, kind, seconds = PACE.aim) => {
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
      console.log(`no pixel reaches ${kind} ${zxy}, typing the move: ${JSON.stringify(why)}`);
      return false;
    }
    cursor = target;
    await white.mouse.move(cursor.x, cursor.y);
    return true;
  };
  // The fallback for a square no ray reaches: the move box, as a keyboard
  // player would.
  const typeMove = async (page, from, to) => {
    await page.fill('#typed-move', `${from}-${to}`);
    await page.press('#typed-move', 'Enter');
  };
  const waitTurn = async (page, text) => {
    await page.waitForFunction((t) => window.__show.turnText().startsWith(t), text, {
      ...POLL,
      timeout: 60000,
    });
  };

  await hold(STILLS ? 0.2 : PACE.intro);
  await still('start');

  for (let i = 0; i < Math.min(PLIES, GAME.length); i++) {
    const [from, to] = GAME[i].split('-');
    const whiteMoves = i % 2 === 0;
    const next = whiteMoves ? 'Black to move' : 'White to move';
    if (whiteMoves) {
      if (await glideTo(from, 'piece')) {
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
        await hold(PACE.consider);
        if (i === 0) await still('selected');
      }
      if (await glideTo(to, 'cell', PACE.place)) {
        await white.mouse.click(cursor.x, cursor.y);
        press = 1;
      } else {
        await typeMove(white, from, to);
      }
      await waitTurn(white, next);
    } else {
      await typeMove(black, from, to);
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
    await hold(whiteMoves ? PACE.afterWhite : PACE.afterBlack);
    if ((await white.evaluate(() => window.__show.turnText())).includes('check'))
      await still('check');
  }

  if (PLIES >= GAME.length) {
    // The mate: lean in while the design plays it out, then the result card
    // (the app holds it back for a moment on designs with a mate animation).
    const loser = GAME.length % 2 === 1 ? 'black' : 'white';
    finale = { frame, king: await white.evaluate((c) => window.__show.kingAt(c), loser) };
    await hold(PACE.mate);
    await still('mate');
    await hold(PACE.result);
    await still('result');
    await hold(PACE.tail);
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
