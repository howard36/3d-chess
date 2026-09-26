import { test, expect as baseExpect, type Page, type Browser, type Locator } from '@playwright/test';
import {
  socketTap, item, record, press, pressAt, pixelOf, projectCell, boardState, cameraInfo, settle, pieceMap, highlighted,
  turnText, listText, dropConnection, releaseConnection, delayAnswersAfterOpen, playOn, drag, waitForBoard, getPlayerColor,
  rawSend, LINE20,
} from './vh';
import { fitDistance } from '../../../client/src/three/cameraFit';
import { Vector3 } from 'three';
import net from 'node:net';
import os from 'node:os';
import { playLine, MATE_LINE, PROMO_LINE } from './line';
import { fromZXY, toZXY } from '../../../client/src/engine/coords';
import { toWorld, CELLS } from '../../../client/src/three/layout';
// Not serial: a failure outside an item must not skip the later games.
test.setTimeout(300_000);
const expect = baseExpect.configure({ timeout: 12_000 });
type Seat = 'white' | 'black';
type G = { white: Page; black: Page; close: () => Promise<unknown> };

// ---------------------------------------------------------------------------
// Local helpers (vh.ts is shared and must not change)

/** Records every message the page sends on the game socket, as window.__sent. */
const sendTap = () => {
  const w = window as any;
  w.__sent = [];
  const orig = WebSocket.prototype.send;
  WebSocket.prototype.send = function (this: WebSocket, d: any) {
    if (String(this.url).includes(':8000/ws')) { try { w.__sent.push(JSON.parse(String(d))); } catch { /* not JSON */ } }
    return orig.call(this, d);
  };
};
/** startTappedGame, plus the send recorder. */
async function startG(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}): Promise<G> {
  const contexts = [await browser.newContext(opts), await browser.newContext(opts)];
  for (const c of contexts) { await c.addInitScript(socketTap); await c.addInitScript(sendTap); }
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  await a.goto('/');
  await a.getByRole('button', { name: 'Start New Game' }).click();
  await a.waitForURL(/\/game\/[A-Z0-9]+/);
  await b.goto(a.url());
  await b.getByRole('button', { name: 'Join Game' }).click();
  await waitForBoard(a); await waitForBoard(b);
  const seats = {} as Record<Seat, Page>;
  for (const p of [a, b]) seats[await getPlayerColor(p)] = p;
  return { white: seats.white, black: seats.black, close: () => Promise.all(contexts.map((c) => c.close())) };
}
const board = (p: Page) => p.waitForFunction(() => !!(window as any).__r3fState);
const sentMoves = (p: Page) => p.evaluate(() => ((window as any).__sent || []).filter((m: any) => m.type === 'move').length);
const box = (p: Page) => p.locator('#typed-move');
const moveBtn = (p: Page) => p.locator('form[aria-label="Type a move"] button[type=submit]');
const problem = (p: Page) => p.locator('#typed-move-problem');
const turn = (p: Page) => p.getByTestId('turn-indicator');
const dialog = (p: Page) => p.locator('[role=dialog]');
const focusDesc = (p: Page) => p.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return 'BODY';
  return a.id ? `#${a.id}` : `${a.tagName}:${(a.textContent || a.getAttribute('aria-label') || '').trim()}`;
});
const kingGlow = (p: Page, color: string) => p.evaluate((c) => { let e = ''; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.piece?.type === 'King' && o.userData.piece.color === c) e = String(o.userData.emissive); }); return e; }, color);
/** Cells whose piece carries the given emissive (the selection glow is #6b4a00). */
async function glowing(p: Page, seat: Seat, emissive = '#6b4a00') {
  const raw = await p.evaluate((em) => { const out: number[][] = []; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.piece && String(o.userData.emissive) === em && !o.parent?.userData?.ghostPiece) out.push(o.position.toArray()); }); return out; }, emissive);
  return raw.map((q) => cellAt(q, seat));
}
function cellAt(q: number[], seat: Seat) {
  const c = CELLS.find((c) => { const w = toWorld(c, seat); return Math.abs(w[0] - q[0]) < 1e-6 && Math.abs(w[1] - q[1]) < 1e-6 && Math.abs(w[2] - q[2]) < 1e-6; });
  return c ? toZXY(c) : '?';
}
/** The last-move (teal) cells as [from..., to...]. */
async function lastCells(p: Page, seat: Seat) {
  const raw = await p.evaluate(() => { const out: { k: string; q: number[] }[] = []; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.lastMoveFrom) out.push({ k: 'from', q: o.position.toArray() }); if (o.userData?.lastMoveTo) out.push({ k: 'to', q: o.position.toArray() }); }); return out; });
  return raw.map((r) => `${r.k}:${cellAt(r.q, seat)}`).sort();
}
/** Starts sampling the scene for glides (moving) and fading ghosts, every 15 ms. */
async function watchAnim(p: Page) {
  await p.evaluate(() => {
    const w = window as any;
    clearInterval(w.__animT);
    w.__anim = { glides: 0, moving: 0, ghosts: 0 };
    w.__animT = setInterval(() => {
      const st = w.__r3fState; if (!st) return;
      st.get().scene.traverse((o: any) => {
        const u = o.userData || {};
        if (u.moveGlide) { w.__anim.glides++; if (o.position.lengthSq() > 1e-6) w.__anim.moving++; }
        if (u.ghostPiece) w.__anim.ghosts++;
      });
    }, 15);
  });
}
async function readAnim(p: Page): Promise<{ glides: number; moving: number; ghosts: number }> {
  return p.evaluate(() => { const w = window as any; clearInterval(w.__animT); return w.__anim; });
}
/**
 * A page pixel over the canvas, as near as possible to `zxy`'s projection, whose ray crosses
 * cell boxes only: no piece and no destination anywhere along it (r3f hands a click to every
 * hit along the ray until one stops it, so a piece or destination behind an empty cell would
 * take the click).
 */
