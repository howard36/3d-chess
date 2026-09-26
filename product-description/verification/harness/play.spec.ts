import { test, expect as baseExpect, type Page, type Browser } from '@playwright/test';
import {
  socketTap, item, record, press, pressAt, pixelOf, projectCell, boardState, cameraInfo, settle, pieceMap, highlighted,
  turnText, listText, dropConnection, releaseConnection, delayAnswersAfterOpen, playOn, drag, waitForBoard, getPlayerColor,
} from './vh';
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
            const kind = o.userData.piece ? 'piece' : 'cell';
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
// play/making-a-move.md

test('making a move: selection and pointer', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white, b = g.black;
  await item('MOVE-01', async () => {
    await press(w, 'Bc1', 'white'); await w.waitForTimeout(300);
    const s = await boardState(w);
    const dots = await w.evaluate(() => { let n = 0; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.geometry?.type === 'SphereGeometry' && o.geometry.parameters?.radius === 0.11) n++; }); return n; });
    const dests = await highlighted(w, 'white');
    expect(s.selectionRings).toBe(1);
    expect(await glowing(w, 'white')).toEqual(['Bc1']);
    expect(s.highlights).toBe(14); expect(dots).toBe(13); expect(s.captureRings).toBe(1);
    expect(dests).toContain('Ec4');
    expect((await pieceMap(w, 'white'))['Ec4']).toBe('black Pawn');
    await clearSelection(w, 'white');
    return `ring 1, Queen glow #6b4a00, ${s.highlights} destinations, ${dots} dots, ${s.captureRings} capture ring (Ec4, Black pawn)`;
  });
  await item('MOVE-10', async () => {
    await press(w, 'Ac1', 'white'); await w.waitForTimeout(300);
    const s = await boardState(w);
    expect(s.selectionRings).toBe(1); expect(await glowing(w, 'white')).toEqual(['Ac1']); expect(s.highlights).toBe(0);
  });
  await item('MOVE-05', async () => {
    await press(w, 'Bb2', 'white'); await w.waitForTimeout(250);
    expect(await glowing(w, 'white')).toEqual(['Bb2']);
    await w.keyboard.press('Escape'); await w.waitForTimeout(300);
    expect(await glowing(w, 'white')).toEqual(['Bb2']);
    expect((await boardState(w)).selectionRings).toBe(1);
  });
  await item('MOVE-04', async () => {
    const before = await sentMoves(w);
    expect(await glowing(w, 'white')).toEqual(['Bb2']);
    const px = await emptyPixel(w, 'Cc3', 'white');
    await pressAt(w, px); await w.waitForTimeout(300);
    expect((await boardState(w)).selectionRings).toBe(0);
    expect(await sentMoves(w)).toBe(before);
    expect(await turnText(w)).toBe('White to move');
  });
  await item('MOVE-11', async () => {
    await press(w, 'Ab2', 'white'); await w.waitForTimeout(250);
    const d0 = await highlighted(w, 'white');
    expect(d0).toContain('Ab3');
    const c0 = await cameraInfo(w); const before = await sentMoves(w);
    const px = await pixelOf(w, 'Ab3', 'white');
    await drag(w, px, -200, 0); await settle(w);
    const c1 = await cameraInfo(w);
    expect(camMoved(c0, c1)).toBeTruthy();
    expect(await sentMoves(w)).toBe(before);
    expect(await turnText(w)).toBe('White to move');
    expect(await glowing(w, 'white')).toEqual(['Ab2']);
    expect(await highlighted(w, 'white')).toEqual(d0);
    await clearSelection(w, 'white');
  });
  await item('MOVE-12', async () => {
    await press(w, 'Bc1', 'white'); await w.waitForTimeout(250);
    const d0 = await highlighted(w, 'white'); expect(d0.length).toBe(14);
    const px = await emptyPixel(w, 'Cc3', 'white');
    const before = await sentMoves(w);
    const c0 = await cameraInfo(w);
    await drag(w, px, 200, 0); await settle(w);
    const c1 = await cameraInfo(w);
    const sel1 = await glowing(w, 'white');
    await drag(w, px, 0, 100, 'right'); await settle(w);
    const c2 = await cameraInfo(w);
    const sel2 = await glowing(w, 'white');
    await w.mouse.move(px.x, px.y); await w.mouse.wheel(0, -300); await settle(w);
    const c3 = await cameraInfo(w);
    const orbit = camMoved(c0, c1), pan = Math.hypot(...c2.target!.map((v: number, i: number) => v - c1.target![i])) > 1e-3, zoom = Math.abs(c3.dist! - c2.dist!) > 1e-3;
    expect(orbit).toBeTruthy(); expect(pan).toBeTruthy(); expect(zoom).toBeTruthy();
    expect(sel1).toEqual(['Bc1']); expect(sel2).toEqual(['Bc1']); expect(await glowing(w, 'white')).toEqual(['Bc1']);
    expect(await highlighted(w, 'white')).toEqual(d0);
    expect(await sentMoves(w)).toBe(before);
    await clearSelection(w, 'white');
    return `orbit, pan (target moved), zoom (distance ${c2.dist!.toFixed(2)} -> ${c3.dist!.toFixed(2)}); Queen selected throughout with 14 destinations`;
  });
  await item('MOVE-08', async () => {
    await w.evaluate(() => { const x = window as any; x.__ctx = []; window.addEventListener('contextmenu', (e) => x.__ctx.push(e.defaultPrevented)); });
    await press(w, 'Bb2', 'white'); await w.waitForTimeout(250);
    const before = await sentMoves(w);
    await press(w, 'Bb3', 'white', 'right'); await w.waitForTimeout(400);
    const afterRight = { sel: await glowing(w, 'white'), sent: await sentMoves(w), turn: await turnText(w) };
    await press(w, 'Bb3', 'white', 'middle'); await w.waitForTimeout(400);
    const afterMiddle = { sel: await glowing(w, 'white'), sent: await sentMoves(w), turn: await turnText(w) };
    const ctx: boolean[] = await w.evaluate(() => (window as any).__ctx);
    await press(w, 'Bb3', 'white');
    await expect(turn(w)).toHaveText('Black to move');
    expect(afterRight).toEqual({ sel: ['Bb2'], sent: before, turn: 'White to move' });
    expect(afterMiddle).toEqual({ sel: ['Bb2'], sent: before, turn: 'White to move' });
    expect(ctx.every(Boolean)).toBe(true);
    expect(await listText(b)).toContain('1. Bb2–Bb3');
    return `contextmenu events seen: ${ctx.length}, all default-prevented (no menu); left click played Bb2–Bb3`;
  });
  await item('MOVE-03', async () => {
    await press(w, 'Bc2', 'white'); await w.waitForTimeout(300);
    expect((await boardState(w)).selectionRings).toBe(0);
    expect(await glowing(w, 'white')).toEqual([]);
  });
  await g.close();
});

