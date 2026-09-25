import type { Page } from '@playwright/test';
import { fromZXY, toZXY } from '../../../client/src/engine/coords';
import { toWorld, CELLS } from '../../../client/src/three/layout';
import { clickSquare, waitForDestination } from '../../../client/e2e/helpers/board';
export { startGame } from '../../../client/e2e/helpers/game';
export { clickSquare, waitForDestination, waitForBoard, getPlayerColor } from '../../../client/e2e/helpers/board';
type Seat = 'white' | 'black';

/** Page-relative pixel whose ray reaches `zxy` first among interactive objects (same logic as clickSquare). */
export async function pixelOf(page: Page, zxy: string, seat: Seat): Promise<{ x: number; y: number }> {
  const world = toWorld(fromZXY(zxy), seat);
  const res = await page.evaluate(([wx, wy, wz]) => {
    const state = (window as any).__r3fState;
    const { camera, size, scene, raycaster } = state.get ? state.get() : state;
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    const atTarget = (o: any) => near(o.position.x, wx) && near(o.position.y, wy) && near(o.position.z, wz);
    const interactive = (hit: any) => {
      for (let o = hit; o; o = o.parent) {
        if (o.userData.piece) return o;
        if (o.userData.cube) return o.userData.highlight ? o : null;
      }
      return null;
    };
    const THREEVec = camera.position.constructor;
    const canvasEl = document.querySelector('canvas')!;
    const rect = canvasEl.getBoundingClientRect();
    for (const dx of [0, 0.4, -0.4]) for (const dy of [0, 0.4, -0.4]) for (const dz of [0, 0.4, -0.4]) {
      const v = new THREEVec(wx + dx, wy + dy, wz + dz).project(camera);
      raycaster.setFromCamera({ x: v.x, y: v.y }, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      let first = null;
      for (const h of hits) { first = interactive(h.object); if (first) break; }
      if (first && atTarget(first)) {
        const px = (v.x * 0.5 + 0.5) * size.width, py = (-v.y * 0.5 + 0.5) * size.height;
        const under = document.elementFromPoint(rect.left + px, rect.top + py);
        if (under === canvasEl) return { x: rect.left + px, y: rect.top + py };
      }
    }
    return null;
  }, world);
  if (!res) throw new Error(`no pixel for ${zxy}`);
  return res;
}

/** Raw projection of a cell centre to page pixels (no occlusion logic). */
export async function projectCell(page: Page, zxy: string, seat: Seat) {
  const world = toWorld(fromZXY(zxy), seat);
  return page.evaluate(([wx, wy, wz]) => {
    const state = (window as any).__r3fState;
    const { camera, size } = state.get ? state.get() : state;
    camera.updateMatrixWorld();
    const v = new camera.position.constructor(wx, wy, wz).project(camera);
    const rect = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: rect.left + (v.x * 0.5 + 0.5) * size.width, y: rect.top + (-v.y * 0.5 + 0.5) * size.height };
  }, world);
}

/** What the board currently draws: selection rings, highlighted cells, capture rings, last-move cells. */
export async function boardState(page: Page) {
  return page.evaluate(() => {
    const state = (window as any).__r3fState;
    const { scene } = state.get ? state.get() : state;
    const out = { selectionRings: 0, highlights: 0, captureRings: 0, lastFrom: 0, lastTo: 0, glides: 0, ghosts: 0 };
    scene.traverse((o: any) => {
      const u = o.userData || {};
      if (u.selectionRing) out.selectionRings++;
      if (u.cube && u.highlight) out.highlights++;
      if (u.captureRing) out.captureRings++;
      if (u.lastMoveFrom) out.lastFrom++;
      if (u.lastMoveTo) out.lastTo++;
      if (u.moveGlide) out.glides++;
      if (u.ghostPiece) out.ghosts++;
    });
    return out;
  });
}

export async function cameraInfo(page: Page) {
  return page.evaluate(() => {
    const state = (window as any).__r3fState;
    const { camera, controls } = state.get ? state.get() : state;
    return { pos: camera.position.toArray(), target: controls ? controls.target.toArray() : null, dist: controls ? camera.position.distanceTo(controls.target) : null };
  });
}