async function emptyPixel(p: Page, zxy: string, seat: Seat) {
  const world = toWorld(fromZXY(zxy), seat);
  const r = await p.evaluate(([wx, wy, wz]) => {
    const { camera, size, scene, raycaster } = (window as any).__r3fState.get();
    camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const canvas = document.querySelector('canvas')!; const rect = canvas.getBoundingClientRect();
    const c = new V(wx, wy, wz).project(camera);
    const cx = (c.x * 0.5 + 0.5) * size.width, cy = (-c.y * 0.5 + 0.5) * size.height;
    const ok = (px: number, py: number) => {
      if (document.elementFromPoint(rect.left + px, rect.top + py) !== canvas) return false;
      raycaster.setFromCamera({ x: (px / size.width) * 2 - 1, y: -(py / size.height) * 2 + 1 }, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      let cubes = 0;
      for (const h of hits) {
        for (let o = h.object; o; o = o.parent) {
          if (o.userData.piece || o.userData.ghostPiece) return false;
          if (o.userData.cube) { if (o.userData.highlight) return false; cubes++; break; }
        }
      }
      return cubes > 0;
    };
    for (let rad = 0; rad < 400; rad += 6) {
      const n = Math.max(1, Math.round((2 * Math.PI * rad) / 6));
      for (let i = 0; i < n; i++) {
        const px = cx + rad * Math.cos((2 * Math.PI * i) / n), py = cy + rad * Math.sin((2 * Math.PI * i) / n);
        if (px < 0 || py < 0 || px > size.width || py > size.height) continue;
        if (ok(px, py)) return { x: rect.left + px, y: rect.top + py };
      }
    }
    return null;
  }, world);
  if (!r) throw new Error(`no empty pixel near ${zxy}`);
  return r;
}
/** A pixel over the piece standing on `zxy` (some ray hit is that piece's mesh); reports what the first interactive hit is. */
async function piecePixel(p: Page, zxy: string, seat: Seat) {
  const world = toWorld(fromZXY(zxy), seat);
  const r = await p.evaluate(([wx, wy, wz]) => {
    const { camera, size, scene, raycaster } = (window as any).__r3fState.get();
    camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const canvas = document.querySelector('canvas')!; const rect = canvas.getBoundingClientRect();
    const near = (o: any) => Math.abs(o.position.x - wx) < 1e-6 && Math.abs(o.position.y - wy) < 1e-6 && Math.abs(o.position.z - wz) < 1e-6;
    for (const dy of [-0.2, -0.1, 0, -0.3]) for (const dx of [0, 0.08, -0.08]) {
      const v = new V(wx + dx, wy + dy, wz).project(camera);
      raycaster.setFromCamera({ x: v.x, y: v.y }, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      let first: string | null = null; let overPiece = false;
      for (const h of hits) {
        for (let o = h.object; o; o = o.parent) {
          if (o.userData.piece || o.userData.cube) {
            if (o.userData.cube && !o.userData.highlight) break; // no handler of its own: the click passes on
            const kind = o.userData.piece ? 'piece' : 'destination cell';
            if (!first) first = near(o) ? kind : 'other';
            if (o.userData.piece && near(o)) overPiece = true;
            break;
          }
        }
      }
      if (!overPiece || first === 'other' || !first) continue;
      const px = rect.left + (v.x * 0.5 + 0.5) * size.width, py = rect.top + (-v.y * 0.5 + 0.5) * size.height;
      if (document.elementFromPoint(px, py) === canvas) return { x: px, y: py, first };
    }
    return null;
  }, world);
  if (!r) throw new Error(`no pixel over the piece on ${zxy}`);
  return r;
}
async function clearSelection(p: Page, seat: Seat) {
  await pressAt(p, await emptyPixel(p, 'Cc3', seat)); await p.waitForTimeout(300);
  if ((await boardState(p)).selectionRings !== 0) throw new Error('could not clear the selection');
}
const camDir = (c: { pos: number[]; target: number[] | null }) => { const t = c.target ?? [0, 0, 0]; const d = c.pos.map((v, i) => v - t[i]); const n = Math.hypot(...d); return d.map((v) => v / n); };
const camMoved = (a: any, b: any) => Math.hypot(...a.pos.map((v: number, i: number) => v - b.pos[i])) > 1e-3 || (a.target && Math.hypot(...a.target.map((v: number, i: number) => v - b.target[i])) > 1e-3);
async function openPromotion(p: Page) {
  await press(p, 'Da4', 'white');
  await expect.poll(() => highlighted(p, 'white')).toContain('Ea5');
  await press(p, 'Ea5', 'white');
  await expect(p.getByRole('dialog', { name: 'Promote to' })).toBeVisible();
  await p.waitForTimeout(250);
}


// ---------------------------------------------------------------------------
// Helpers for the page layout and the cross-cutting checks

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
const fmt = (b: Box) => `x ${b.x.toFixed(0)}..${(b.x + b.width).toFixed(0)}, y ${b.y.toFixed(0)}..${(b.y + b.height).toFixed(0)}`;
async function bbox(l: Locator): Promise<Box> { const r = await l.boundingBox(); if (!r) throw new Error('element has no box'); return r; }
const seatLabel = (p: Page) => p.locator('text=/You are playing as/');
const alertWith = (p: Page, text: string) => p.locator('[role=alert]').filter({ hasText: text });
/** Puts "Error: Already in a game" in the page's banner: a second create_game on its connection. */
async function provokeError(p: Page) {
  await rawSend(p, { type: 'create_game' });
  await expect(alertWith(p, 'Already in a game')).toBeVisible();
}
/** Whether the point at the centre of `b` belongs to a dialog (its backdrop or panel) rather than to what is drawn there. */
const coveredByDialog = (p: Page, b: Box) => p.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role=dialog],[role=alertdialog]'), [b.x + b.width / 2, b.y + b.height / 2]);
/** The 8 corners of the lattice's bounding box (half extent 2.7), projected to page pixels. */
async function corners(p: Page) {
  return p.evaluate(() => {
    const { camera, size } = (window as any).__r3fState.get();
    camera.updateMatrixWorld();
    const V = camera.position.constructor;
    const rect = document.querySelector('canvas')!.getBoundingClientRect();
    const out: { x: number; y: number }[] = [];
    for (const x of [-2.7, 2.7]) for (const y of [-2.7, 2.7]) for (const z of [-2.7, 2.7]) {
      const v = new V(x, y, z).project(camera);
      out.push({ x: rect.left + (v.x * 0.5 + 0.5) * size.width, y: rect.top + (-v.y * 0.5 + 0.5) * size.height });
    }
    return out;
  });
}
const extent = (cs: { x: number; y: number }[]) => ({ minX: Math.min(...cs.map((c) => c.x)), maxX: Math.max(...cs.map((c) => c.x)), minY: Math.min(...cs.map((c) => c.y)), maxY: Math.max(...cs.map((c) => c.y)) });
const angleDeg = (a: number[], b: number[]) => (Math.acos(Math.min(1, a.reduce((s, v, i) => s + v * b[i], 0))) * 180) / Math.PI;
async function tabSeq(p: Page, n: number, shift = false) {
  const seq: string[] = [];
  for (let i = 0; i < n; i++) { await p.keyboard.press(shift ? 'Shift+Tab' : 'Tab'); seq.push(await focusDesc(p)); }
  return seq;
}
async function newTapped(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const c = await browser.newContext(opts); await c.addInitScript(socketTap); await c.addInitScript(sendTap); return c.newPage();
}
let desktopBoardWidth = 0;

// ---------------------------------------------------------------------------
// game-page: seat, turn, list, banner at desktop size (1280 x 720)

test('game page: desktop', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white; let b = g.black;
  await item('SEAT-01', async () => {
    await expect(w.getByText('You are playing as white.')).toBeVisible();
    await expect(b.getByText('You are playing as black.')).toBeVisible();
  });
  await item('SEAT-05', async () => {
    const pres = w.getByTestId('opponent-presence');
    await expect(pres).toHaveText('Opponent: online');
    expect(await pres.getAttribute('role')).toBe('status');
    await expect(w.getByRole('status').filter({ hasText: 'Opponent: online' })).toHaveCount(1);
    const panelRole = await pres.evaluate((e) => e.parentElement!.getAttribute('role'));
    expect(panelRole).toBeNull();
    return 'presence line role=status; the panel holding "You are playing as white." has no role';
  });
  await item('TURN-03', async () => {
    const t = turn(w);
    expect(await t.getAttribute('role')).toBe('status');
    expect(await t.getAttribute('aria-live')).toBe('polite');
    await expect(w.getByRole('status').filter({ hasText: 'White to move' })).toHaveCount(1);
  });
  await item('A11Y-05', async () => {
    const name = (c: string) => `The 3D board, ${c} side nearest. Pieces are selected and moved with a pointer; to play from the keyboard, type moves in the move box.`;
    await expect(w.getByRole('img', { name: name('white'), exact: true })).toHaveCount(1);
    await expect(b.getByRole('img', { name: name('black'), exact: true })).toHaveCount(1);
  });
  await item('SEAT-04', async () => {
    const lb = await bbox(seatLabel(w));
    const start = { x: lb.x + 20, y: lb.y + 18 };
    const under = await w.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [start.x, start.y]);
    const c0 = await cameraInfo(w);
    await drag(w, start, 100, 0); await settle(w);
    const moved = camMoved(c0, await cameraInfo(w));
    const selectedText = await w.evaluate(() => String(window.getSelection() ?? ''));
    await w.evaluate(() => { const x = window as any; x.__ctx = []; window.addEventListener('contextmenu', (e) => x.__ctx.push(e.defaultPrevented)); });
    await w.mouse.click(start.x, start.y, { button: 'right' }); await w.waitForTimeout(300);
    const ctx: boolean[] = await w.evaluate(() => (window as any).__ctx);
    expect(moved).toBeTruthy(); expect(selectedText).toBe('');
    expect(ctx.every(Boolean)).toBe(true);
    return `element under the label's text: <${under}>; drag orbited, no text selected; right-click: ${ctx.length} contextmenu event(s), all default-prevented`;
  });
  { const e = extent(await corners(b)); desktopBoardWidth = e.maxX - e.minX; }
  await item('SEAT-02', async () => {
    const ctx = b.context(); const u = b.url();
    await b.close();
    await expect(w.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    const nb = await ctx.newPage(); await nb.goto(u); await board(nb);
    await expect(w.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    b = nb;
  });
  const G2 = { white: w, black: b };
  await item('LIST-01', async () => {
    const before = await G2.white.getByTestId('move-list').count();
    await playLine(G2 as any, ['Ab2-Ab3', 'Ed4-Ed3']);
    const rows = await w.getByTestId('move-list').locator('li').count();
    const txt = await w.getByTestId('move-list').innerText();
    expect(before).toBe(0); expect(rows).toBe(1);
    expect(txt).toBe('1. Ab2–Ab3 Ed4–Ed3');
  });
  await item('LIST-02', async () => {
    const rendered = await w.getByTestId('move-list').innerText();
    const dom = await w.getByTestId('move-list').textContent();
    expect(rendered).toBe('1. Ab2–Ab3 Ed4–Ed3');
    return `rendered ${JSON.stringify(rendered)} (the DOM text is ${JSON.stringify(dom)}; white-space collapsing shows one space)`;
  });
  await item('TURN-01', async () => {
    await playOn(w, 'white', 'Bb2', 'Bb3');
    await expect(turn(w)).toHaveText('Black to move'); await expect(turn(b)).toHaveText('Black to move');
    expect((await pieceMap(b, 'black'))['Bb3']).toBe('white Pawn');
  });
  await item('BANNER-02', async () => {
    await playOn(b, 'black', 'Ec4', 'Ec3'); await expect(turn(w)).toHaveText('White to move');
    // MOVE-07's double click
    await press(w, 'Bc2', 'white');
    await expect.poll(() => highlighted(w, 'white')).toContain('Bc3');
    const d = await pixelOf(w, 'Bc3', 'white');
    await w.mouse.click(d.x, d.y, { clickCount: 2, delay: 0 });
    await expect(alertWith(w, 'Not your turn')).toBeVisible();
    await expect(turn(b)).toHaveText('Black to move');
    await playOn(b, 'black', 'Eb4', 'Eb3'); await expect(turn(w)).toHaveText('White to move');
    await playOn(w, 'white', 'Ba2', 'Ba3'); await expect(turn(b)).toHaveText('Black to move');
    await w.waitForTimeout(500);
    await expect(alertWith(w, 'Not your turn')).toBeVisible();
    return `banner after both moves: ${JSON.stringify(await w.locator('[role=alert]').allTextContents())}`;
  });
  await item('A11Y-04', async () => {
    const banner = w.getByRole('alert');
    await expect(banner).toHaveCount(1);
    await expect(banner).toContainText('Error: Not your turn');
    const p = await newTapped(browser); await p.goto('/');
    await expect(p.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    await p.evaluate(() => { const x = window as any; x.__blockSockets = true; for (const s of x.__sockets) s.close(); });
    await expect(p.getByRole('status')).toHaveText(/Reconnecting to server…|Connecting to server…/);
    const st = await p.getByRole('status').textContent();
    await p.context().close();
    return `start screen with the server unreachable (the page's connection held down in-page, rather than stopping the shared server): status "${st}" role=status; game page banner role=alert`;
  });
  await item('SIZE-05', async () => {
    await b.bringToFront();
    const c0 = await cameraInfo(b);
    await drag(b, { x: 200, y: 400 }, 200, 0); await settle(b);
    const c1 = await cameraInfo(b);
    await b.mouse.move(640, 400);
    for (let i = 0; i < 5; i++) { await b.mouse.wheel(0, -100); await b.waitForTimeout(150); }
    await settle(b);
    const c2 = await cameraInfo(b);
    await b.setViewportSize({ width: 1000, height: 720 });
    await b.waitForTimeout(800); await settle(b);
    const c3 = await cameraInfo(b);
    const aspect = await b.evaluate(() => (window as any).__r3fState.get().camera.aspect);
    const expected = fitDistance(new Vector3(...camDir(c3)), 1000 / 720, 40);
    const ang = angleDeg(camDir(c1), camDir(c3));
    const note = `orbited ${angleDeg(camDir(c0), camDir(c1)).toFixed(1)}°; zoomed ${c1.dist!.toFixed(2)} -> ${c2.dist!.toFixed(2)}; after resize: ${c3.dist!.toFixed(2)} from the centre (fitted ${expected.toFixed(2)}), direction ${ang.toFixed(2)}° from the orbited one, aspect ${aspect.toFixed(3)}`;
    expect(angleDeg(camDir(c0), camDir(c1)), note).toBeGreaterThan(5);
    expect(c1.dist! - c2.dist!, note).toBeGreaterThan(0.5);
    expect(ang, note).toBeLessThan(0.5);
    expect(Math.abs(c3.dist! - expected), note).toBeLessThan(0.05);
    expect(Math.abs(c3.dist! - 14), note).toBeLessThan(1);
    return note;
  });
  await item('SIZE-04', async () => {
    await w.bringToFront();
    await w.setViewportSize({ width: 800, height: 900 });
    await w.waitForTimeout(800); await settle(w);
    const c = await bbox(w.locator('canvas'));
    const aspect = await w.evaluate(() => (window as any).__r3fState.get().camera.aspect);
    const e = extent(await corners(w));
    const note = `canvas ${c.width.toFixed(0)}x${c.height.toFixed(0)}, camera aspect ${aspect.toFixed(3)} (800/900 = 0.889); lattice corners x ${e.minX.toFixed(0)}..${e.maxX.toFixed(0)}, y ${e.minY.toFixed(0)}..${e.maxY.toFixed(0)}`;
    expect(Math.round(c.width), note).toBe(800); expect(Math.round(c.height), note).toBe(900);
    expect(Math.abs(aspect - 800 / 900), note).toBeLessThan(0.01);
    expect(e.minX, note).toBeGreaterThan(0); expect(e.maxX, note).toBeLessThan(800);
    expect(e.minY, note).toBeGreaterThan(0); expect(e.maxY, note).toBeLessThan(900);
    return note;
  });
  await g.close(); await b.context().close().catch(() => {});
});

test('game page: long list', async ({ browser }) => {
  const h = await startG(browser);
  await item('LIST-03', async () => {
    await playLine(h, [...LINE20, ...LINE20.slice(0, 8)]);
    const vp = h.white.viewportSize()!;
    const bx = await bbox(h.white.getByTestId('move-list'));
    const sc = await h.white.getByTestId('move-list').evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
    await h.white.getByTestId('move-list').evaluate((el) => { el.scrollTop = 0; });
    await playLine(h, ['Ab1-Aa3'], 'white');
    await h.white.waitForTimeout(400);
    const sc2 = await h.white.getByTestId('move-list').evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
    expect(bx.height).toBeLessThanOrEqual(288.5);
    expect(sc.max).toBeGreaterThan(0); expect(Math.abs(sc2.top - sc2.max)).toBeLessThan(2);
    return `28 moves: list ${bx.height.toFixed(0)} px tall in a ${vp.height} px window; after scrolling to the top, one more move put it back at the bottom`;
  });
  await item('LIST-04', async () => {
    const l = h.white.getByTestId('move-list');
    const bx = await bbox(l);
    await l.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const c0 = await cameraInfo(h.white);
    const s0 = await l.evaluate((el) => el.scrollTop);
    await h.white.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await h.white.mouse.wheel(0, -200); await h.white.waitForTimeout(700);
    const s1 = await l.evaluate((el) => el.scrollTop);
    expect(s1).toBeLessThan(s0); expect((await cameraInfo(h.white)).pos).toEqual(c0.pos);
  });
  await h.close();
});

test('banner: game full', async ({ browser }) => {
  const g = await startG(browser);
  const z = await newTapped(browser);
  await item('BANNER-01', async () => {
    await z.goto(g.white.url());
    await z.getByRole('button', { name: 'Join Game' }).click();
    await expect(z.getByRole('alert')).toHaveText('Error: Game full✕');
    await z.waitForTimeout(3000);
    await expect(z.getByRole('alert')).toHaveText('Error: Game full✕');
    await z.getByRole('button', { name: 'Dismiss error' }).click();
    await expect(z.getByRole('alert')).toHaveCount(0);
    await z.getByRole('button', { name: 'Join Game' }).click();
    await expect(z.getByRole('alert')).toHaveText('Error: Game full✕');
  });
  await z.context().close(); await g.close();
});

// ---------------------------------------------------------------------------
// narrow window (375 x 667)

test('narrow window', async ({ browser }) => {
  const n = await startG(browser, { viewport: { width: 375, height: 667 } });
  const w = n.white;
  await item('SEAT-03', async () => {
    const a = await bbox(seatLabel(w)); const t = await bbox(turn(w));
    await w.screenshot({ path: 'test-results/narrow-top.png' });
    const lines = await seatLabel(w).evaluate((el) => { const r = document.createRange(); r.setStartBefore(el.firstChild!); const pres = el.querySelector('[data-testid=opponent-presence]'); if (pres) r.setEndBefore(pres); else r.setEndAfter(el.lastChild!); const ys = new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))); return ys.size; });
    const note = `turn indicator ${fmt(t)}; seat label ${fmt(a)}, "You are playing as white." on ${lines} line(s)`;
    expect(Math.abs(t.x + t.width / 2 - 187.5), note).toBeLessThan(3);
    expect(a.y, note).toBeGreaterThanOrEqual(t.y + t.height);
    expect(Math.abs(a.y - 60), note).toBeLessThan(12);
    expect(a.x + a.width, note).toBeLessThanOrEqual(187.5);
    expect(lines, note).toBeGreaterThan(1);
    expect(overlaps(a, t), note).toBe(false);
    return note;
  });
  await item('TURN-02', async () => {
    const t = await bbox(turn(w)); const a = await bbox(seatLabel(w));
    const note = `turn indicator ${fmt(t)} (height ${t.height.toFixed(0)}); seat label top ${a.y.toFixed(0)}`;
    expect(Math.abs(t.x + t.width / 2 - 187.5), note).toBeLessThan(3);
    expect(Math.abs(t.y - 10), note).toBeLessThan(2);
    expect(t.height, note).toBeGreaterThan(35); expect(t.height, note).toBeLessThan(50);
    expect(a.y, note).toBeGreaterThanOrEqual(t.y + t.height);
    return note;
  });
  await item('SIZE-01', async () => {
    const e = extent(await corners(w));
    const width = e.maxX - e.minX;
    const note = `lattice corners x ${e.minX.toFixed(0)}..${e.maxX.toFixed(0)}, y ${e.minY.toFixed(0)}..${e.maxY.toFixed(0)} in 375x667; board ${width.toFixed(0)} px wide vs ${desktopBoardWidth.toFixed(0)} px at 1280x720`;
    expect(e.minX, note).toBeGreaterThan(0); expect(e.maxX, note).toBeLessThan(375);
    expect(e.minY, note).toBeGreaterThan(20); expect(e.maxY, note).toBeLessThan(647);
    if (desktopBoardWidth) expect(width, note).toBeLessThan(desktopBoardWidth);
    await w.screenshot({ path: 'test-results/narrow-board.png' });
    return note;
  });
  await playLine(n, ['Ab2-Ab3', 'Ed4-Ed3', 'Bb2-Bb3', 'Eb4-Eb3']);
  await provokeError(w);
  const bottom = async () => ({ e: await bbox(w.getByRole('alert')), m: await bbox(w.locator('form[aria-label="Type a move"]')), l: await bbox(w.getByTestId('move-list')) });
  await item('LIST-05', async () => {
    const { e, m, l } = await bottom();
    await w.screenshot({ path: 'test-results/narrow-bottom.png' });
    const note = `banner ${fmt(e)}; move box ${fmt(m)}; list ${fmt(l)}`;
    expect(e.y + e.height, note).toBeLessThanOrEqual(Math.min(m.y, l.y));
    expect(m.x + m.width, note).toBeLessThanOrEqual(l.x);
    expect(m.x + m.width, note).toBeLessThanOrEqual(187.5 + 1); expect(l.x, note).toBeGreaterThanOrEqual(187.5 - 1);
    expect(overlaps(e, m) || overlaps(e, l) || overlaps(m, l), note).toBe(false);
    return note;
  });
  await item('BANNER-06', async () => {
    const { e, m, l } = await bottom();
    const note = `banner ${fmt(e)}, centre ${(e.x + e.width / 2).toFixed(1)}; gap to the row below ${(Math.min(m.y, l.y) - (e.y + e.height)).toFixed(0)} px`;
    expect(Math.abs(e.x + e.width / 2 - 187.5), note).toBeLessThan(3);
    expect(e.y + e.height, note).toBeLessThanOrEqual(Math.min(m.y, l.y));
    expect(Math.min(m.y, l.y) - (e.y + e.height), note).toBeLessThan(20);
    expect(overlaps(e, m) || overlaps(e, l), note).toBe(false);
    return note;
  });
  await item('SIZE-06', async () => {
    await dropConnection(w, { block: true });
    const rcL = w.getByText('Reconnecting…');
    await expect(rcL).toBeVisible();
    const t = await bbox(turn(w)), a = await bbox(seatLabel(w)), rc = await bbox(rcL);
    const { e, m, l } = await bottom();
    await w.screenshot({ path: 'test-results/narrow-reconnecting.png' });
    await releaseConnection(w);
    await expect(rcL).toHaveCount(0, { timeout: 15000 });
    const all: [string, Box][] = [['turn', t], ['seat', a], ['reconnecting', rc], ['banner', e], ['move box', m], ['list', l]];
    const bad: string[] = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlaps(all[i][1], all[j][1])) bad.push(`${all[i][0]}/${all[j][0]}`);
    const note = all.map(([k, v]) => `${k} ${fmt(v)}`).join('; ');
    expect(bad, note).toEqual([]);
    expect(a.y, note).toBeGreaterThanOrEqual(t.y + t.height); expect(rc.y, note).toBeGreaterThanOrEqual(t.y + t.height);
    expect(a.x + a.width, note).toBeLessThanOrEqual(rc.x);
    expect(rc.x + rc.width, note).toBeGreaterThan(375 - 15);
    expect(e.y + e.height, note).toBeLessThanOrEqual(Math.min(m.y, l.y));
    expect(m.x + m.width, note).toBeLessThanOrEqual(l.x);
    return `${note} (server "stopped" by holding the page's connection down in-page)`;
  });
  await n.close();
});