test('making a move: sending', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white, b = g.black;
  await item('MOVE-02', async () => {
    await watchAnim(w); await watchAnim(b);
    await press(w, 'Bb2', 'white');
    await expect.poll(() => highlighted(w, 'white')).toContain('Bb3');
    await press(w, 'Bb3', 'white');
    const s0 = await boardState(w);
    const t0 = await turnText(w);
    await expect(turn(w)).toHaveText('Black to move'); await expect(turn(b)).toHaveText('Black to move');
    await w.waitForTimeout(1500);
    const aw = await readAnim(w), ab = await readAnim(b);
    expect(s0.selectionRings + s0.highlights + s0.captureRings, `right after the click (turn then "${t0}"): ${JSON.stringify(s0)}`).toBe(0);
    expect((await pieceMap(w, 'white'))['Bb3']).toBe('white Pawn'); expect((await pieceMap(b, 'black'))['Bb3']).toBe('white Pawn');
    expect(await lastCells(w, 'white')).toEqual(['from:Bb2', 'to:Bb3']); expect(await lastCells(b, 'black')).toEqual(['from:Bb2', 'to:Bb3']);
    expect((await listText(w)).trim()).toBe('1. Bb2–Bb3'); expect((await listText(b)).trim()).toBe('1. Bb2–Bb3');
    expect(aw.moving).toBeGreaterThan(0); expect(ab.moving).toBeGreaterThan(0);
    return `markers gone right after the click; glide samples in motion: White ${aw.moving}, Black ${ab.moving}`;
  });
  await item('MOVE-03', async () => {
    await press(w, 'Bc2', 'white'); await w.waitForTimeout(300);
    expect((await boardState(w)).selectionRings).toBe(0);
  });
  await item('OPP-05', async () => {
    await playOn(b, 'black', 'Ed4', 'Ed3');
    await expect(turn(w)).toHaveText('White to move'); await expect(turn(b)).toHaveText('White to move');
    const list0 = await listText(b);
    const seen: string[] = [];
    let stop = false;
    const poll = (async () => { while (!stop) { seen.push((await b.getByTestId('opponent-presence').textContent().catch(() => '')) ?? ''); await b.waitForTimeout(30); } })();
    await w.reload(); await board(w);
    await expect(b.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await b.waitForTimeout(300); stop = true; await poll;
    expect(seen).toContain('Opponent: offline');
    expect(await turnText(b)).toBe('White to move');
    expect(await listText(b)).toBe(list0);
    const seq = seen.filter((s, i) => i === 0 || s !== seen[i - 1]);
    return `presence sequence on Black: ${seq.join(' -> ')}; turn and list unchanged`;
  });
  await g.close();
});

