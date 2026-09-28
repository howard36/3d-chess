#!/usr/bin/env node
// Records the game in play: a scripted game on the board, as a video.
//
//   node scripts/showcase.mjs --out /tmp/showcase
//   node scripts/showcase.mjs --stills --out /tmp/shots
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
// busy machine). Anything that renders to a texture once, when it mounts
// mid-game, may need plain --stills.
// --plies N stops after N moves, for a quick look.
// --profile times 20 frames of the opening position and reports what the
// renderer draws (a slow recording is almost always a heavy scene).
// --tour swings the camera about ±40° around the board during the game, to
// show it from several sides.
// --pose yaw,pitch,zoom holds the camera still at that offset from the
// opening view (degrees, degrees, distance factor).
// --knight arc|straight sets how knights move (the settings panel's Knight
// moves; straight by default), e.g. to compare the two.
// Needs ffmpeg with libx264 on PATH, or FFMPEG=/path/to/ffmpeg.
//
// --review photographs the board for a legibility check instead of recording
// (no ffmpeg needed):
//
//   node scripts/showcase.mjs --review --out /tmp/review
//
// Both seats open the game, the scripted game is played in, and four states
// are photographed from both White's and Black's page: the opening; a piece
// of the side to move selected that has both quiet and capture destinations
// (picked with the rules engine, from Vite's /src, once a few moves are in);
// the last move's line after a move between levels; and a check. Each is
// shot from 13 poses: 8 azimuths round the tower at the opening view's
// elevation, a low and a high view at two azimuths, and straight down from
// above, turned square to the seat so it reads like a 2D board (the camera's
// orbit limits apply, so the labels give the elevation actually reached). It
// writes every shot as <seat>-<state>-<pose>.png plus labelled contact
// sheets: review-states.png (every state from both seats, opening view),
// review-white.png and review-black.png (every state, every pose, and the
// selection twice more from the opening view: the pointer on one of its
// destinations, then on another of the side's pieces). One to three minutes
// for a moderately heavy scene; --quick shoots the opening view and the
// top-down view only.
// --poses "az,el;az,el" replaces the 12 poses: az in degrees round from the
// seat's opening view, el the elevation in degrees (orbit limits apply),
// e.g. --poses "0,18;180,18;0,45". --select-white Bc2 and --select-black Db4
// choose the piece each seat selects instead of one the rules engine picks;
// it must be that side's piece at that point in the scripted game (the
// selection is shot from the third ply on).
//
// --interact records the small animations of pointing and selecting instead
// of a game:
//
//   node scripts/showcase.mjs --interact --out /tmp/interact
//
// The scripted game is played in, unrecorded, up to the first position from
// the third ply on where the recorded seat (White's) is to move with a piece P
// whose quiet and capture destinations the pointer can reach (picked with the
// rules engine, as --review picks, then tried out off camera), and another
// piece Q to switch to. Then, from the seat's opening view (or --pose), the
// drawn pointer glides between them in ten beats, each held about a second
// for its animation to settle and named in a label at the bottom left:
//   1 rest (on empty space)    6 capture (the pointer on its victim)
//   2 hover P                  7 switch straight to Q (P is released)
//   3 unhover                  8 destination (one of Q's)
//   4 select P                 9 deselect (back onto Q, click)
//   5 quiet (a destination)   10 rest
// It writes interact.mp4 (16 s) and a still at the end of each beat,
// interact-<nn>-<beat>.png: three to nine minutes on a busy machine,
// or about a minute with --interact --stills-fast, which saves only the stills
// and draws only their frames. --select-white Cc4 chooses P; --select-black
// Db4 chooses P and records Black's seat instead (unless --select-white is
// given too).
//
// --orbit reviews the view's framing and the labels through a continuous
// orbit, never sampled poses (do this after any change to the camera's fit or
// the labels, and watch the video):
//
//   node scripts/showcase.mjs --orbit --out /tmp/orbit [--seat black] [--width 390 --height 844]
//
// From the opening position, the seat's camera turns all the way round at
// each of the elevations -14°, 18°, 45°, 75° and 89.9° (--orbit-elevations
// "e,e,…"), --orbit-step degrees a frame (1 by default), then climbs from -14°
// to 89.9° at the opening azimuth and comes back down 45° further round, half
// a step a frame. It writes orbit.mp4, orbit-sheet.png (a still every 30° of
// each orbit and 15° of each climb) and a jitter report, printed and saved as
// orbit-report.txt and orbit-report.json: how far the view's centre (the orbit
// target on screen) moved, the largest change in any label's step from one
// frame to the next (a jump or a kink shows as a spike), where the level
// letters changed post, and a flag for every discontinuity, letters out of
// line or out of order or switching apart, and the tower running past the
// window's edge or into a HUD band. The orbit's limits apply (it reaches -14°
// only near enough the tower). --stills skips the video and draws only the
// sheet's stills, several times faster.

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