// ---------------------------------------------------------------------------
// the banner and the dialogs

test('dialogs and the banner behind them', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white, b = g.black;
  await provokeError(w);
  await playLine(g, MATE_LINE.slice(0, 3));
  await playOn(b, 'black', 'Bc3', 'Ab2');
  const a11y02: string[] = [];
  let a11y02err: string | null = null;
  const a11y06: string[] = [];
  let a11y06err: string | null = null;
  await item('BANNER-03', async () => {
    const d = w.getByRole('dialog', { name: 'Black wins by checkmate!' });
    await expect(d).toBeVisible();
    const f0 = await focusDesc(w);
    const banner = alertWith(w, 'Already in a game');
    await expect(banner).toBeVisible();
    const eb = await bbox(banner);
    const covered = await coveredByDialog(w, eb);
    const seq = await tabSeq(w, 6);
    const x = await bbox(w.locator('[aria-label="Dismiss error"]'));
    await w.mouse.click(x.x + x.width / 2, x.y + x.height / 2); await w.waitForTimeout(400);
    const note = `focus on open: ${f0}; point over the banner covered by the dialog: ${covered}; Tab: ${seq.join(' > ')}`;
    expect(f0, note).toBe('BUTTON:Start new game');
    expect(covered, note).toBe(true);
    expect(seq.includes('BUTTON:✕'), note).toBe(false);
    await expect(banner).toBeVisible();
    return note;
  });
  await item('TURN-04', async () => {
    for (const p of [w, b]) await expect(p.getByRole('dialog', { name: 'Black wins by checkmate!' })).toBeVisible();
    expect([await turnText(w), await turnText(b)]).toEqual(['White to move', 'White to move']);
  });
  try {
    await w.getByRole('button', { name: 'Start new game' }).focus();
    const seq = [...(await tabSeq(w, 5)), ...(await tabSeq(w, 5, true))];
    a11y06.push(`end-game dialog (error showing): Tab/Shift+Tab ${seq.join(' > ')}`);
    const bad = seq.filter((s) => s !== 'BODY' && s !== 'BUTTON:Start new game');
    if (bad.length) a11y06err = `end-game: focus reached ${bad.join(', ')}`;
  } catch (e) { a11y06err = String(e); }
  try {
    const d = b.getByRole('dialog', { name: 'Black wins by checkmate!' });
    const modal = await d.getAttribute('aria-modal');
    const f = await focusDesc(b);
    a11y02.push(`end-game: role dialog, aria-modal ${modal}, named "Black wins by checkmate!", focus ${f}`);
    if (modal !== 'true' || f !== 'BUTTON:Start new game') a11y02err = a11y02[a11y02.length - 1];
    const t2 = await w.context().newPage(); await t2.goto(w.url()); await board(t2);
    await w.bringToFront();
    const r = w.getByRole('alertdialog', { name: 'This game is open in another tab' });
    await expect(r).toBeVisible();
    await expect(r).toHaveAccessibleDescription('Your seat moved to the newer tab or window. Close this one, or take the game back here.');
    const rm = await r.getAttribute('aria-modal'); const rf = await focusDesc(w);
    a11y02.push(`replaced: role alertdialog, aria-modal ${rm}, named and described, focus ${rf}`);
    if (rm !== 'true' || rf !== 'BUTTON:Play here') a11y02err = a11y02[a11y02.length - 1];
    await t2.close();
  } catch (e) { a11y02err = String(e).slice(0, 200); }
  await g.close();

  const p = await startG(browser);
  const pw = p.white;
  await playLine(p, PROMO_LINE);
  await item('A11Y-07', async () => {
    const s0 = await sentMoves(pw);
    await openPromotion(pw);
    // A11Y-02, promotion part (opened with the mouse)
    try {
      const d = pw.getByRole('dialog', { name: 'Promote to' });
      const modal = await d.getAttribute('aria-modal'); const f = await focusDesc(pw);
      a11y02.push(`promotion: role dialog, aria-modal ${modal}, named "Promote to", focus ${f}`);
      if (modal !== 'true' || f !== 'BUTTON:Queen') a11y02err = a11y02[a11y02.length - 1];
    } catch (e) { a11y02err = String(e).slice(0, 200); }
    await pw.keyboard.press('Escape');
    await expect(dialog(pw)).toHaveCount(0);
    expect(await sentMoves(pw)).toBe(s0);
    // A11Y-06 part 2
    try {
      await openPromotion(pw);
      const seq = [...(await tabSeq(pw, 7)), ...(await tabSeq(pw, 7, true))];
      a11y06.push(`promotion dialog: Tab/Shift+Tab ${seq.join(' > ')}`);
      const allowed = ['BUTTON:Queen', 'BUTTON:Rook', 'BUTTON:Bishop', 'BUTTON:Knight', 'BUTTON:Unicorn', 'BUTTON:Cancel', 'BODY'];
      const bad = seq.filter((s) => !allowed.includes(s));
      if (bad.length) a11y06err = `promotion: focus reached ${bad.join(', ')}`;
      await pw.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog(pw)).toHaveCount(0);
    } catch (e) { a11y06err = String(e).slice(0, 200); }
    await openPromotion(pw);
    await pw.keyboard.press('Enter');
    await expect(turn(pw)).toHaveText('Black to move'); await expect(turn(p.black)).toHaveText('Black to move');
    expect((await listText(pw)).trim().endsWith('Da4–Ea5=Q')).toBe(true);
    expect((await listText(p.black)).trim().endsWith('Da4–Ea5=Q')).toBe(true);
    return 'Escape right after opening closed it with nothing sent; Enter right after opening played Da4–Ea5=Q';
  });
  await p.close();
  record('A11Y-02', a11y02err ? 'fail' : 'pass', (a11y02err ? `${a11y02err} | ` : '') + a11y02.join('; '));
  record('A11Y-06', a11y06err ? 'fail' : 'pass', (a11y06err ? `${a11y06err} | ` : '') + a11y06.join('; ') + ' (BODY = focus in the browser\'s own UI)');
});