test('making a move: double click and drop', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white, b = g.black;
  await item('MOVE-07', async () => {
    await press(w, 'Bb2', 'white');
    await expect.poll(() => highlighted(w, 'white')).toContain('Bb3');
    const d = await pixelOf(w, 'Bb3', 'white');
    const s0 = await sentMoves(w);
    await w.mouse.move(d.x, d.y);
    await w.mouse.click(d.x, d.y, { clickCount: 2, delay: 0 });
    await expect(turn(b)).toHaveText('Black to move');
    await w.waitForTimeout(1000);
    const sent1 = (await sentMoves(w)) - s0;
    const alerts1 = await w.locator('[role=alert]').allTextContents();
    const list1 = await listText(w);
    await w.getByRole('button', { name: 'Dismiss error' }).click().catch(() => {});
    await playOn(b, 'black', 'Ed4', 'Ed3'); await expect(turn(w)).toHaveText('White to move');
    await press(w, 'Bc2', 'white');
    await expect.poll(() => highlighted(w, 'white')).toContain('Bc3');
    const d2 = await pixelOf(w, 'Bc3', 'white');
    const s1 = await sentMoves(w);
    await w.mouse.click(d2.x, d2.y); await w.waitForTimeout(100); await w.mouse.click(d2.x, d2.y);
    await expect(turn(b)).toHaveText('Black to move');
    await w.waitForTimeout(1000);
    const sent2 = (await sentMoves(w)) - s1;
    const alerts2 = await w.locator('[role=alert]').allTextContents();
    const list2 = await listText(w);
    const note = `no-pause double click: ${sent1} move message(s) sent, banner ${JSON.stringify(alerts1)}, list "${list1.trim()}"; 100 ms apart: ${sent2} sent, banner ${JSON.stringify(alerts2)}`;
    expect(list1.trim(), note).toBe('1. Bb2–Bb3');
    expect(alerts1.join(), note).toContain('Error: Not your turn');
    expect(list2, note).toContain('2. Bc2–Bc3'); expect(alerts2, note).toEqual([]);
    return note;
  });
  await g.close();
});

test('making a move: drop', async ({ browser }) => {
  const h = await startG(browser);
  await item('MOVE-09', async () => {
    await press(h.white, 'Bb2', 'white');
    await expect.poll(() => highlighted(h.white, 'white')).toContain('Bb3');
    await watchAnim(h.white);
    await press(h.white, 'Bb3', 'white');
    await dropConnection(h.white);
    await expect(h.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await h.white.waitForTimeout(1500);
    const a = await readAnim(h.white);
    const t = await turnText(h.white);
    const onBoard = (await pieceMap(h.white, 'white'))['Bb3'] === 'white Pawn';
    if (onBoard) {
      expect(t).toBe('Black to move');
      return `the move reached the server: on the board after reconnecting (glide samples ${a.moving}), "${t}"`;
    }
    expect(t).toBe('White to move');
    await press(h.white, 'Bb2', 'white'); await h.white.waitForTimeout(300);
    expect((await boardState(h.white)).selectionRings).toBe(1);
    return `the move was lost: not on the board, "${t}", the board takes input`;
  });
  await h.close();
});

test('making a move: move box', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white, b = g.black;
  // MOVE-15 step 1 (Black's page, White to move); step 2 is MOVE-13's move
  let pre15: { disabled: boolean; sent: number; turn: string } | Error;
  try {
    await box(b).click(); await b.keyboard.type('Ec4-Ec3');
    const disabled = await moveBtn(b).isDisabled();
    await b.keyboard.press('Enter'); await b.waitForTimeout(400);
    pre15 = { disabled, sent: await sentMoves(b), turn: await turnText(b) };
  } catch (e) { pre15 = e as Error; }
  await item('MOVE-13', async () => {
    await watchAnim(w); await watchAnim(b);
    await box(w).click(); await w.keyboard.type('bb2 bb3'); await w.keyboard.press('Enter');
    await expect(box(w)).toHaveValue('');
    await expect(turn(w)).toHaveText('Black to move'); await expect(turn(b)).toHaveText('Black to move');
    await w.waitForTimeout(1500);
    const aw = await readAnim(w), ab = await readAnim(b);
    expect((await pieceMap(w, 'white'))['Bb3']).toBe('white Pawn'); expect((await pieceMap(b, 'black'))['Bb3']).toBe('white Pawn');
    expect((await listText(w)).trim()).toBe('1. Bb2–Bb3'); expect((await listText(b)).trim()).toBe('1. Bb2–Bb3');
    expect(aw.moving).toBeGreaterThan(0); expect(ab.moving).toBeGreaterThan(0);
    return `glide samples in motion: White ${aw.moving}, Black ${ab.moving}`;
  });
  await item('MOVE-15', async () => {
    if (pre15 instanceof Error) throw pre15;
    expect(pre15).toEqual({ disabled: true, sent: 0, turn: 'White to move' });
    await expect(turn(b)).toHaveText('Black to move');
    await expect(moveBtn(b)).toBeEnabled();
    expect(await box(b).inputValue()).toBe('Ec4-Ec3');
    return 'Black: "Move" disabled and Enter sent nothing on White\'s turn; enabled with "Ec4-Ec3" still in the field once Bb2–Bb3 landed';
  });
  await g.close();
});