// How knights move: the player's setting, stored before the pages load
const KNIGHT = opt('knight', 'straight');
// Where the app keeps the board's settings (src/three/settings.ts)
const SETTINGS_KEY = '3dchess:settings';
const OUT = path.resolve(opt('out', 'showcase'));
// --stills-fast takes the same stills, but draws only the frames it saves
const STILLS_FAST = flag('stills-fast');
const STILLS = flag('stills') || STILLS_FAST;
const TOUR = flag('tour');
const REVIEW = flag('review');
const QUICK = flag('quick');
const INTERACT = flag('interact');
const ORBIT = flag('orbit');
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
    /** The canvas is up and the board is in the scene. */
    ready() {
      const el = document.querySelector('[data-testid="r3f-canvas"]');
      if (!el) return false;
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
    /**
     * As orbit, but to an absolute elevation (degrees above the horizon).
     * `square` turns the heading to the seat's own axis first (the opening
     * view sits a little off it), so a top-down view reads like a 2D board.
     */
    orbitTo(yawDeg, elevationDeg, zoom = 1, square = false) {
      window.__show.orbit(0, 0, 1, null, 0);
      const pitchDeg = elevationDeg - (base.pitch * 180) / Math.PI;
      const quarter = Math.PI / 2;
      const offDeg = square
        ? ((Math.round(base.yaw / quarter) * quarter - base.yaw) * 180) / Math.PI
        : 0;
      window.__show.orbit(yawDeg + offDeg, pitchDeg, zoom, null, 0);
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
      // Up to a bird's-eye view (a hair off vertical, so the view keeps its heading)
      const pitch = Math.max(-1.4, Math.min(1.5691, base.pitch + (pitchDeg * Math.PI) / 180));
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
    /** The side to move and whether it is in check, from the turn pill. */
    turn: () => {
      const pill = document.querySelector('[data-testid="turn-indicator"]');
      return { side: pill?.dataset.turn ?? null, check: !!pill?.dataset.check };
    },
    /** It is `side`'s move (white or black), or the pill gives the result: the game is over. */
    turnReached: (side) =>
      window.__show.turn().side === side ||
      !!document.querySelector('[data-testid="turn-indicator"][data-result]'),
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
    /**
     * The camera straight to an absolute azimuth and elevation (degrees)
     * about the orbit target, at the opening view's distance times `zoom`.
     * The controls apply their limits (pose() gives the elevation reached).
     */
    orbitAt(azimuthDeg, elevationDeg, zoom = 1) {
      const st = store();
      if (!st) return;
      const { camera, controls } = st;
      const target = controls?.target ?? new camera.position.constructor();
      if (!base) window.__show.orbit(0, 0, 1, null, 0);
      const yaw = (azimuthDeg * Math.PI) / 180;
      const pitch = Math.max(-1.4, Math.min(1.5691, (elevationDeg * Math.PI) / 180));
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
    /**
     * Where things fall on screen (page px): the orbit target (the tower's
     * centre, which the view keeps on its vertical axis), the view's lens
     * shift, the tower's outline (its platforms' and pieces' bounds) and
     * both sprites of every label (SmartLabels crossfades between them),
     * each with its opacity and its height in px.
     */
    measure() {
      const st = store();
      const { camera, controls, scene, size } = st;
      camera.updateMatrixWorld();
      scene.updateMatrixWorld(true);
      const V = camera.position.constructor;
      const r = document.querySelector('canvas').getBoundingClientRect();
      const px = (v) => {
        const p = v.clone().project(camera);
        return [r.left + (p.x * 0.5 + 0.5) * size.width, r.top + (-p.y * 0.5 + 0.5) * size.height];
      };
      const target = controls?.target ?? new V();
      const d = camera.position.clone().sub(target);
      const forward = target.clone().sub(camera.position).normalize();
      // Pixels per world unit at one unit of depth
      const scale = size.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      // The labels in the order SmartLabels draws them, for a build that
      // does not name its sprites
      const order = [
        ...['a', 'b', 'c', 'd', 'e'].map((f) => `file-${f}-0`),
        ...[1, 2, 3, 4, 5].map((n) => `rank-${n}-0`),
        ...['A', 'B', 'C', 'D', 'E'].map((l) => `level-${l}`),
      ];
      const labels = {};
      scene.getObjectByName('smart-labels')?.children.forEach((s, i) => {
        const id = s.userData?.labelId ?? order[i >> 1];
        const w = s.getWorldPosition(new V());
        const depth = w.clone().sub(camera.position).dot(forward);
        (labels[id] ??= []).push({
          at: px(w),
          opacity: s.visible ? s.material.opacity : 0,
          h: (s.scale.y * scale) / Math.max(depth, 1e-3),
        });
      });
      // The tower as drawn: each platform (glass, border and rim) and each
      // piece, by its own bounds (the squares' click boxes are not drawn)
      const boxes = [];
      const boundsOf = (root) => {
        let b = null;
        root.traverse((o) => {
          if (!o.isMesh || !o.visible || o.userData?.hitProxy) return;
          const g = o.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const w = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
          b = b ? b.union(w) : w;
        });
        if (b) boxes.push(b);
      };
      scene.getObjectByName('levels')?.children.forEach(boundsOf);
      scene.traverse((o) => {
        if (o.userData?.piece) boundsOf(o);
      });
      const xs = [];
      const ys = [];
      for (const box of boxes)
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
              const [u, v] = px(new V(x, y, z));
              xs.push(u);
              ys.push(v);
            }
      return {
        azimuth: (Math.atan2(d.x, d.z) * 180) / Math.PI,
        elevation: (Math.asin(d.y / d.length()) * 180) / Math.PI,
        distance: d.length(),
        centre: px(target),
        shift: camera.userData.lensShift ?? [0, 0],
        outline: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        labels,
      };
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
     * Vite from /src); with `any`, every piece of `color` that can move. The
     * position is read off the scene: each piece stands exactly on its cell's
     * box.
     */
    async richPieces(color, any = false) {
      const { Board } = await import('/src/engine/index.ts');
      const { fromZXY } = await import('/src/engine/coords.ts');
      const st = store();
      const cubes = [];
      const pieces = [];
      st.scene.traverse((o) => {
        if (o.userData?.cube) cubes.push(o);
        else if (o.userData?.piece) pieces.push(o);
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
        if (any ? capture + quiet > 0 : capture > 0 && quiet > 0) {
          found.push({ zxy, quiet, capture });
        }
      }
      // Both kinds on show, without a queen's worth of clutter
      const score = (f) =>
        Math.min(f.capture, 3) * 20 + Math.min(f.quiet, 10) - Math.max(f.quiet - 16, 0) * 2;
      return found.sort((a, b) => score(b) - score(a));
    },
    /** The page pixel of a cell's centre (whatever stands in front of it). */
    screenOf(zxy) {
      const st = store();
      const cube = window.__show.cube(zxy);
      if (!st || !cube) return null;
      const r = document.querySelector('canvas').getBoundingClientRect();
      const p = cube.getWorldPosition(cube.position.clone()).project(st.camera);
      return {
        x: r.left + (p.x * 0.5 + 0.5) * st.size.width,
        y: r.top + (-p.y * 0.5 + 0.5) * st.size.height,
      };
    },
    /** What stands on a cell, e.g. "White Bishop", or null. */
    pieceAt(zxy) {
      const cube = window.__show.cube(zxy);
      let found = null;
      store()?.scene.traverse((o) => {
        const p = o.userData?.piece;
        if (!p || !cube || o.position.distanceTo(cube.position) > 1e-4) return;
        found = `${p.color[0].toUpperCase()}${p.color.slice(1)} ${p.type}`;
      });
      return found;
    },
    /**
     * The selected piece's destinations: `capture` when a piece stands there,
     * and with `aim` the pixel that reaches each (null when none does).
     */
    destinations(aim = false) {
      const cells = [];
      const pieces = [];
      store()?.scene.traverse((o) => {
        if (o.userData?.cube && o.userData.highlight) cells.push(o);
        else if (o.userData?.piece) pieces.push(o.position);
      });
      return cells.map((cell) => ({
        zxy: cell.userData.zxy,
        capture: pieces.some((p) => p.distanceTo(cell.position) < 1e-4),
        px: aim ? window.__show.pixelFor(cell.userData.zxy, 'cell') : null,
      }));
    },
    /**
     * The page pixel nearest `near`, at least `min` away, with nothing of the
     * board under it or round it: off the board's outline if there is room,
     * else in a gap in it. Null if the board fills the view.
     */
    emptyPixel(near, min = 80) {
      const st = store();
      const { camera, scene, raycaster, size } = st;
      camera.updateMatrixWorld();
      scene.updateMatrixWorld(true);
      const grid = scene.getObjectByName('board-grid');
      const canvas = document.querySelector('canvas');
      const r = canvas.getBoundingClientRect();
      const clear = (x, y) => {
        if (document.elementFromPoint(x, y) !== canvas) return false;
        const ndc = {
          x: ((x - r.left) / size.width) * 2 - 1,
          y: -((y - r.top) / size.height) * 2 + 1,
        };
        raycaster.setFromCamera(ndc, camera);
        return raycaster.intersectObject(grid, true).length === 0;
      };
      // The board's outline on screen: its bounding box's corners, projected
      const V = camera.position.constructor;
      const bounds = (() => {
        let b = null;
        grid.traverse((o) => {
          if (!o.userData?.cube) return;
          const g = o.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const w = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
          b = b ? b.union(w) : w;
        });
        return b;
      })();
      let outline = null;
      if (bounds) {
        const xs = [];
        const ys = [];
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z]) {
              const p = new V(x, y, z).project(camera);
              xs.push(r.left + (p.x * 0.5 + 0.5) * size.width);
              ys.push(r.top + (-p.y * 0.5 + 0.5) * size.height);
            }
        outline = {
          x0: Math.min(...xs),
          x1: Math.max(...xs),
          y0: Math.min(...ys),
          y1: Math.max(...ys),
        };
      }
      const inside = (x, y) =>
        outline &&
        x > outline.x0 - 24 &&
        x < outline.x1 + 24 &&
        y > outline.y0 - 24 &&
        y < outline.y1 + 24;
      const points = [];
      for (let y = r.top + 40; y < r.bottom - 40; y += 16) {
        for (let x = r.left + 40; x < r.right - 40; x += 16) {
          const d = Math.hypot(x - near.x, y - near.y);
          if (d >= min) points.push({ x: Math.round(x), y: Math.round(y), d, off: !inside(x, y) });
        }
      }
      points.sort((a, b) => b.off - a.off || a.d - b.d);
      const m = 28;
      const round = [
        [0, 0],
        [m, 0],
        [-m, 0],
        [0, m],
        [0, -m],
      ];
      for (const p of points) {
        if (round.every(([dx, dy]) => clear(p.x + dx, p.y + dy))) return { x: p.x, y: p.y };
      }
      return null;
    },
    /** A small label naming the moment, at the bottom left; null removes it. */
    caption(text) {
      let el = document.getElementById('__caption');
      if (!text) return el?.remove();
      if (!el) {
        el = document.createElement('div');
        el.id = '__caption';
        el.style.cssText =
          'position:fixed;left:12px;bottom:14px;white-space:nowrap;z-index:99998;pointer-events:none;padding:5px 11px;border-radius:6px;background:rgba(10,12,16,0.72);color:#f2f4f8;font:600 15px/1.2 system-ui,sans-serif;letter-spacing:0.02em;box-shadow:0 1px 6px rgba(0,0,0,0.4)';
        document.body.appendChild(el);
      }
      el.textContent = text;
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
  // The card appears as the king strikes the floor (about 1 s after the
  // move), while the pulse on his level plays on behind it
  result: 1.6,
  tail: 1.0,
};

// waitForFunction polls on requestAnimationFrame by default, which the
// virtual clock holds still between frames: poll on a timer instead.
const POLL = { polling: 50, timeout: 60000 };

/**
 * Plays a move on `page` as a player would: a click on the piece, then on its
 * destination once it lights up. A square no ray reaches from this view
 * (a piece in front of it) is typed instead, the keyboard player's way: Tab
 * brings up the move field, Enter sends the move, Escape puts it away.
 */
const playMove = async (page, from, to) => {
  const aim = (zxy, kind) =>
    page.evaluate(({ zxy, kind }) => window.__show.pixelFor(zxy, kind), { zxy, kind });
  const at = await aim(from, 'piece');
  if (at) {
    await page.mouse.click(at.x, at.y);
    const lit = await page
      .waitForFunction((z) => window.__show.isDestination(z), to, { ...POLL, timeout: 8000 })
      .then(
        () => true,
        () => false,
      );
    const dest = lit ? await aim(to, 'cell') : null;
    if (dest) {
      await page.mouse.click(dest.x, dest.y);
      await page.mouse.move(2, 2);
      return;
    }
  }
  console.log(`no clear line to ${from} or ${to}: typing ${from}-${to}`);
  const field = page.getByRole('textbox', { name: /Type a move/ });
  for (let i = 0; i < 8; i++) {
    if (await field.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.type(`${from}-${to}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2);
};

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
// board, then a low and a high view at two azimuths, then top-down (as far
// as the camera's orbit allows). --poses "az,el;az,el" replaces them: az in
// degrees round from the seat's opening view, el the elevation in degrees
// (the orbit limits still apply).
const TOP_DOWN = { id: 'top', yaw: 0, elevation: 89.9, square: true };
const CUSTOM_POSES = opt('poses');
const REVIEW_POSES = CUSTOM_POSES
  ? CUSTOM_POSES.split(';')
      .map((p) => p.split(',').map(Number))
      .filter(([a, e]) => Number.isFinite(a) && Number.isFinite(e))
      .map(([a, e]) => ({ id: `az${a}-el${e}`, yaw: a, elevation: e }))
  : QUICK
    ? [{ id: 'az0', yaw: 0, pitch: 0 }, TOP_DOWN]
    : [
        ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({ id: `az${a}`, yaw: a, pitch: 0 })),
        { id: 'low-az0', yaw: 0, pitch: -14 },
        { id: 'high-az0', yaw: 0, pitch: 26 },
        { id: 'low-az135', yaw: 135, pitch: -14 },
        { id: 'high-az135', yaw: 135, pitch: 26 },
        TOP_DOWN,
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
      const at = await page.evaluate(({ yaw, pitch, elevation, square }) => {
        if (elevation !== undefined) window.__show.orbitTo(yaw, elevation, 1, square);
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
  // one of its quiet destinations (how the board shows hover)
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

  const turn = (p) => p.evaluate(() => window.__show.turn());
  for (let i = 0; i < GAME.length; i++) {
    if (has('selected') && has('lastmove') && has('check')) break;
    const [from, to] = GAME[i].split('-');
    const mover = i % 2 === 0 ? seats.white : seats.black;
    const next = i % 2 === 0 ? 'black' : 'white';
    await playMove(mover, from, to);
    for (const p of Object.values(seats)) {
      await p.waitForFunction((t) => window.__show.turnReached(t), next, POLL);
    }
    const plies = i + 1;
    const last = i === GAME.length - 1;
    if (!has('check') && (await turn(seats.white)).check) {
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
      const forced = opt(`select-${seat}`);
      if (forced) candidates = [{ zxy: forced, quiet: '?', capture: '?' }];
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
  console.log(`review took ${elapsed()}`);
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
  let html = '<h1>States from both seats (opening view)</h1>';
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
    html = `<h1>${seat[0].toUpperCase()}${seat.slice(1)}'s seat, ${REVIEW_POSES.length} poses</h1>`;
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

// ---------------------------------------------------------------------------
// Orbit

/** Every `step` from `from` to `to`, both included. */
const range = (from, to, step) => {
  const n = Math.max(1, Math.round(Math.abs(to - from) / step));
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
};

/**
 * Each glyph's ink as a share of its sprite, across and up (Manrope as the
 * grid draws it; the same table as scene/labelSweep.test.ts).
 */
const INK = {
  A: [0.43, 0.48],
  B: [0.36, 0.48],
  C: [0.45, 0.5],
  D: [0.4, 0.48],
  E: [0.32, 0.48],
  a: [0.32, 0.39],
  b: [0.34, 0.5],
  c: [0.34, 0.39],
  d: [0.34, 0.5],
  e: [0.36, 0.38],
  1: [0.17, 0.48],
  2: [0.33, 0.49],
  3: [0.33, 0.49],
  4: [0.34, 0.48],
  5: [0.33, 0.5],
};
const INK_HEIGHT = 0.5;
/** A label's ink box, from its id (file-a-0, rank-3-0, level-C). */
const inkOf = (id) => INK[id.split('-')[1]] ?? [0.5, 0.5];

/**
 * The jitter report for one stretch of an --orbit recording: how the view's
 * centre and every label moved from frame to frame. A turning camera moves a
 * label smoothly, so its step changes little from one frame to the next; a
 * jump or a kink (the centre or a label lurching sideways) shows as a spike in
 * that change. A label crossfading to a new place (both its sprites showing)
 * is a switch, not a jump; the level letters must switch together.
 */
function jitter(name, frames, bands) {
  const flags = [];
  const flag = (i, what) => {
    const f = frames[i];
    flags.push(`az ${f.azimuth.toFixed(1)}° el ${f.elevation.toFixed(1)}°: ${what}`);
  };
  const turning = name.startsWith('orbit');
  // The view's centre (the orbit target on screen): still however the camera
  // turns or climbs
  const cx = frames.map((f) => f.centre[0]);
  const cy = frames.map((f) => f.centre[1]);
  const steps = frames.slice(1).map((f, i) => Math.hypot(cx[i + 1] - cx[i], cy[i + 1] - cy[i]));
  const kinks = frames
    .slice(2)
    .map((_, i) =>
      Math.hypot(cx[i + 2] - 2 * cx[i + 1] + cx[i], cy[i + 2] - 2 * cy[i + 1] + cy[i]),
    );
  steps.forEach((s, i) => {
    if (s > 0.5) flag(i + 1, `the centre moved ${s.toFixed(2)} px`);
  });
  // Each label where it shows: the sprite most opaque, crossfading while both show
  const ids = Object.keys(frames[0].labels);
  const shown = (f, id) => {
    const [a, b = { opacity: 0 }] = f.labels[id];
    return a.opacity >= b.opacity ? a : b;
  };
  const fading = (f, id) => f.labels[id].filter((s) => s.opacity > 0.02).length > 1;
  const letters = ids.filter((id) => id.startsWith('level-'));
  let worstLabel = 0;
  const switches = {};
  for (const id of ids) {
    const at = frames.map((f) => shown(f, id).at);
    for (let i = 2; i < frames.length; i++) {
      // Only while it shows, and not crossfading (a faded-out file or rank
      // may take another edge unseen)
      const hidden = (k) => shown(frames[k], id).opacity < 0.05;
      if ([i - 2, i - 1, i].some((k) => fading(frames[k], id) || hidden(k))) continue;
      const k = Math.hypot(
        at[i][0] - 2 * at[i - 1][0] + at[i - 2][0],
        at[i][1] - 2 * at[i - 1][1] + at[i - 2][1],
      );
      const h = shown(frames[i], id).h;
      // A label turning with the view changes its step by well under a
      // pixel a frame; a jump by far more than that
      if (k > Math.max(3, 0.25 * h)) flag(i, `${id} jumped ${k.toFixed(1)} px`);
      else worstLabel = Math.max(worstLabel, k);
    }
    // Crossfades begin where a hidden sprite starts to show
    switches[id] = [];
    for (let i = 1; i < frames.length; i++) {
      if (fading(frames[i], id) && !fading(frames[i - 1], id)) switches[id].push(i);
    }
  }
  // The letters switch together, and stand in one straight line in order
  const letterSwitches = new Set(letters.flatMap((id) => switches[id]));
  for (const i of letterSwitches) {
    const apart = letters.filter((id) => !switches[id].some((j) => Math.abs(j - i) <= 1));
    if (apart.length) flag(i, `the level letters switched apart (${apart.join(' ')} did not)`);
  }
  let worstLine = 0;
  let nearestParallel = 90;
  // Frames where the letters stood near-parallel to a row across the tower,
  // near a square view (see below)
  const acrossSquare = new Set();
  const row = (f, prefix) => ids.filter((id) => id.startsWith(prefix)).map((id) => shown(f, id));
  frames.forEach((f, i) => {
    // Where each letter shows (mid-crossfade, the sprite more opaque)
    const p = letters.map((id) => shown(f, id).at);
    const [a, e] = [p[0], p[p.length - 1]];
    const l = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    const u = [(e[0] - a[0]) / l, (e[1] - a[1]) / l];
    const off = Math.max(...p.map((q) => Math.abs(u[0] * (q[1] - a[1]) - u[1] * (q[0] - a[0]))));
    // Along the line, A to E in order
    const along = p.map((q) => (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1]);
    if (along.some((v, k) => k > 0 && v <= along[k - 1])) {
      flag(i, 'the level letters are out of order');
    }
    worstLine = Math.max(worstLine, off);
    if (off > 3) flag(i, `the level letters are ${off.toFixed(1)} px off one straight line`);
    // The letters never line up with the files or the ranks as one axis:
    // near parallel and side by side, or one carrying on the other's line
    for (const [name, labels] of [
      ['files', row(f, 'file-')],
      ['ranks', row(f, 'rank-')],
    ]) {
      if (labels.some((s) => s.opacity < 0.5)) continue;
      const [r0, r1] = [labels[0].at, labels[labels.length - 1].at];
      const rl = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]) || 1;
      const v = [(r1[0] - r0[0]) / rl, (r1[1] - r0[1]) / rl];
      const angle = (Math.acos(Math.min(1, Math.abs(u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI;
      nearestParallel = Math.min(nearestParallel, angle);
      if (angle >= 20) continue;
      const span = (q) => (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1];
      const [s0, s1] = [span(r0), span(r1)].sort((x, y) => x - y);
      const shared = Math.min(s1, l) - Math.max(s0, 0);
      const mid = [(r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2];
      const across = Math.abs(u[0] * (mid[1] - a[1]) - u[1] * (mid[0] - a[0]));
      const h = INK_HEIGHT * shown(f, letters[0]).h;
      // (a like spacing: side by side, each letter level with a label)
      const pitch = l / (p.length - 1) / (rl / (labels.length - 1));
      if (across < 3 * h) {
        flag(i, `the level letters run on in line with the ${name} (${angle.toFixed(0)}° apart)`);
      } else if (shared > 0.25 * Math.min(l, rl) && pitch > 2 / 3 && pitch < 1.5) {
        // Inevitable near a square view from 35° to 75° up, where the row
        // running away from the camera stands up the screen like every
        // corner post, and allowed there only across the tower from it
        // (scene/labelSweep.test.ts)
        const side = (xs) => Math.sign(xs.reduce((m, x) => m + x, 0) / xs.length - f.centre[0]);
        const opposite = side(p.map((q) => q[0])) === -side(labels.map((q) => q.at[0]));
        const square =
          Math.abs(f.azimuth - 90 * Math.round(f.azimuth / 90)) <= 15 &&
          f.elevation >= 35 &&
          f.elevation <= 75;
        if (square && opposite) acrossSquare.add(i);
        else flag(i, `the level letters stand beside the ${name} (${angle.toFixed(0)}° apart)`);
      }
    }
    // No two labels showing overlap: each glyph's ink, from the table the
    // unit tests measure with (a faded file or rank is not read)
    const boxes = ids.map((id) => ({ id, ...shown(f, id) })).filter((b) => b.opacity >= 0.5);
    for (let x = 0; x < boxes.length; x++) {
      for (let y = x + 1; y < boxes.length; y++) {
        const [b, c] = [boxes[x], boxes[y]];
        const [bw, bh] = inkOf(b.id).map((k) => (k * b.h) / 2);
        const [cw, ch] = inkOf(c.id).map((k) => (k * c.h) / 2);
        const over = Math.min(
          bw + cw - Math.abs(b.at[0] - c.at[0]),
          bh + ch - Math.abs(b.at[1] - c.at[1]),
        );
        // Neighbouring letters may touch from overhead in an upright window
        const letterPair = b.id.startsWith('level-') && c.id.startsWith('level-');
        const slack = letterPair && f.elevation >= 88 && bands.height > bands.width ? 1 : 0;
        if (over > slack) flag(i, `${b.id} overlaps ${c.id} by ${over.toFixed(1)} px`);
      }
    }
  });
  // The tower's outline inside the window, clear of the HUD's bands
  const room = frames.map((f) => {
    const [x0, y0, x1, y1] = f.outline;
    return Math.min(x0, y0 - bands.top, bands.width - x1, bands.height - bands.bottom - y1);
  });
  room.forEach((m, i) => {
    if (m < 0) flag(i, `the tower runs ${(-m).toFixed(0)} px past the window's edge or a HUD band`);
  });
  const spread = (v) => Math.max(...v) - Math.min(...v);
  return {
    name,
    frames: frames.length,
    centre: {
      xRange: spread(cx),
      yRange: spread(cy),
      maxStep: Math.max(0, ...steps),
      maxKink: Math.max(0, ...kinks),
    },
    labels: { maxKink: worstLabel, letterLine: worstLine, nearestParallel },
    acrossSquare: acrossSquare.size,
    // Where: the azimuth turning, the elevation climbing
    letterSwitches: [...letterSwitches]
      .sort((a, b) => a - b)
      .map((i) =>
        turning ? `az ${frames[i].azimuth.toFixed(0)}°` : `el ${frames[i].elevation.toFixed(1)}°`,
      ),
    minRoom: Math.min(...room),
    flags,
  };
}

/**
 * --orbit: the camera turned slowly all the way round at several elevations,
 * then climbed from below the horizon to overhead and back down, to an MP4
 * and a contact sheet, with a jitter report (see the header).
 */
async function orbitReview(rec, seat) {
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
  const cdp = await rec.context().newCDPSession(rec);
  const step = Number(opt('orbit-step', 1));
  const elevations = opt('orbit-elevations', '-14,18,45,75,89.9').split(',').map(Number);
  const opening = await rec.evaluate(() => window.__show.measure());
  const a0 = Math.round(opening.azimuth);
  const segments = [
    ...elevations.map((e) => ({
      name: `orbit at ${e}°`,
      poses: range(a0, a0 + 360, step).map((a) => [a, e]),
      sheetEvery: 30,
    })),
    {
      name: `climb at ${a0}°`,
      poses: range(-14, 89.9, step / 2).map((e) => [a0, e]),
      sheetEvery: 15,
    },
    {
      name: `descent at ${a0 + 45}°`,
      poses: range(89.9, -14, step / 2).map((e) => [a0 + 45, e]),
      sheetEvery: 15,
    },
  ];
  // The HUD's bands for this window (the move card is off: its setting's default)
  const bands = await rec.evaluate(
    async ([width, height]) => {
      const { hudBands } = await import('/src/three/cameraFit.ts');
      return { width, height, ...hudBands(width, height, false) };
    },
    [WIDTH, HEIGHT],
  );
  const VIDEO = path.join(OUT, 'orbit.mp4');
  let ffmpeg = null;
  if (!STILLS) {
    ffmpeg = spawn(
      FFMPEG,
      [
        ...['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS)],
        ...['-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22'],
        ...['-pix_fmt', 'yuv420p', '-movflags', '+faststart', VIDEO],
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
  }
  const frame = async ([azimuth, elevation], draw) =>
    rec.evaluate(
      ({ azimuth, elevation, ms, draw }) => {
        window.__show.orbitAt(azimuth, elevation);
        if (draw) window.__vclock.step(ms);
        else window.__show.settle(1, ms, false);
        return window.__show.measure();
      },
      { azimuth, elevation, ms: 1000 / FPS, draw },
    );
  const capture = async () => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    if (!ffmpeg.stdin.write(Buffer.from(data, 'base64'))) {
      await new Promise((r) => ffmpeg.stdin.once('drain', r));
    }
  };
  const reports = [];
  const sheet = [];
  let last = null;
  for (const [s, segment] of segments.entries()) {
    const [first] = segment.poses;
    // Glide to where the segment starts (recorded, not measured), then let
    // any crossfade finish
    if (last) {
      for (const t of range(0, 1, 1 / 20).slice(1)) {
        const k = ease(t);
        await frame(
          [last[0] + (first[0] - last[0]) * k, last[1] + (first[1] - last[1]) * k],
          !STILLS,
        );
        if (ffmpeg) await capture();
      }
    }
    for (let i = 0; i < 12; i++) {
      await frame(first, !STILLS && i === 11);
      if (ffmpeg && i === 11) await capture();
    }
    const frames = [];
    let next = 0;
    for (const [i, pose] of segment.poses.entries()) {
      const travelled = Math.abs(
        segment.name.startsWith('orbit') ? pose[0] - first[0] : pose[1] - first[1],
      );
      const still = travelled >= next - 1e-6;
      const m = await frame(pose, !STILLS || still);
      frames.push(m);
      if (ffmpeg) await capture();
      if (still) {
        next += segment.sheetEvery;
        const file = path.join(OUT, `orbit-${s}-${String(i).padStart(4, '0')}.png`);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        sheet.push({ segment: s, file, azimuth: m.azimuth, elevation: m.elevation });
      }
    }
    last = segment.poses[segment.poses.length - 1];
    const report = jitter(segment.name, frames, bands);
    reports.push(report);
    console.log(
      `${elapsed()} ${segment.name}: centre moved ${report.centre.xRange.toFixed(1)} px across, ` +
        `${report.centre.yRange.toFixed(1)} px down (worst step ${report.centre.maxStep.toFixed(2)} px, ` +
        `kink ${report.centre.maxKink.toFixed(2)} px); letters ${report.labels.letterLine.toFixed(1)} px ` +
        `off a line at worst, ${report.letterSwitches.length} switch(es); ` +
        `${report.flags.length} flag(s)`,
    );
  }
  if (ffmpeg) {
    ffmpeg.stdin.end();
    await new Promise((r) => ffmpeg.on('close', r));
    console.log(VIDEO);
  }
  // The report, in full
  const lines = [`--orbit, ${seat}'s seat, ${WIDTH}x${HEIGHT}, ${step}° a frame`];
  for (const r of reports) {
    lines.push(
      '',
      `${r.name} (${r.frames} frames)`,
      `  centre: ${r.centre.xRange.toFixed(2)} px across, ${r.centre.yRange.toFixed(2)} px down; ` +
        `worst step ${r.centre.maxStep.toFixed(2)} px, worst kink ${r.centre.maxKink.toFixed(2)} px`,
      `  labels: worst kink ${r.labels.maxKink.toFixed(2)} px; letters at most ` +
        `${r.labels.letterLine.toFixed(1)} px off one line, at least ` +
        `${r.labels.nearestParallel.toFixed(0)}° off the files' or ranks' line (near-parallel ` +
        `across the tower near a square view in ${r.acrossSquare} frame(s)); letter switches at ` +
        `${r.letterSwitches.join(', ') || 'none'}`,
      `  tightest room round the tower: ${r.minRoom.toFixed(0)} px`,
      `  ${r.flags.length} flag(s)${r.flags.length ? ':' : ''}`,
      ...Object.entries(
        r.flags.reduce((kinds, f) => {
          // Grouped by kind: the flag without its pose, numbers or label names
          const kind = f
            .replace(/^.*?°: /, '')
            .replace(/\b(file|rank|level)-\w+(-\d)?/g, '$1')
            .replace(/-?\d[\d.]*/g, '#');
          kinds[kind] = (kinds[kind] ?? 0) + 1;
          return kinds;
        }, {}),
      ).map(([kind, n]) => `    ${n} × ${kind}`),
      ...(r.flags.length ? ['  first flags:'] : []),
      ...r.flags.slice(0, 40).map((f) => `    ${f}`),
      ...(r.flags.length > 40 ? [`    ... and ${r.flags.length - 40} more`] : []),
    );
  }
  const text = lines.join('\n');
  fs.writeFileSync(path.join(OUT, 'orbit-report.txt'), `${text}\n`);
  fs.writeFileSync(path.join(OUT, 'orbit-report.json'), JSON.stringify(reports, null, 2));
  console.log(`\n${text}\n`);
  await orbitSheet(rec.context(), segments, sheet, seat);
  console.log(`orbit took ${elapsed()}`);
}

/** The --orbit contact sheet: a row of stills per stretch of the recording. */
async function orbitSheet(context, segments, shots, seat) {
  const page = await context.newPage();
  const files = new Map();
  await page.route('http://review.local/**', (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    if (files.has(name)) return route.fulfill({ path: files.get(name) });
    return route.fulfill({ body: files.get('/html') ?? '', contentType: 'text/html' });
  });
  const thumb = Math.round((220 * WIDTH) / Math.max(WIDTH, HEIGHT));
  let html = `<h1>Orbit, ${seat}'s seat, ${WIDTH}x${HEIGHT}</h1>`;
  for (const [s, segment] of segments.entries()) {
    html += `<h2>${segment.name}</h2><div class="row">`;
    for (const shot of shots.filter((x) => x.segment === s)) {
      const name = path.basename(shot.file);
      files.set(name, shot.file);
      html += `<figure><img src="http://review.local/${name}" width="${thumb}"><figcaption>az ${shot.azimuth.toFixed(0)}° · el ${shot.elevation.toFixed(1)}°</figcaption></figure>`;
    }
    html += '</div>';
  }
  const style = `
    body { margin: 0; padding: 16px 20px; background: #111418; color: #e6eaf0;
      font: 13px/1.3 system-ui, sans-serif; }
    h1 { font-size: 20px; margin: 0 0 10px; }
    h2 { font-size: 15px; margin: 16px 0 6px; }
    .row { display: flex; flex-wrap: nowrap; gap: 6px; }
    figure { margin: 0; }
    figure img { display: block; border-radius: 3px; }
    figcaption { font-size: 11px; color: #aeb7c4; padding: 2px 1px 0; }`;
  files.set(
    '/html',
    `<!doctype html><meta charset="utf-8"><style>${style}</style><body>${html}</body>`,
  );
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('http://review.local/index.html');
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const width = await page.evaluate(() => document.body.scrollWidth);
  await page.setViewportSize({ width, height: 600 });
  const file = path.join(OUT, 'orbit-sheet.png');
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
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
    // The board's settings as the player would have saved them (only a change from the defaults)
    if (KNIGHT === 'arc') {
      await ctx.addInitScript(
        ([key, value]) => localStorage.setItem(key, value),
        [SETTINGS_KEY, JSON.stringify({ 'piece.knightMoves': 'arc' })],
      );
    }
  }
  const [pageA, pageB] = await Promise.all(contexts.map((c) => c.newPage()));
  for (const p of [pageA, pageB]) {
    p.on('pageerror', (e) => console.error(`[page] ${e.message}`));
    // A loaded machine can take well over Playwright's 30 s to start a game
    p.setDefaultTimeout(120000);
  }

  await pageA.goto(`${BASE}/`);
  await pageA.getByRole('button', { name: 'Start New Game' }).click();
  await pageA.waitForURL(/\/game\/[A-Z0-9]+/);
  await pageB.goto(pageA.url());
  await pageB.getByRole('button', { name: 'Join Game' }).click();
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => window.__show?.ready(), null, { timeout: 120000 });
  }

  const colorOf = (p) => p.getByTestId('seat').getAttribute('data-seat');
  const white = (await colorOf(pageA)) === 'white' ? pageA : pageB;
  const black = white === pageA ? pageB : pageA;
  if (ORBIT) {
    const seat = opt('seat', 'white') === 'black' ? 'black' : 'white';
    const rec = seat === 'white' ? white : black;
    // The other page is only there to take the seat; keep its renderer cheap
    await (rec === white ? black : white).setViewportSize({ width: 400, height: 300 });
    await rec.evaluate(() => document.fonts.ready);
    await rec.waitForTimeout(1500);
    await rec.evaluate(() => window.__vclock.enable());
    await orbitReview(rec, seat);
    await browser.close();
    return;
  }
  if (REVIEW) {
    for (const p of [white, black]) await p.evaluate(() => document.fonts.ready);
    await white.waitForTimeout(1500);
    for (const p of [white, black]) await p.evaluate(() => window.__vclock.enable());
    await review({ white, black });
    await browser.close();
    return;
  }
  // The recorded page: White's, or Black's for --interact --select-black
  const seat = INTERACT && opt('select-black') && !opt('select-white') ? 'black' : 'white';
  const rec = seat === 'white' ? white : black;
  const opp = rec === white ? black : white;
  // The opponent's page is only there to answer; keep its renderer cheap.
  await opp.setViewportSize({ width: 400, height: 300 });
  await rec.evaluate(() => document.fonts.ready);
  // Let the fonts and first frames settle in real time
  await rec.waitForTimeout(1500);
  await rec.evaluate(() => window.__vclock.enable());
  // The other page only types, so never draws
  if (INTERACT) await opp.evaluate(() => window.__vclock.enable());

  const cdp = await rec.context().newCDPSession(rec);
  if (flag('profile')) {
    // Where a frame's time goes: render (in the page, real clock) and capture.
    const renders = [];
    const captures = [];
    for (let i = 0; i < 20; i++) {
      renders.push(
        await rec.evaluate(() => {
          const t = Date.now();
          window.__r3fState.get().invalidate(); // the canvas renders on demand
          window.__vclock.step(1000 / 30);
          return Date.now() - t;
        }),
      );
      const t = Date.now();
      await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      captures.push(Date.now() - t);
    }
    const stats = await rec.evaluate(() => {
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
        renderMs: med(renders),
        captureMs: med(captures),
        ...stats,
      }),
    );
    await browser.close();
    return;
  }
  const VIDEO = path.join(OUT, INTERACT ? 'interact.mp4' : 'game.mp4');
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
        VIDEO,
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
    // --interact holds the seat's opening view
    if (INTERACT) return [0, 0, 1];
    const t = f / FPS;
    // Stills skip the opening swing and show the board from its opening view
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

  // --stills-fast draws only the frames it saves: the clock, the animations
  // and the camera still advance every frame, just without a picture.
  const step = async (capture = !STILLS, draw = !STILLS_FAST || capture) => {
    // The camera keeps its gentle sway through the mate: the app centres the
    // whole tower in the view, so leaning in on the king would crop the top
    // level (and him) off the frame
    const [yaw, pitch, zoom] = camera(frame);
    const pull = 0;
    await rec.evaluate(
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
        focus: null,
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
    const file = path.join(OUT, `${name}.png`);
    await rec.screenshot({ path: file, timeout: 120000 });
    console.log(file);
  };
  const locate = (zxy, kind) =>
    rec.evaluate(({ zxy, kind }) => window.__show.pixelFor(zxy, kind), { zxy, kind });
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
        await rec.mouse.move(cursor.x, cursor.y);
      }
      await step();
    }
    target = await locate(zxy, kind);
    if (!target) {
      const why = await rec.evaluate((z) => window.__show.explain(z), zxy);
      console.log(`no pixel reaches ${kind} ${zxy}, typing the move: ${JSON.stringify(why)}`);
      return false;
    }
    cursor = target;
    await rec.mouse.move(cursor.x, cursor.y);
    return true;
  };
  // The fallback for a square no ray reaches from the recorded view, and the
  // opponent's moves: played on the board by clicks (or typed, where no ray
  // reaches), as a player would
  const typeMove = playMove;
  const waitTurn = async (page, side) => {
    await page.waitForFunction((t) => window.__show.turnReached(t), side, {
      ...POLL,
      timeout: 60000,
    });
  };
  const finish = async () => {
    if (ffmpeg) {
      ffmpeg.stdin.end();
      await new Promise((r) => ffmpeg.on('close', r));
      console.log(VIDEO, `${frame} frames`);
    }
    await browser.close();
  };

  if (INTERACT) {
    await interact();
    await finish();
    return;
  }

  /** --interact: pointing and selecting, in beats, from one position (see the header). */
  async function interact() {
    const started = Date.now();
    const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
    const GLIDE = 0.5;
    // Frames that advance the clock unseen (moves playing out, the rehearsal)
    const unseen = (frames) =>
      rec.evaluate(({ n, ms }) => window.__show.settle(n, ms, false), {
        n: frames,
        ms: 1000 / FPS,
      });
    const shownKey = () =>
      rec.evaluate(() =>
        window.__show
          .destinations()
          .map((d) => d.zxy)
          .sort()
          .join(' '),
      );
    // A click that selects, switches or puts down: true once the destinations
    // on show have changed
    const clickAt = async (at) => {
      const before = await shownKey();
      await rec.mouse.click(at.x, at.y);
      return rec
        .waitForFunction(
          (b) =>
            window.__show
              .destinations()
              .map((d) => d.zxy)
              .sort()
              .join(' ') !== b,
          before,
          { ...POLL, timeout: 5000 },
        )
        .then(
          () => true,
          () => false,
        );
    };
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    // Of `dests` the pointer can reach, the nearest to `from` that is clear of
    // it (quiet ones first with `quietFirst`)
    const nearest = (dests, from, quietFirst = false) =>
      dests
        .filter((d) => d.px)
        .sort(
          (a, b) =>
            (quietFirst ? a.capture - b.capture : 0) ||
            (distance(a.px, from) < 40) - (distance(b.px, from) < 40) ||
            distance(a.px, from) - distance(b.px, from),
        )[0];

    // Tries P out off camera: selects it, finds a quiet and a capture
    // destination and another piece Q the pointer can reach, and one of Q's
    // destinations, putting each piece back down after.
    const rehearse = async (P, others) => {
      const pAt = await locate(P, 'piece');
      if (!pAt) return null;
      const rest = (await rec.evaluate((near) => window.__show.emptyPixel(near), pAt)) ?? {
        x: WIDTH - 30,
        y: HEIGHT / 2,
      };
      // True when the piece itself took the click (not the empty space)
      const putDown = async (zxy) => {
        const at = await locate(zxy, 'piece');
        if (at && (await clickAt(at))) return true;
        if (await clickAt(rest)) return false;
        throw new Error(`could not put ${zxy} back down`);
      };
      await rec.mouse.move(rest.x, rest.y);
      if (!(await clickAt(pAt))) return null;
      await unseen(2);
      const dests = await rec.evaluate(() => window.__show.destinations(true));
      const quiet = nearest(
        dests.filter((d) => !d.capture),
        pAt,
      );
      const capture = nearest(
        dests.filter((d) => d.capture),
        pAt,
      );
      // The side's other pieces the pointer reaches past P's destinations,
      // nearest P first
      const qs = [];
      if (quiet && capture) {
        const near = [];
        for (const { zxy } of others) {
          if (zxy === P) continue;
          const at = await rec.evaluate((z) => window.__show.screenOf(z), zxy);
          if (at) near.push({ zxy, d: distance(at, pAt) });
        }
        near.sort((a, b) => (a.d < 70) - (b.d < 70) || a.d - b.d);
        for (const { zxy } of near) {
          const at = await locate(zxy, 'piece');
          if (at && distance(at, pAt) >= 70) qs.push(zxy);
          if (qs.length >= 5) break;
        }
      }
      await putDown(P);
      if (!quiet || !capture) return null;
      for (const Q of qs) {
        const at = await locate(Q, 'piece');
        if (!at || !(await clickAt(at))) continue;
        await unseen(2);
        const qDest = nearest(await rec.evaluate(() => window.__show.destinations(true)), at, true);
        if ((await putDown(Q)) && qDest) {
          return { P, quiet: quiet.zxy, capture: capture.zxy, Q, qDest: qDest.zxy, rest };
        }
      }
      return null;
    };

    // The scripted game, played in unseen, up to a position that shows it all
    await rec.evaluate(([y, p, z]) => window.__show.orbit(y, p, z, null, 0), camera(0));
    const toMove = seat;
    let plan = null;
    for (let i = 0; i < GAME.length && !plan; i++) {
      const [from, to] = GAME[i].split('-');
      const next = i % 2 === 0 ? 'black' : 'white';
      await typeMove(i % 2 === 0 ? white : black, from, to);
      for (const p of [rec, opp]) await waitTurn(p, next);
      await unseen(60);
      const plies = i + 1;
      if (next !== toMove || !(plies >= 3 || GAME.length - plies < 2)) continue;
      const forced = opt(`select-${seat}`);
      let candidates = forced ? [{ zxy: forced }] : [];
      let others = [];
      try {
        if (!forced) candidates = await rec.evaluate((c) => window.__show.richPieces(c), seat);
        others = await rec.evaluate((c) => window.__show.richPieces(c, true), seat);
      } catch (e) {
        throw new Error(`no rules engine in the page (${e.message.split('\n')[0]})`);
      }
      for (const { zxy } of candidates) {
        plan = await rehearse(zxy, others);
        if (plan) break;
      }
    }
    if (!plan) {
      throw new Error(
        `no position in the scripted game has a ${seat} piece whose quiet and capture ` +
          `destinations the pointer can reach from this view, and another piece to switch ` +
          `to; try --select-${seat} <zxy> or --pose`,
      );
    }
    const name = async (zxy) =>
      `${(await rec.evaluate((z) => window.__show.pieceAt(z), zxy)) ?? ''} ${zxy}`.trim();
    const { P, quiet, capture, Q, qDest, rest } = plan;
    const [pName, qName, victim] = [await name(P), await name(Q), await name(capture)];
    console.log(
      `${elapsed()} ${seat} to move: ${pName} (quiet ${quiet}, takes ${victim}), then ${qName} (${qDest})`,
    );

    // Everything at rest, the pointer on empty space
    cursor = { ...rest };
    press = 0;
    await rec.mouse.move(cursor.x, cursor.y);
    await unseen(60);

    // The pointer straight to a fixed page pixel
    const glidePixel = async (to, seconds = GLIDE) => {
      const from = { ...cursor };
      const n = Math.max(1, Math.round(seconds * FPS));
      for (let i = 1; i <= n; i++) {
        const k = ease(i / n);
        cursor = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
        await rec.mouse.move(cursor.x, cursor.y);
        await step();
      }
    };
    const click = async (what) => {
      await hold(0.25);
      if (!(await clickAt(cursor))) console.log(`clicking ${what} changed nothing`);
      press = 1;
      // The camera controls capture the pointer while it is pressed, and the
      // page takes it back over the board only when it next moves; a hand is
      // never that still, so twitch it a pixel, unseen, to keep the hover
      await rec.mouse.move(cursor.x + 1, cursor.y);
      await rec.mouse.move(cursor.x, cursor.y);
    };
    const snap = async (file) => {
      // A video's last frame is already drawn; stills draw it now
      if (STILLS) await step(false, true);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      console.log(file);
    };
    let n = 0;
    const beat = async (id, label, act, seconds = 1) => {
      n++;
      await rec.evaluate((t) => window.__show.caption(t), `${n} · ${label}`);
      await act();
      await hold(seconds);
      await snap(path.join(OUT, `interact-${String(n).padStart(2, '0')}-${id}.png`));
    };

    await beat('rest', 'rest', async () => {});
    await beat('hover', `hover ${pName}`, () => glideTo(P, 'piece', GLIDE));
    await beat('unhover', 'unhover', () => glidePixel(rest));
    await beat(
      'select',
      `select ${pName}`,
      async () => {
        if (await glideTo(P, 'piece', GLIDE)) await click(P);
      },
      1.2,
    );
    await beat('quiet', `quiet destination ${quiet}`, () => glideTo(quiet, 'cell', GLIDE));
    await beat('capture', `capture ${victim}`, () => glideTo(capture, 'cell', GLIDE));
    await beat(
      'switch',
      `switch to ${qName}`,
      async () => {
        if (await glideTo(Q, 'piece', GLIDE)) await click(Q);
      },
      1.2,
    );
    await beat('destination', `destination ${qDest}`, () => glideTo(qDest, 'cell', GLIDE));
    await beat('deselect', `deselect ${qName}`, async () => {
      if (await glideTo(Q, 'piece', GLIDE)) await click(Q);
    });
    await beat('rest', 'rest', () => glidePixel(rest));
    console.log(`interact took ${elapsed()}`);
  }

  await hold(STILLS ? 0.2 : PACE.intro);
  await still('start');

  for (let i = 0; i < Math.min(PLIES, GAME.length); i++) {
    const [from, to] = GAME[i].split('-');
    const whiteMoves = i % 2 === 0;
    const next = whiteMoves ? 'black' : 'white';
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
    if ((await white.evaluate(() => window.__show.turn())).check) await still('check');
  }

  if (PLIES >= GAME.length) {
    // The mate plays out, then the result card (the app holds it back until
    // the mate's animation is over).
    await hold(PACE.mate);
    await still('mate');
    await hold(PACE.result);
    await still('result');
    await hold(PACE.tail);
  } else {
    await hold(0.6);
    await still('end');
  }

  await finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