test('banner: under the promotion dialog', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white;
  await playLine(g, PROMO_LINE);
  await provokeError(w);
  await item('BANNER-04', async () => {
    const s0 = await sentMoves(w);
    const banner = alertWith(w, 'Already in a game');
    const text0 = await banner.textContent();
    await openPromotion(w);
    const eb = await bbox(banner);
    const covered = await coveredByDialog(w, eb);
    const x = await bbox(w.locator('[aria-label="Dismiss error"]'));
    await w.mouse.click(x.x + x.width / 2, x.y + x.height / 2); await w.waitForTimeout(400);
    const dialogAfter = await dialog(w).count();
    const bannerAfter = await banner.count();
    const text1 = await banner.textContent();
    const sel = (await boardState(w)).selectionRings;
    const s1 = await sentMoves(w);
    // step 3: click "✕"
    await w.getByRole('button', { name: 'Dismiss error' }).click();
    await expect(alertWith(w, 'Already in a game')).toHaveCount(0);
    const note = `1: banner darkened under the backdrop: ${covered}; 2: promotion ${dialogAfter ? 'dialog stayed open' : 'cancelled (the click landed on the backdrop)'}, nothing sent, ${sel} selected, banner ${bannerAfter ? (text1 === text0 ? 'unchanged' : 'changed') : 'gone'}; 3: "✕" dismissed it`;
    expect(covered, note).toBe(true);
    expect(dialogAfter, note).toBe(0); expect(sel, note).toBe(0); expect(s1, note).toBe(s0);
    expect(bannerAfter, note).toBe(1); expect(text1, note).toBe(text0);
    return note;
  });
  await item('ERR-03', async () => {
    await box(w).click(); await w.keyboard.type('Da4-Ea5'); await w.keyboard.press('Enter'); await w.waitForTimeout(300);
    const msg = ((await problem(w).textContent()) ?? '').trim();
    const d1 = await dialog(w).count();
    await box(w).fill('Da4-Ea5=U'); await box(w).press('Enter');
    let d2 = 0; for (let i = 0; i < 10; i++) { d2 += await dialog(w).count(); await w.waitForTimeout(50); }
    await expect(turn(g.black)).toHaveText('Black to move');
    expect(msg).toBe('Say which piece to promote to: add =Q, =R, =B, =N or =U.');
    expect(d1).toBe(0); expect(d2).toBe(0);
    expect((await listText(w)).trim().endsWith('Da4–Ea5=U')).toBe(true);
    expect((await listText(g.black)).trim().endsWith('Da4–Ea5=U')).toBe(true);
  });
  await g.close();
});