test('making a move: typed errors and Tab', async ({ browser }) => {
  const h = await startG(browser);
  await item('MOVE-14', async () => {
    const w2 = h.white;
    await box(w2).click();
    const out: string[] = [];
    const cases: [string, string][] = [
      ['Bb2', 'Type a move as two cells, like Ab2-Ab3.'],
      ['Ec5-Ec4', 'You have no piece on Ec5.'],
      ['Ba2-Ba5', 'The piece on Ba2 cannot move to Ba5.'],
      ['Ab2-Ab3=Q', 'Ab2-Ab3 is not a promotion.'],
    ];
    for (const [text, msg] of cases) {
      await box(w2).fill(text); await box(w2).press('Enter'); await w2.waitForTimeout(250);
      const got = ((await problem(w2).textContent()) ?? '').trim();
      out.push(got);
      expect(got).toBe(msg);
      expect(await box(w2).inputValue()).toBe(text);
    }
    expect(await sentMoves(w2)).toBe(0);
    await box(w2).press('End'); await w2.keyboard.type('x'); await w2.waitForTimeout(200);
    expect(((await problem(w2).textContent()) ?? '').trim()).toBe('');
    await box(w2).fill('');
    return out.join(' | ');
  });
  await item('MOVE-16', async () => {
    const w2 = h.white;
    await w2.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) { await w2.keyboard.press('Tab'); const f = await focusDesc(w2); seen.push(f); if (f === '#typed-move') break; }
    expect(seen[seen.length - 1]).toBe('#typed-move');
    await w2.keyboard.type('Ab2-Ab3'); await w2.keyboard.press('Enter');
    await expect(turn(w2)).toHaveText('Black to move'); await expect(turn(h.black)).toHaveText('Black to move');
    expect(await listText(h.black)).toContain('1. Ab2–Ab3');
    return `Tab presses to the field: ${seen.length} (${seen.join(', ')})`;
  });
  await h.close();
});

test('making a move: held snapshot', async ({ browser }) => {
  const h2 = await startG(browser);
  await item('MOVE-17', async () => {
    const w2 = h2.white;
    await expect(turn(w2)).toHaveText('White to move');
    await delayAnswersAfterOpen(w2, 12000);
    const s0 = await sentMoves(w2);
    await dropConnection(w2);
    await expect(w2.getByText('Reconnecting…')).toBeVisible();
    await expect(w2.getByText('Reconnecting…')).toHaveCount(0, { timeout: 10000 });
    await w2.evaluate(() => { (window as any).__delayOnOpenMs = 0; });
    const rejoinSent = await w2.evaluate(() => (window as any).__sent.filter((m: any) => m.type === 'rejoin_game').length);
    await press(w2, 'Bb2', 'white'); await w2.waitForTimeout(300);
    const sel = (await boardState(w2)).selectionRings;
    await pressAt(w2, await projectCell(w2, 'Bb3', 'white')); await w2.waitForTimeout(200);
    await box(w2).click(); await w2.keyboard.type('Ab2-Ab3');
    const typedCell = 'Ab2-Ab3';
    const disabled = await moveBtn(w2).isDisabled();
    await w2.keyboard.press('Enter'); await w2.waitForTimeout(200);
    const held = await w2.evaluate(() => (window as any).__delayUntil - Date.now());
    const sentDuring = (await sentMoves(w2)) - s0;
    expect(held, 'the answer was still held at the end of step 2').toBeGreaterThan(0);
    expect(rejoinSent).toBeGreaterThan(0);
    expect(sel).toBe(0); expect(disabled).toBe(true); expect(sentDuring).toBe(0);
    // step 3: the held answer is released when the hold expires
    await w2.waitForTimeout(held + 500);
    await box(w2).fill('');
    await press(w2, 'Bb2', 'white');
    await expect.poll(async () => (await boardState(w2)).selectionRings).toBe(1);
    expect(await turnText(w2)).toBe('White to move');
    await box(w2).fill(typedCell);
    await expect(moveBtn(w2)).toBeEnabled();
    return `held ${held} ms more after step 2; during the hold: no selection, "Move" disabled, 0 moves sent (typed ${typedCell}); after release the board and move box take input`;
  });
  await h2.close();
});

// ---------------------------------------------------------------------------
// play/the-opponents-move.md

test('opponent', async ({ browser }) => {
  const g = await startG(browser);
  await item('OPP-01', async () => {
    const b = g.black;
    for (const c of ['Ec4', 'Ed5', 'Eb4']) { await press(b, c, 'black'); await b.waitForTimeout(200); }
    const s = await boardState(b);
    const c0 = await cameraInfo(b); await drag(b, { x: 20, y: 400 }, 150, 0); await settle(b);
    expect(s.selectionRings).toBe(0); expect(await glowing(b, 'black')).toEqual([]);
    expect(camMoved(c0, await cameraInfo(b))).toBeTruthy();
  });
  await item('OPP-03', async () => {
    await dropConnection(g.black, { block: true });
    await expect(g.black.getByText('Reconnecting…')).toBeVisible();
    await playOn(g.white, 'white', 'Bb2', 'Bb3');
    await expect(turn(g.white)).toHaveText('Black to move');
    expect(await turnText(g.black)).toBe('White to move');
    await watchAnim(g.black);
    await releaseConnection(g.black);
    await expect(turn(g.black)).toHaveText('Black to move', { timeout: 15000 });
    await g.black.waitForTimeout(1500);
    const a = await readAnim(g.black);
    expect((await pieceMap(g.black, 'black'))['Bb3']).toBe('white Pawn');
    expect(a.moving).toBeGreaterThan(0);
    return `glide samples in motion after the snapshot: ${a.moving}`;
  });
  await g.close();
});