// --- Connection control -------------------------------------------------------
// Wraps the page's WebSocket at load so a test can drop the connection (the
// page sees an ordinary close and starts its retry schedule) and hold it down
// (every new attempt is pointed at a closed port until released).
export const socketTap = () => {
  const Native = window.WebSocket;
  const w = window as unknown as { __sockets: WebSocket[]; __blockSockets: boolean; __attempts: number[]; __delayOnOpenMs: number; __delayUntil: number };
  w.__sockets = [];
  w.__blockSockets = false;
  w.__attempts = [];
  w.__delayOnOpenMs = 0;
  w.__delayUntil = 0;
  class Tapped extends Native {
    private __handler: ((ev: MessageEvent) => void) | null = null;
    private __queue: MessageEvent[] = [];
    constructor(url: string | URL, protocols?: string | string[]) {
      // Only the game server's socket; Vite's own dev socket must be left alone
      // (cutting it makes Vite reload the page).
      const game = String(url).includes(':8000/ws');
      if (game) w.__attempts.push(Date.now());
      super(game && w.__blockSockets ? 'ws://127.0.0.1:9/' : url, protocols);
      if (!game) return;
      w.__sockets.push(this);
      this.addEventListener('open', () => { if (w.__delayOnOpenMs) w.__delayUntil = Date.now() + w.__delayOnOpenMs; });
      super.onmessage = (ev: MessageEvent) => {
        const h = this.__handler;
        if (!h || (window as any).__loseIncoming) return;
        const wait = w.__delayUntil - Date.now();
        if (wait > 0 || this.__queue.length) {
          this.__queue.push(ev);
          if (this.__queue.length === 1) {
            const flush = () => {
              const q = this.__queue; this.__queue = [];
              for (const e of q) this.__handler?.call(this, e);
            };
            setTimeout(flush, Math.max(wait, 0));
          }
          return;
        }
        h.call(this, ev);
      };
    }
    get onmessage() { return this.__handler as any; }
    set onmessage(fn: any) { this.__handler = fn; }
  }
  window.WebSocket = Tapped as unknown as typeof WebSocket;
};
export async function delayAnswersAfterOpen(page: Page, ms: number) {
  await page.evaluate((m) => { (window as any).__delayOnOpenMs = m; }, ms);
}
export async function rawSend(page: Page, msg: unknown) {
  await page.evaluate((m) => { const s = (window as any).__sockets.filter((x: WebSocket) => x.readyState === 1).pop(); s.send(JSON.stringify(m)); }, msg);
}
export async function dropConnection(page: Page, { block = false } = {}) {
  await page.evaluate((b) => {
    const w = window as unknown as { __sockets: WebSocket[]; __blockSockets: boolean };
    w.__blockSockets = b;
    for (const s of w.__sockets) if (s.readyState === 1) s.close();
  }, block);
}
export async function releaseConnection(page: Page) {
  await page.evaluate(() => { (window as unknown as { __blockSockets: boolean }).__blockSockets = false; });
}
export async function attemptTimes(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __attempts: number[] }).__attempts);
}

import type { Browser, BrowserContext } from '@playwright/test';
import { waitForBoard as wfb, getPlayerColor as gpc } from '../../../client/e2e/helpers/board';
/** Like startGame, but every context gets the socket tap and optional context options. */
export async function startTappedGame(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const contexts: BrowserContext[] = [await browser.newContext(opts), await browser.newContext(opts)];
  for (const c of contexts) await c.addInitScript(socketTap);
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  await a.goto('/');
  await a.getByRole('button', { name: 'Start New Game' }).click();
  await a.waitForURL(/\/game\/[A-Z0-9]+/);
  await b.goto(a.url());
  await b.getByRole('button', { name: 'Join Game' }).click();
  await wfb(a); await wfb(b);
  const seats = {} as Record<Seat, Page>;
  for (const p of [a, b]) seats[await gpc(p)] = p;
  return { white: seats.white, black: seats.black, contexts, close: () => Promise.all(contexts.map((c) => c.close())) };
}