test('banner: seat in use', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white;
  await item('BANNER-05', async () => {
    await dropConnection(w, { block: true });
    await expect(w.getByText('Reconnecting…')).toBeVisible();
    const t2 = await w.context().newPage(); await t2.goto(w.url()); await board(t2);
    await t2.waitForTimeout(500);
    await releaseConnection(w);
    await w.bringToFront();
    await expect(w.getByRole('alertdialog', { name: 'This game is open in another tab' })).toBeVisible({ timeout: 15000 });
    await w.waitForTimeout(800);
    const alerts = await w.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((e) => e.textContent));
    const t2dialogs = await t2.evaluate(() => document.querySelectorAll('[role=alertdialog]').length);
    await t2.close();
    expect(alerts).toEqual([]);
    expect(t2dialogs).toBe(0);
    return 'first tab: replaced dialog, no banner (no role=alert at all); second tab: board, no dialog';
  });
  await g.close();
});

// ---------------------------------------------------------------------------
// cross-cutting/error-messages.md

test('errors: start screen', async ({ browser }) => {
  const p = await newTapped(browser);
  await item('ERR-01', async () => {
    await p.goto('/');
    await expect(p.getByRole('status')).toHaveCount(0);
    await rawSend(p, { type: 'create_game' }); await p.waitForTimeout(400);
    const btn = p.getByRole('button', { name: 'Start New Game' });
    await btn.click();
    const err = p.getByText(/^Error: /);
    await expect(err).toBeVisible();
    const txt = await err.textContent();
    const color = await err.evaluate((e) => getComputedStyle(e).color);
    const eb = await bbox(err), bb = await bbox(btn);
    const dismiss = await p.getByRole('button', { name: 'Dismiss error' }).count();
    expect(eb.y).toBeGreaterThanOrEqual(bb.y + bb.height);
    expect(dismiss).toBe(0);
    return `"${txt}" in ${color} under the button (error provoked by a second create_game on the same connection); no banner or "✕"`;
  });
  await p.context().close();
});