test('opponent: away', async ({ browser }) => {
  const h = await startG(browser);
  await item('OPP-04', async () => {
    const ctx = h.black.context(); const url = h.black.url();
    await h.black.close();
    await expect(h.white.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    await playOn(h.white, 'white', 'Bb2', 'Bb3');
    await expect(turn(h.white)).toHaveText('Black to move');
    const nb = await ctx.newPage();
    await nb.goto(url); await board(nb);
    await watchAnim(nb);
    await nb.waitForTimeout(1200);
    const a = await readAnim(nb);
    const s = await boardState(nb);
    expect((await pieceMap(nb, 'black'))['Bb3']).toBe('white Pawn');
    expect(await lastCells(nb, 'black')).toEqual(['from:Bb2', 'to:Bb3']);
    expect(s.glides).toBe(0); expect(a.glides).toBe(0);
    expect(await turnText(nb)).toBe('Black to move');
  });
  await h.close();
});

test('opponent: second tab', async ({ browser }) => {
  const k = await startG(browser);
  await item('OPP-07', async () => {
    const ctx = k.black.context(); const url = k.black.url();
    const tabA = k.black;
    await dropConnection(tabA, { block: true });
    await expect(tabA.getByText('Reconnecting…')).toBeVisible();
    const tabB = await ctx.newPage(); await tabB.goto(url); await board(tabB);
    await expect(tabB.getByText('You are playing as black.')).toBeVisible();
    await tabB.waitForTimeout(500);
    await releaseConnection(tabA);
    const dlg = tabA.getByRole('alertdialog', { name: 'This game is open in another tab' });
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await expect(dlg.getByRole('button', { name: 'Play here' })).toBeVisible();
    expect(await tabB.locator('[role=alertdialog]').count()).toBe(0);
    await playOn(k.white, 'white', 'Bb2', 'Bb3');
    await expect(turn(tabB)).toHaveText('Black to move');
    await tabA.waitForTimeout(1000);
    expect(await listText(tabB)).toContain('1. Bb2–Bb3');
    expect(await listText(tabA)).not.toContain('Bb2–Bb3');
    expect(await turnText(tabA)).toBe('White to move');
    await expect(dlg).toBeVisible();
    return 'tab A: replaced dialog after its connection returned; tab B kept the board and received the move; tab A did not';
  });
  await k.close();
});

test('opponent: reduced motion', async ({ browser }) => {
  const r = await startG(browser);
  await item('OPP-06', async () => {
    await r.black.emulateMedia({ reducedMotion: 'reduce' });
    await r.black.reload(); await board(r.black);
    await expect(r.black.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    expect(await r.black.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await watchAnim(r.black); await watchAnim(r.white);
    await playOn(r.white, 'white', 'Bc1', 'Ec4');
    await expect(turn(r.black)).toHaveText('Black to move — in check');
    await r.black.waitForTimeout(1500);
    const ab = await readAnim(r.black), aw = await readAnim(r.white);
    expect((await pieceMap(r.black, 'black'))['Ec4']).toBe('white Queen');
    expect(await lastCells(r.black, 'black')).toEqual(['from:Bc1', 'to:Ec4']);
    expect(ab).toEqual({ glides: 0, moving: 0, ghosts: 0 });
    expect(aw.moving).toBeGreaterThan(0);
    return `reduced-motion page: no glide or ghost samples; White's page: ${aw.moving} glide and ${aw.ghosts} fade samples`;
  });
  await r.close();
});

// ---------------------------------------------------------------------------
// capture, the opponent's move, and check

test('capture and check', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white, b = g.black;
  await item('MOVE-06', async () => {
    await press(w, 'Bc1', 'white');
    await expect.poll(() => highlighted(w, 'white')).toContain('Ec4');
    const px = await piecePixel(w, 'Ec4', 'white');
    await watchAnim(w); await watchAnim(b);
    await pressAt(w, px);
    await expect(turn(w)).toHaveText(/Black to move/);
    await w.waitForTimeout(1500);
    const aw = await readAnim(w);
    (g as any).ab = await readAnim(b);
    expect((await listText(w)).trim()).toBe('1. Bc1–Ec4');
    expect((await pieceMap(w, 'white'))['Ec4']).toBe('white Queen');
    expect(aw.moving).toBeGreaterThan(0); expect(aw.ghosts).toBeGreaterThan(0);
    return `clicked over the pawn's body (first hit there: the ${px.first} of Ec4); glide samples ${aw.moving}, fade samples ${aw.ghosts}`;
  });
  await item('OPP-02', async () => {
    const ab = (g as any).ab;
    expect(ab.moving).toBeGreaterThan(0); expect(ab.ghosts).toBeGreaterThan(0);
    expect(await lastCells(b, 'black')).toEqual(['from:Bc1', 'to:Ec4']);
    expect((await listText(b)).trim()).toBe('1. Bc1–Ec4');
    expect(await turnText(b)).toBe('Black to move — in check');
    expect(await kingGlow(b, 'black')).toBe('#ff2222');
    return `Black's page: glide samples ${ab.moving}, fade samples ${ab.ghosts}`;
  });
  await item('END-01', async () => {
    const t1 = [await turnText(w), await turnText(b)];
    const g1 = [await kingGlow(w, 'black'), await kingGlow(b, 'black')];
    await playOn(b, 'black', 'Ec5', 'Ec4');
    await expect(turn(w)).toHaveText('White to move'); await expect(turn(b)).toHaveText('White to move');
    await w.waitForTimeout(300);
    const g2 = [await kingGlow(w, 'black'), await kingGlow(b, 'black'), await kingGlow(w, 'white'), await kingGlow(b, 'white')];
    expect(t1).toEqual(['Black to move — in check', 'Black to move — in check']);
    expect(g1).toEqual(['#ff2222', '#ff2222']);
    expect(g2.every((e) => e !== '#ff2222')).toBe(true);
  });
  await g.close();
});

// ---------------------------------------------------------------------------
// play/promotion.md

test('promotion', async ({ browser }) => {
  const g = await startG(browser);
  const pw = g.white, pb = g.black;
  await playLine(g, PROMO_LINE);
  await item('PROMO-01', async () => {
    const s0 = await sentMoves(pw); const bl = await listText(pb);
    await openPromotion(pw);
    await expect(pw.getByRole('dialog', { name: 'Promote to' }).getByRole('button')).toHaveText(['Queen', 'Rook', 'Bishop', 'Knight', 'Unicorn', 'Cancel']);
    expect(await turnText(pw)).toBe('White to move');
    expect(await turnText(pb)).toBe('White to move'); expect(await listText(pb)).toBe(bl);
    expect(await sentMoves(pw)).toBe(s0);
  });
  await item('PROMO-02', async () => { expect(await focusDesc(pw)).toBe('BUTTON:Queen'); });
  await item('PROMO-04', async () => {
    const s0 = await sentMoves(pw);
    await pw.keyboard.press('Escape');
    await expect(dialog(pw)).toHaveCount(0);
    expect(await sentMoves(pw)).toBe(s0);
    expect((await boardState(pw)).selectionRings).toBe(0);
    expect(await turnText(pw)).toBe('White to move');
  });
  await item('PROMO-03', async () => {
    await openPromotion(pw);
    await pw.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(pw)).toHaveCount(0);
    expect((await boardState(pw)).selectionRings).toBe(0);
    expect(await turnText(pw)).toBe('White to move');
    await press(pw, 'Da4', 'white'); await pw.waitForTimeout(300);
    const d = await highlighted(pw, 'white');
    await clearSelection(pw, 'white');
    expect(d).toEqual(['Db5', 'Ea5', 'Eb4']);
    return `Da4 destinations after Cancel: ${d.join(', ')}`;
  });
  await item('PROMO-05', async () => {
    const s0 = await sentMoves(pw);
    await openPromotion(pw);
    const hb = await pw.getByRole('heading', { name: 'Promote to' }).boundingBox();
    await pw.mouse.click(hb!.x + hb!.width + 12, hb!.y + hb!.height / 2); await pw.waitForTimeout(300);
    const stays = await dialog(pw).count();
    await pw.mouse.click(10, 10);
    await expect(dialog(pw)).toHaveCount(0);
    expect(stays).toBe(1); expect(await sentMoves(pw)).toBe(s0);
  });
  await item('PROMO-06', async () => {
    await openPromotion(pw);
    const hb = await pw.getByRole('heading', { name: 'Promote to' }).boundingBox();
    await pw.mouse.click(hb!.x + hb!.width + 12, hb!.y + hb!.height / 2);
    const f = await focusDesc(pw);
    await pw.keyboard.press('Escape'); await pw.waitForTimeout(400);
    const stays = await dialog(pw).count();
    await pw.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(pw)).toHaveCount(0);
    expect(stays).toBe(1);
    return `focus after the panel click: ${f}`;
  });
  await item('PROMO-13', async () => {
    await openPromotion(pw);
    const seq = [await focusDesc(pw)];
    for (let i = 0; i < 8; i++) { await pw.keyboard.press('Tab'); seq.push(await focusDesc(pw)); }
    await pw.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(pw)).toHaveCount(0);
    const cycle = ['BUTTON:Queen', 'BUTTON:Rook', 'BUTTON:Bishop', 'BUTTON:Knight', 'BUTTON:Unicorn', 'BUTTON:Cancel'];
    expect(seq[0]).toBe('BUTTON:Queen');
    const pageStops = seq.filter((s) => s !== 'BODY');
    for (let i = 0; i < pageStops.length; i++) expect(pageStops[i], seq.join(' > ')).toBe(cycle[i % 6]);
    expect(seq.slice(1, 6)).toEqual(cycle.slice(1));
    return `focus: ${seq.join(' > ')} (BODY = focus left the page for the browser's own UI)`;
  });
  await item('PROMO-09', async () => {
    await openPromotion(pw);
    await dropConnection(pw);
    await expect(dialog(pw)).toHaveCount(0, { timeout: 3000 });
    await expect(pw.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await pw.waitForTimeout(800);
    expect(await dialog(pw).count()).toBe(0);
    expect(await turnText(pw)).toBe('White to move');
    expect((await boardState(pw)).selectionRings).toBe(0);
  });
  await item('PROMO-12', async () => {
    const s0 = await sentMoves(pw);
    await box(pw).click(); await pw.keyboard.type('Da4-Ea5'); await pw.keyboard.press('Enter'); await pw.waitForTimeout(300);
    expect(((await problem(pw).textContent()) ?? '').trim()).toBe('Say which piece to promote to: add =Q, =R, =B, =N or =U.');
    expect(await dialog(pw).count()).toBe(0);
    expect(await sentMoves(pw)).toBe(s0);
    await box(pw).fill('');
  });
  await item('PROMO-07', async () => {
    await openPromotion(pw);
    await watchAnim(pw); await watchAnim(pb);
    await pw.getByRole('button', { name: 'Unicorn' }).click();
    await expect(dialog(pw)).toHaveCount(0);
    await expect(turn(pw)).toHaveText('Black to move'); await expect(turn(pb)).toHaveText('Black to move');
    await pw.waitForTimeout(1500);
    const aw = await readAnim(pw), ab = await readAnim(pb);
    for (const [p, s] of [[pw, 'white'], [pb, 'black']] as const) {
      expect((await pieceMap(p, s))['Ea5']).toBe('white Unicorn');
      expect(await lastCells(p, s)).toEqual(['from:Da4', 'to:Ea5']);
      expect((await listText(p)).trim().endsWith('Da4–Ea5=U')).toBe(true);
    }
    expect(aw.moving).toBeGreaterThan(0); expect(ab.moving).toBeGreaterThan(0);
    expect(aw.ghosts).toBeGreaterThan(0); expect(ab.ghosts).toBeGreaterThan(0);
    return `glide samples W ${aw.moving} / B ${ab.moving}; Rook fade samples W ${aw.ghosts} / B ${ab.ghosts}`;
  });
  await g.close();
});