// --- Pass bookkeeping ---------------------------------------------------------
import { appendFileSync } from 'node:fs';
export const RESULTS = require('node:path').join(__dirname, 'results.jsonl');
export function record(id: string, result: 'pass' | 'fail' | 'blocked', note = '') {
  appendFileSync(RESULTS, JSON.stringify({ id, result, note }) + '\n');
  console.log('RESULT', id, result, note);
}
/** Runs a check, recording pass, or fail with the assertion message. */
export async function item(id: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    record(id, 'pass', note || '');
  } catch (e) {
    record(id, 'fail', String((e as Error).message).split('\n').slice(0, 3).join(' ').slice(0, 300));
  }
}
export async function press(page: Page, zxy: string, seat: Seat, button: 'left' | 'right' | 'middle' = 'left') {
  const p = await pixelOf(page, zxy, seat);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button });
  await page.mouse.up({ button });
}
export async function pressAt(page: Page, p: { x: number; y: number }, button: 'left' | 'right' | 'middle' = 'left') {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button });
  await page.mouse.up({ button });
}
export async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, button: 'left' | 'right' | 'middle' = 'left', modifiers: string[] = []) {
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up({ button });
  for (const m of modifiers) await page.keyboard.up(m);
}
/** Selects `from` and plays to `to` on `page`, waiting for the turn to flip on it. */
export async function playOn(page: Page, seat: Seat, from: string, to: string) {
  await clickSquare(page, from, seat);
  await waitForDestination(page, to, seat);
  await clickSquare(page, to, seat);
}
/** Pieces on the board as cell -> "color Type", read from the scene. */
export async function pieceMap(page: Page, seat: Seat): Promise<Record<string, string>> {
  const raw = await page.evaluate(() => {
    const state = (window as any).__r3fState;
    const { scene } = state.get ? state.get() : state;
    const out: { p: number[]; t: string; c: string }[] = [];
    scene.traverse((o: any) => {
      if (o.userData?.piece && !o.parent?.userData?.ghostPiece) out.push({ p: o.position.toArray(), t: o.userData.piece.type, c: o.userData.piece.color });
    });
    return out;
  });
  const map: Record<string, string> = {};
  for (const r of raw) {
    const cell = CELLS.find((c) => { const w = toWorld(c, seat); return Math.abs(w[0] - r.p[0]) < 1e-6 && Math.abs(w[1] - r.p[1]) < 1e-6 && Math.abs(w[2] - r.p[2]) < 1e-6; });
    if (cell) map[toZXY(cell)] = `${r.c} ${r.t}`;
  }
  return map;
}
/** Highlighted (legal destination) cells, as ZXY. */
export async function highlighted(page: Page, seat: Seat): Promise<string[]> {
  const raw = await page.evaluate(() => {
    const state = (window as any).__r3fState;
    const { scene } = state.get ? state.get() : state;
    const out: number[][] = [];
    scene.traverse((o: any) => { if (o.userData?.cube && o.userData.highlight) out.push(o.position.toArray()); });
    return out;
  });
  return raw.map((p) => { const c = CELLS.find((c) => { const w = toWorld(c, seat); return Math.abs(w[0] - p[0]) < 1e-6 && Math.abs(w[1] - p[1]) < 1e-6 && Math.abs(w[2] - p[2]) < 1e-6; }); return c ? toZXY(c) : '?'; }).sort();
}
export async function turnText(page: Page) { return (await page.getByTestId('turn-indicator').textContent()) ?? ''; }
export async function listText(page: Page) { return (await page.getByTestId('move-list').textContent().catch(() => '')) ?? ''; }
export async function settle(page: Page, timeout = 15000) {
  const start = Date.now();
  let last = JSON.stringify(await cameraInfo(page));
  while (Date.now() - start < timeout) {
    await page.waitForTimeout(400);
    const now = JSON.stringify(await cameraInfo(page));
    if (now === last) return;
    last = now;
  }
}
export async function fps(page: Page) {
  return page.evaluate(() => new Promise<number>((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
}

export async function loseIncoming(page: Page, on: boolean) {
  await page.evaluate((v) => { (window as any).__loseIncoming = v; }, on);
}
/** Click a DOM button and cut the connection in the same task, so the request leaves but no answer is seen. */
export async function clickThenCut(page: Page, name: string) {
  await page.evaluate((n) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === n) as HTMLButtonElement;
    b.click();
    const w = window as any;
    w.__blockSockets = true;
    for (const s of w.__sockets) if (s.readyState === 1) s.close();
  }, name);
}
export const LINE20 = ["Ab1-Aa3","Eb5-Ea3","Aa3-Ab1","Ea3-Eb5","Ab1-Aa3","Eb5-Ea3","Aa3-Ab1","Ea3-Eb5","Ab1-Aa3","Eb5-Ea3","Aa3-Ab1","Ea3-Eb5","Ab1-Aa3","Eb5-Ea3","Aa3-Ab1","Ea3-Eb5","Ab1-Aa3","Eb5-Ea3","Aa3-Ab1","Ea3-Eb5"];
export const focused = (p: Page) => p.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? `${a.tagName}:${a.textContent}` : 'BODY'; });
export async function newTappedPage(browser: import('@playwright/test').Browser, opts: Parameters<import('@playwright/test').Browser['newContext']>[0] = {}) {
  const c = await browser.newContext(opts); await c.addInitScript(socketTap); return c.newPage();
}