test('errors: move box', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white, b = g.black;
  await item('ERR-04', async () => {
    await box(b).click(); await b.keyboard.type('Ed4-Ed3');
    const disabled = await moveBtn(b).isDisabled();
    await b.keyboard.press('Enter'); await b.waitForTimeout(400);
    const msg = ((await problem(b).textContent()) ?? '').trim();
    expect(disabled).toBe(true); expect(msg).toBe('');
    expect(await box(b).inputValue()).toBe('Ed4-Ed3');
    expect(await sentMoves(b)).toBe(0);
    await box(b).fill('');
  });
  await item('A11Y-01', async () => {
    await w.bringToFront();
    await w.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await w.locator('[role=alert]').count()).toBe(0);
    await w.keyboard.press('Tab');
    const f1 = await focusDesc(w);
    const labelled = await w.getByLabel('Type a move (e.g. Ab2-Ab3)').evaluate((e) => e === document.activeElement);
    await w.keyboard.type('Bb2-Bb3'); await w.keyboard.press('Enter');
    await expect(turn(w)).toHaveText('Black to move'); await expect(turn(b)).toHaveText('Black to move');
    expect((await pieceMap(b, 'black'))['Bb3']).toBe('white Pawn');
    const f2 = await focusDesc(w); const v = await box(w).inputValue();
    const c0 = await cameraInfo(w);
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp']) await w.keyboard.press(k);
    await w.waitForTimeout(500);
    const c1 = await cameraInfo(w);
    expect(f1).toBe('#typed-move'); expect(labelled).toBe(true);
    expect(f2).toBe('#typed-move'); expect(v).toBe('');
    expect(c1.pos).toEqual(c0.pos);
  });
  await playOn(b, 'black', 'Ed4', 'Ed3');
  await expect(turn(w)).toHaveText('White to move');
  await item('ERR-02', async () => {
    await box(w).click();
    const cases: [string, string][] = [
      ['zz', 'Type a move as two cells, like Ab2-Ab3.'],
      ['Cc3-Cc4', 'You have no piece on Cc3.'],
      ['Ab2-Ab5', 'The piece on Ab2 cannot move to Ab5.'],
      ['Ab2-Ab3=Q', 'Ab2-Ab3 is not a promotion.'],
    ];
    const s0 = await sentMoves(w);
    for (const [t, m] of cases) {
      await box(w).fill(t); await box(w).press('Enter'); await w.waitForTimeout(250);
      expect(((await problem(w).textContent()) ?? '').trim()).toBe(m);
      expect(await box(w).inputValue()).toBe(t);
      expect(await box(w).getAttribute('aria-invalid')).toBe('true');
      expect(await w.locator('[role=alert]').count()).toBe(0);
      expect([await turnText(w), await turnText(b)]).toEqual(['White to move', 'White to move']);
    }
    expect(await sentMoves(w)).toBe(s0);
    await box(w).fill('ab2 ab3'); await box(w).press('Enter');
    await expect(box(w)).toHaveValue('');
    await expect(turn(w)).toHaveText('Black to move'); await expect(turn(b)).toHaveText('Black to move');
    expect((await pieceMap(w, 'white'))['Ab3']).toBe('white Pawn'); expect((await pieceMap(b, 'black'))['Ab3']).toBe('white Pawn');
  });
  await g.close();
});