test('promotion: Enter', async ({ browser }) => {
  const h = await startG(browser);
  await playLine(h, PROMO_LINE);
  await item('PROMO-08', async () => {
    await openPromotion(h.white);
    await h.white.keyboard.press('Enter');
    await expect(turn(h.white)).toHaveText('Black to move'); await expect(turn(h.black)).toHaveText('Black to move');
    expect((await listText(h.white)).trim().endsWith('Da4–Ea5=Q')).toBe(true);
    expect((await listText(h.black)).trim().endsWith('Da4–Ea5=Q')).toBe(true);
    expect((await pieceMap(h.white, 'white'))['Ea5']).toBe('white Queen');
  });
  await h.close();
});

test('promotion: typed', async ({ browser }) => {
  const k = await startG(browser);
  await playLine(k, PROMO_LINE);
  await item('PROMO-11', async () => {
    await watchAnim(k.white); await watchAnim(k.black);
    let sawDialog = 0;
    await box(k.white).click(); await k.white.keyboard.type('Da4-Ea5=U'); await k.white.keyboard.press('Enter');
    for (let i = 0; i < 10; i++) { sawDialog += await dialog(k.white).count(); await k.white.waitForTimeout(50); }
    await expect(turn(k.white)).toHaveText('Black to move'); await expect(turn(k.black)).toHaveText('Black to move');
    await k.white.waitForTimeout(1500);
    const aw = await readAnim(k.white), ab = await readAnim(k.black);
    expect(sawDialog).toBe(0);
    expect((await pieceMap(k.white, 'white'))['Ea5']).toBe('white Unicorn'); expect((await pieceMap(k.black, 'black'))['Ea5']).toBe('white Unicorn');
    expect((await listText(k.white)).trim().endsWith('Da4–Ea5=U')).toBe(true); expect((await listText(k.black)).trim().endsWith('Da4–Ea5=U')).toBe(true);
    expect(aw.moving).toBeGreaterThan(0); expect(ab.moving).toBeGreaterThan(0);
    return `no dialog; glide samples W ${aw.moving} / B ${ab.moving}`;
  });
  await k.close();
});

test('promotion: narrow', async ({ browser }) => {
  const n = await startG(browser, { viewport: { width: 375, height: 667 } });
  await item('PROMO-10', async () => {
    await playLine(n, PROMO_LINE);
    await openPromotion(n.white);
    const q = await n.white.getByRole('button', { name: 'Queen' }).boundingBox();
    const u = await n.white.getByRole('button', { name: 'Unicorn' }).boundingBox();
    const panel = await n.white.getByRole('heading', { name: 'Promote to' }).locator('..').boundingBox();
    await n.white.screenshot({ path: 'test-results/promotion-narrow.png' });
    const rows = new Set<number>();
    for (const name of ['Queen', 'Rook', 'Bishop', 'Knight', 'Unicorn']) rows.add(Math.round((await n.white.getByRole('button', { name }).boundingBox())!.y));
    expect(rows.size).toBeGreaterThan(1);
    expect(panel!.x).toBeGreaterThanOrEqual(0); expect(panel!.x + panel!.width).toBeLessThanOrEqual(375);
    expect(panel!.y).toBeGreaterThanOrEqual(0); expect(panel!.y + panel!.height).toBeLessThanOrEqual(667);
    return `buttons on ${rows.size} rows (Queen y=${q!.y.toFixed(0)}, Unicorn y=${u!.y.toFixed(0)}); panel x ${panel!.x.toFixed(0)}..${(panel!.x + panel!.width).toFixed(0)} of 375`;
  });
  await n.close();
});

// ---------------------------------------------------------------------------
// play/check-and-game-end.md