// ---------------------------------------------------------------------------
// cross-cutting/broken-game-record.md

const FROZEN_TEXT = "Move 1 in this game's history is not a legal move for this client (likely an app version mismatch). The board is frozen at the position before it.";
test('frozen board', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white, b = g.black;
  await item('FROZEN-01', async () => {
    await rawSend(w, { type: 'move', from: 'Cc3', to: 'Cc4' });
    for (const p of [w, b]) await expect(p.getByText(FROZEN_TEXT)).toBeVisible();
    const fb = await bbox(w.getByText(FROZEN_TEXT));
    const topRow = Math.max(...[await bbox(seatLabel(w)), await bbox(turn(w))].map((r) => r.y + r.height));
    await press(w, 'Bb2', 'white'); await w.waitForTimeout(300);
    const sel = (await boardState(w)).selectionRings;
    await box(w).fill('Ab2-Ab3');
    const dis = await moveBtn(w).isDisabled();
    await box(w).fill('');
    const note = `banner ${fmt(fb)} (centre ${(fb.x + fb.width / 2).toFixed(0)} of 640), top row ends at ${topRow.toFixed(0)}`;
    expect(Math.abs(fb.x + fb.width / 2 - 640), note).toBeLessThan(3);
    expect(fb.y, note).toBeGreaterThanOrEqual(topRow);
    expect([await turnText(w), await turnText(b)]).toEqual(['White to move', 'White to move']);
    expect(await listText(w)).toContain('Cc3–Cc4'); expect(await listText(b)).toContain('Cc3–Cc4');
    expect(sel).toBe(0); expect(dis).toBe(true);
    return note;
  });
  await item('FROZEN-03', async () => {
    await b.reload(); await board(b);
    await expect(b.getByText(FROZEN_TEXT)).toBeVisible();
  });
  await g.close();
});

test('frozen board: illegal but applicable', async ({ browser }) => {
  const h = await startG(browser);
  await item('FROZEN-02', async () => {
    await watchAnim(h.white); await watchAnim(h.black);
    await rawSend(h.white, { type: 'move', from: 'Ab1', to: 'Ec4' });
    await expect(turn(h.black)).toHaveText('Black to move'); await expect(turn(h.white)).toHaveText('Black to move');
    await h.white.waitForTimeout(1500);
    const aw = await readAnim(h.white), ab = await readAnim(h.black);
    for (const [p, s] of [[h.white, 'white'], [h.black, 'black']] as const) {
      expect(await p.locator('[role=alert]').count()).toBe(0);
      expect((await pieceMap(p, s))['Ec4']).toBe('white Knight');
    }
    expect(aw.moving).toBeGreaterThan(0); expect(ab.moving).toBeGreaterThan(0);
    expect(aw.ghosts).toBeGreaterThan(0); expect(ab.ghosts).toBeGreaterThan(0);
    return `glide samples W ${aw.moving} / B ${ab.moving}, pawn fade samples W ${aw.ghosts} / B ${ab.ghosts}`;
  });
  await h.close();
});

test('frozen board: narrow', async ({ browser }) => {
  const n = await startG(browser, { viewport: { width: 375, height: 667 } });
  const w = n.white;
  await item('FROZEN-04', async () => {
    await rawSend(w, { type: 'move', from: 'Cc3', to: 'Cc4' });
    const fl = w.getByText(FROZEN_TEXT);
    await expect(fl).toBeVisible();
    const fb = await bbox(fl), a = await bbox(seatLabel(w)), t = await bbox(turn(w));
    await w.screenshot({ path: 'test-results/frozen-narrow.png' });
    const lh = await fl.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight) || 24);
    const c0 = await cameraInfo(w);
    await drag(w, { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 }, 100, 0); await settle(w);
    const moved = camMoved(c0, await cameraInfo(w));
    const note = `banner ${fmt(fb)} (${(fb.height / lh).toFixed(1)} lines); seat label ${fmt(a)}; turn ${fmt(t)}; drag from its text orbited: ${moved}`;
    expect(fb.width, note).toBeGreaterThan(0.85 * 375);
    expect(fb.height / lh, note).toBeGreaterThan(2.5);
    expect(fb.y, note).toBeGreaterThanOrEqual(a.y + a.height);
    expect(overlaps(fb, a) || overlaps(fb, t), note).toBe(false);
    expect(moved, note).toBeTruthy();
    return note;
  });
  await n.close();
});