test('end of game', async ({ browser }) => {
  const g = await startG(browser);
  const w = g.white, b = g.black;
  await playLine(g, MATE_LINE.slice(0, 3));
  await playOn(b, 'black', 'Bc3', 'Ab2');
  await item('END-02', async () => {
    for (const p of [w, b]) {
      const d = p.getByRole('dialog', { name: 'Black wins by checkmate!' });
      await expect(d).toBeVisible();
      expect(await d.getByRole('button').allTextContents()).toEqual(['Start new game']);
    }
    await w.screenshot({ path: 'test-results/end-dialog.png' });
  });
  await item('END-08', async () => {
    const f = [await focusDesc(w), await focusDesc(b)];
    expect(f).toEqual(['BUTTON:Start new game', 'BUTTON:Start new game']);
  });
  await item('END-03', async () => {
    await w.keyboard.press('Escape'); await w.waitForTimeout(300);
    await w.mouse.click(10, 10); await w.waitForTimeout(300);
    await expect(w.getByRole('dialog', { name: 'Black wins by checkmate!' })).toBeVisible();
  });
  await item('END-04', async () => {
    const c0 = await cameraInfo(w);
    const lb = await w.getByTestId('move-list').boundingBox();
    const sc0 = await w.getByTestId('move-list').evaluate((el) => el.scrollTop);
    await drag(w, { x: 40, y: 400 }, 250, 0);
    await w.mouse.move(lb!.x + lb!.width / 2, lb!.y + lb!.height / 2); await w.mouse.wheel(0, -400);
    await w.waitForTimeout(800);
    expect((await cameraInfo(w)).pos).toEqual(c0.pos);
    expect(await w.getByTestId('move-list').evaluate((el) => el.scrollTop)).toBe(sc0);
  });
  await item('END-05', async () => {
    expect(await turnText(w)).toBe('White to move');
    expect(await kingGlow(w, 'white')).toBe('#ff2222');
  });
  await item('END-07', async () => {
    await b.reload();
    const atBoard = await b.waitForFunction(() => { const s = (window as any).__r3fState; return s ? { dialog: document.querySelectorAll('[role=dialog]').length } : null; }, undefined, { polling: 10 });
    const first = await atBoard.jsonValue();
    await watchAnim(b); await b.waitForTimeout(1000);
    const a = await readAnim(b);
    await expect(b.getByRole('dialog', { name: 'Black wins by checkmate!' })).toBeVisible();
    expect(first.dialog).toBe(1);
    expect(a.glides).toBe(0);
    expect((await boardState(b)).glides).toBe(0);
    return 'the dialog was in the DOM at the first poll that found the board; no glide';
  });
  await item('END-11', async () => {
    await dropConnection(b, { block: true });
    const rc = b.getByText('Reconnecting…');
    await expect(rc).toBeVisible();
    await expect(b.getByRole('dialog', { name: 'Black wins by checkmate!' })).toBeVisible();
    const bb = await rc.boundingBox();
    const cx = bb!.x + bb!.width / 2, cy = bb!.y + bb!.height / 2;
    const top = await b.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.closest('[role=dialog]') ? 'dialog backdrop' : e.textContent?.slice(0, 30)) : null; }, [cx, cy]);
    await b.mouse.click(cx, cy); await b.waitForTimeout(300);
    const afterClick = { dialog: await dialog(b).count(), rc: await rc.count(), focus: await focusDesc(b) };
    await releaseConnection(b);
    await expect(rc).toHaveCount(0, { timeout: 15000 });
    await b.waitForTimeout(500);
    await expect(b.getByRole('dialog', { name: 'Black wins by checkmate!' })).toBeVisible();
    expect(top).toBe('dialog backdrop');
    expect(afterClick.dialog).toBe(1); expect(afterClick.rc).toBe(1);
    return `the point over "Reconnecting…" belongs to the ${top}; clicking it changed nothing`;
  });
  const oldUrl = w.url();
  const listB = await listText(b);
  await item('END-06', async () => {
    await w.getByRole('button', { name: 'Start new game', exact: true }).click();
    await expect(w.getByRole('button', { name: 'Start New Game', exact: true })).toBeEnabled();
    expect(new URL(w.url()).pathname).toBe('/');
    await expect(b.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
  });
  await item('END-09', async () => {
    await w.getByRole('button', { name: 'Start New Game', exact: true }).click();
    await w.waitForURL(/\/game\/[A-Z0-9]+/);
    await expect(w.getByText('Game created! Share this link with a friend:')).toBeVisible();
    expect(w.url()).not.toBe(oldUrl);
    await b.waitForTimeout(500);
    await expect(b.getByRole('dialog', { name: 'Black wins by checkmate!' })).toBeVisible();
    expect(await listText(b)).toBe(listB);
    return `new id ${w.url().split('/').pop()} (old ${oldUrl.split('/').pop()}); Black's page of the old game unchanged`;
  });
  await item('END-10', async () => {
    await b.getByRole('button', { name: 'Start new game', exact: true }).focus();
    const seq: string[] = [];
    for (let i = 0; i < 6; i++) { await b.keyboard.press('Tab'); seq.push(await focusDesc(b)); }
    const bad = seq.filter((s) => s !== 'BODY' && s !== 'BUTTON:Start new game');
    expect(bad, seq.join(' > ')).toEqual([]);
    expect(seq).toContain('BUTTON:Start new game');
    await b.getByRole('button', { name: 'Start new game', exact: true }).focus();
    await b.keyboard.press('Enter');
    await expect(b.getByRole('button', { name: 'Start New Game', exact: true })).toBeVisible();
    return `Tab sequence: ${seq.join(' > ')} (BODY = the browser's own UI); Enter went to the start screen`;
  });
  await g.close();
});