// ---------------------------------------------------------------------------
// cross-cutting/accessibility.md: motion

test('reduced motion', async ({ browser }) => {
  const r = await startG(browser, { reducedMotion: 'reduce' });
  await item('A11Y-03', async () => {
    await watchAnim(r.white); await watchAnim(r.black);
    await playOn(r.white, 'white', 'Bc1', 'Ec4');
    await expect(turn(r.black)).toHaveText(/Black to move/);
    await r.white.waitForTimeout(1500);
    const aw = await readAnim(r.white), ab = await readAnim(r.black);
    for (const [p, s] of [[r.white, 'white'], [r.black, 'black']] as const) {
      expect((await pieceMap(p, s))['Ec4']).toBe('white Queen');
      expect(await lastCells(p, s)).toEqual(['from:Bc1', 'to:Ec4']);
    }
    expect(aw).toEqual({ glides: 0, moving: 0, ghosts: 0 }); expect(ab).toEqual({ glides: 0, moving: 0, ghosts: 0 });
    return 'no glide or fade samples on either page; Bc1 and Ec4 teal on both';
  });
  await r.close();
});

// ---------------------------------------------------------------------------
// cross-cutting/screen-sizes-and-touch.md

test('share link', async ({ browser }) => {
  await item('SIZE-02', async () => {
    const x = await newTapped(browser, { viewport: { width: 375, height: 667 } });
    await x.goto('/'); await x.getByRole('button', { name: 'Start New Game' }).click(); await x.waitForURL(/\/game\//);
    const link = x.locator('p.break-all');
    await expect(link).toHaveText(x.url());
    const lb = await bbox(link);
    const m = await link.evaluate((el) => ({ lh: parseFloat(getComputedStyle(el).lineHeight), sw: el.scrollWidth, cw: el.clientWidth, doc: document.documentElement.scrollWidth }));
    const cb = await bbox(x.getByRole('button', { name: 'Copy link' }));
    await x.screenshot({ path: 'test-results/share-narrow.png' });
    await x.context().close();
    const note = `link box ${fmt(lb)} (${(lb.height / m.lh).toFixed(1)} line heights incl. padding), scrollWidth ${m.sw} / clientWidth ${m.cw}, page scrollWidth ${m.doc}; "Copy link" at y ${cb.y.toFixed(0)}`;
    expect(lb.x, note).toBeGreaterThanOrEqual(0); expect(lb.x + lb.width, note).toBeLessThanOrEqual(375);
    expect(lb.height, note).toBeGreaterThan(1.8 * m.lh);
    expect(m.sw, note).toBeLessThanOrEqual(m.cw); expect(m.doc, note).toBeLessThanOrEqual(375);
    expect(cb.y, note).toBeGreaterThanOrEqual(lb.y + lb.height);
    return note;
  });
  await item('SIZE-09', async () => {
    const ctx = await browser.newContext();
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5173' });
    const x = await ctx.newPage();
    await x.goto('/'); await x.getByRole('button', { name: 'Start New Game' }).click(); await x.waitForURL(/\/game\//);
    await x.getByRole('button', { name: 'Copy link' }).click();
    await expect(x.getByText('Copied', { exact: true })).toBeVisible();
    const clip = await x.evaluate(() => navigator.clipboard.readText());
    const url = x.url();
    await ctx.close();
    // The machine's plain-http network address: Vite listens on 127.0.0.1 only, so forward a port on the LAN address to it.
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (!lan) throw new Error('no non-loopback IPv4 address');
    const server = net.createServer((c) => { const u = net.connect(5173, '127.0.0.1'); c.pipe(u); u.pipe(c); c.on('error', () => u.destroy()); u.on('error', () => c.destroy()); });
    await new Promise<void>((res) => server.listen(0, lan, () => res()));
    const port = (server.address() as net.AddressInfo).port;
    const ctx2 = await browser.newContext();
    try {
      const y = await ctx2.newPage();
      await y.goto(`http://${lan}:${port}/`);
      const secure = await y.evaluate(() => window.isSecureContext);
      await y.getByRole('button', { name: 'Start New Game' }).click();
      await expect(y.getByText('Game created! Share this link with a friend:')).toBeVisible({ timeout: 20000 });
      const copy = await y.getByRole('button', { name: 'Copy link' }).count();
      const shown = await y.locator('p.break-all').textContent();
      expect(clip).toBe(url);
      expect(secure).toBe(false); expect(copy).toBe(0);
      return `localhost: "Copied", clipboard held ${clip}; http://${lan}:${port} (same machine, forwarded to Vite; isSecureContext ${secure}): share link ${shown}, ${copy} "Copy link" button`;
    } finally { await ctx2.close(); server.close(); }
  });
});

test('touch', async ({ browser }) => {
  const t = await startG(browser, { viewport: { width: 800, height: 600 }, hasTouch: true });
  const w = t.white;
  const tap = async (cell: string) => { const q = await pixelOf(w, cell, 'white'); await w.touchscreen.tap(q.x, q.y); await w.waitForTimeout(400); };
  await item('SIZE-07', async () => {
    await tap('Bb2');
    expect(await glowing(w, 'white')).toEqual(['Bb2']);
    const d0 = await highlighted(w, 'white');
    const q = await pixelOf(w, 'Bb3', 'white');
    const c0 = await cameraInfo(w); const s0 = await sentMoves(w);
    const cdp = await w.context().newCDPSession(w);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x, y: q.y }] });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: q.x + 10 * i, y: q.y }] }); await w.waitForTimeout(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(w);
    const moved = camMoved(c0, await cameraInfo(w));
    expect(moved).toBeTruthy();
    expect(await glowing(w, 'white')).toEqual(['Bb2']); expect(await highlighted(w, 'white')).toEqual(d0);
    expect(await sentMoves(w)).toBe(s0); expect(await turnText(w)).toBe('White to move');
    return 'emulated one-finger touch (CDP touch events), 100 px drag from Bb3';
  });
  await item('SIZE-03', async () => {
    await tap('Bb2');
    const h1 = await highlighted(w, 'white');
    await tap('Bb3');
    await expect(turn(w)).toHaveText('Black to move'); await expect(turn(t.black)).toHaveText('Black to move');
    expect(h1).toEqual(['Bb3', 'Cb2']);
    return 'touch emulation (one finger): tap Bb2 selected it with Bb3 and Cb2; tap Bb3 played the move';
  });
  await t.close();
  record('SIZE-08', 'blocked', 'needs a real touch device and two fingers; touch emulation drives one finger at a time');
  record('SIZE-10', 'blocked', "needs a real phone's browser toolbar (the dynamic viewport); headless Chromium has none");
});
