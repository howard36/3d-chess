import { test, expect, type Page } from '@playwright/test';
import { Vector3 } from 'three';
import { settle, fps, startTappedGame, socketTap, item, press, drag, projectCell, boardState, cameraInfo, pieceMap, highlighted, turnText, listText, dropConnection, releaseConnection, attemptTimes, playOn, newTappedPage, clickThenCut, getPlayerColor, waitForBoard } from './vh';
import { playLine, MATE_LINE } from './line';
import { BOARD_HALF_EXTENT, fitDistance } from '../../../client/src/three/cameraFit';
import { toWorld, CELL_FLOOR_Y } from '../../../client/src/three/layout';
import { fromZXY } from '../../../client/src/engine/coords';

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

// --- Local helpers --------------------------------------------------------------
const storageKeys = (p: Page) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const clientIdOf = (p: Page) => p.evaluate(() => sessionStorage.getItem('3dchess:clientId'));
const presence = (p: Page) => p.getByTestId('opponent-presence');
const replacedDialog = (p: Page) => p.getByRole('alertdialog', { name: 'This game is open in another tab' });
const focusDesc = (p: Page) =>
  p.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return 'BODY';
    return `${a.tagName}${a.id ? '#' + a.id : ''}:${a.getAttribute('aria-label') ?? a.textContent?.trim() ?? ''}`;
  });
const sel = async (p: Page) => (await boardState(p)).selectionRings;
const TITLE = '3D Chess — Online Multiplayer';
const BG = { x: 20, y: 400 };
/** Waits for the start screen's connection to be up (no "Reconnecting to server…" line). */
const startScreenReady = async (p: Page) => {
  await expect(p.getByRole('button', { name: 'Start New Game' })).toBeVisible();
  await p.waitForTimeout(500);
  await expect(p.getByText('Reconnecting to server…')).toHaveCount(0, { timeout: 15000 });
};
/** Presses `cell` repeatedly (the board may still be waiting for its snapshot) until it is selected. */
async function pressUntilSelected(p: Page, cell: string, seat: 'white' | 'black', ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await press(p, cell, seat); await p.waitForTimeout(300);
    if ((await sel(p)) === 1) return Date.now() - t0;
  }
  throw new Error(`${cell} never became selectable`);
}
const dirOf = (c: { pos: number[]; target: number[] | null }) => {
  const t = c.target ?? [0, 0, 0];
  return new Vector3(c.pos[0] - t[0], c.pos[1] - t[1], c.pos[2] - t[2]).normalize();
};
/** Screen positions of the 8 corners of the lattice's bounding box. */
const cornerPixels = (p: Page) =>
  p.evaluate((h) => {
    const { camera, size } = (window as any).__r3fState.get();
    camera.updateMatrixWorld();
    const out: { x: number; y: number }[] = [];
    for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) {
      const v = new camera.position.constructor(x, y, z).project(camera);
      out.push({ x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height });
    }
    return { out, w: size.width, h: size.height };
  }, BOARD_HALF_EXTENT);
async function wheelFully(p: Page, dy: number, n = 60) {
  const vp = p.viewportSize()!;
  await p.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dy); await p.waitForTimeout(20); }
  await p.waitForTimeout(1500); await settle(p);
  return (await cameraInfo(p)).dist!;
}
async function finishGame(g: { white: Page; black: Page }) {
  await playLine(g, MATE_LINE.slice(0, 3));
  await playOn(g.black, 'black', 'Bc3', 'Ab2');
  await expect(g.white.getByText('Black wins by checkmate!')).toBeVisible();
}

test('rules-09 redo', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('RULES-09', async () => {
    await playLine(g, ['Bc1-Ec4']).catch(() => {}); // playLine expects plain "Black to move"
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('Black to move — in check');
    await expect(g.black.getByTestId('turn-indicator')).toHaveText('Black to move — in check');
    const kingGlow = async (p: Page) => p.evaluate(() => { let e = ''; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.piece?.type === 'King' && o.userData.piece.color === 'black') e = o.userData.emissive; }); return e; });
    expect(await kingGlow(g.white)).toBe('#ff2222');
    expect(await kingGlow(g.black)).toBe('#ff2222');
    const res: string[] = [];
    for (const [sq, want] of [['Ec5', ['Ec4']], ['Dc5', ['Ec4']], ['Dd5', ['Ec4']], ['Ed4', []]] as const) {
      let ok = false;
      for (let turn = 0; turn < 6 && !ok; turn++) {
        try { await press(g.black, sq, 'black'); ok = true; } catch { await drag(g.black, BG, 120, 0); await settle(g.black); if (turn === 0) res.push(`${sq} hidden from the default view, pressed after orbiting`); }
      }
      if (!ok) throw new Error(`${sq} not reachable`);
      await g.black.waitForTimeout(300);
      expect(await highlighted(g.black, 'black')).toEqual(want);
    }
    return res.join('; ');
  });
  await g.close();
});

test('conn', async ({ browser }) => {
  // CONN-01, CONN-02
  const ctxA = await browser.newContext(); await ctxA.addInitScript(socketTap);
  const ctxB = await browser.newContext(); await ctxB.addInitScript(socketTap);
  const a = await ctxA.newPage(); const b = await ctxB.newPage();
  await a.goto('/');
  await a.getByRole('button', { name: 'Start New Game' }).click();
  await a.waitForURL(/\/game\/[A-Z0-9]+/);
  const id = a.url().split('/game/')[1];
  let creatorColor = '';
  await item('CONN-01', async () => {
    await expect(a.getByText('Game created! Share this link with a friend:')).toBeVisible();
    const s = await storageKeys(a);
    creatorColor = s[`3dchess:role:${id}`] ?? '';
    expect(['white', 'black']).toContain(creatorColor);
    return `3dchess:role:${id} = ${creatorColor} on the share-link screen`;
  });
  await b.goto(a.url());
  await b.getByRole('button', { name: 'Join Game' }).click();
  await waitForBoard(b); await waitForBoard(a);
  await item('CONN-02', async () => {
    const s = await storageKeys(b);
    expect(s[`3dchess:role:${id}`]).toBe(creatorColor === 'white' ? 'black' : 'white');
  });
  const white = creatorColor === 'white' ? a : b; const black = creatorColor === 'white' ? b : a;
  await item('CONN-06', async () => {
    await expect(presence(white)).toHaveText('Opponent: online');
    const seen: string[] = [];
    const poll = (async () => { for (let i = 0; i < 60; i++) { seen.push((await presence(white).textContent().catch(() => '')) ?? ''); await white.waitForTimeout(50); } })();
    await black.reload();
    await poll;
    await expect(presence(white)).toHaveText('Opponent: online');
    expect(seen).toContain('Opponent: offline');
    return `sequence seen: ${[...new Set(seen)].join(' -> ')}`;
  });
  await waitForBoard(black);
  await item('CONN-07', async () => {
    // The joiner opened the link directly, so Back would leave the app; give Black's tab
    // the start screen as its previous entry, as a player who came from it has.
    const url = black.url();
    await black.goto('/'); await expect(black.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    await black.goto(url); await waitForBoard(black);
    await expect(presence(white)).toHaveText('Opponent: online');
    await black.goBack();
    await expect(black.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    await expect(presence(white)).toHaveText('Opponent: offline');
    await black.goForward();
    await waitForBoard(black);
    await expect(presence(white)).toHaveText('Opponent: online');
  });
  await item('CONN-03', async () => {
    await dropConnection(white, { block: true });
    await expect(white.getByText('Reconnecting…')).toBeVisible();
    const t0 = Date.now();
    let always = true;
    while (Date.now() - t0 < 20000) {
      if (!(await white.getByText('Reconnecting…').isVisible())) always = false;
      await white.waitForTimeout(250);
    }
    const t = (await attemptTimes(white)).filter((x) => x >= t0 - 100);
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    await releaseConnection(white);
    await expect(white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    expect(always).toBe(true);
    return `attempts after drop at +${t.length ? t[0] - t0 : '?'} ms, then gaps ${JSON.stringify(gaps)}; "Reconnecting…" throughout`;
  });
  await item('CONN-10', async () => {
    await expect(presence(white)).toHaveText('Opponent: online');
    await dropConnection(white, { block: true });
    await expect(white.getByText('Reconnecting…')).toBeVisible();
    await black.context().close();
    await white.waitForTimeout(1500);
    const during = await presence(white).textContent();
    await releaseConnection(white);
    await expect(white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await expect(presence(white)).toHaveText('Opponent: offline');
    expect(during).toBe('Opponent: online');
  });
  const blackCtx = creatorColor === 'white' ? ctxB : ctxA;
  const whiteCtx = creatorColor === 'white' ? ctxA : ctxB;
  await ctxA.close().catch(() => {}); await ctxB.close().catch(() => {});
  void blackCtx; void whiteCtx;

  // CONN-11 and CONN-12 on a fresh game (CONN-10 closed Black's whole context)
  const g = await startTappedGame(browser);
  const blackContext = g.black.context();
  await item('CONN-11', async () => {
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('White to move');
    const url = g.white.url();
    await g.black.close();
    await expect(presence(g.white)).toHaveText('Opponent: offline');
    await playOn(g.white, 'white', 'Ab2', 'Ab3');
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect((await pieceMap(g.white, 'white'))['Ab3']).toBe('white Pawn');
    const b2 = await blackContext.newPage();
    await b2.goto(url);
    await waitForBoard(b2);
    await expect(b2.getByTestId('turn-indicator')).toHaveText('Black to move');
    await expect(b2.getByTestId('move-list')).toContainText('Ab2–Ab3');
    let maxGlide = 0;
    for (let i = 0; i < 10; i++) { maxGlide = Math.max(maxGlide, (await boardState(b2)).glides); await b2.waitForTimeout(50); }
    const s = await boardState(b2);
    expect(maxGlide).toBe(0); expect(s.lastFrom + s.lastTo).toBe(2);
    expect((await pieceMap(b2, 'black'))['Ab3']).toBe('white Pawn');
  });
  await item('CONN-12', async () => {
    const url = g.white.url();
    const b2 = blackContext.pages()[0];
    await b2.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await b2.close();
    const b3 = await blackContext.newPage();
    await b3.goto(url);
    await expect(b3.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await b3.getByRole('button', { name: 'Join Game' }).click();
    await expect(b3.getByRole('alert')).toHaveText(/Error: Game full/);
    await expect(b3.getByRole('button', { name: 'Join Game' })).toBeVisible();
    return 'join screen, then "Error: Game full"';
  });
  await g.close();
});

test('second tab', async ({ browser }) => {
  const g = await startTappedGame(browser);
  const url = g.white.url();
  let t2: Page | null = null;
  let id1 = '', id2 = '';
  await item('CONN-13', async () => {
    id1 = (await clientIdOf(g.white)) ?? '';
    await g.white.reload(); await waitForBoard(g.white);
    await expect(g.white.getByText('You are playing as white.')).toBeVisible();
    const again = (await clientIdOf(g.white)) ?? '';
    t2 = await g.white.context().newPage();
    await t2.goto(url); await waitForBoard(t2);
    id2 = (await clientIdOf(t2)) ?? '';
    expect(id1).not.toBe(''); expect(again).toBe(id1);
    expect(id2).not.toBe(''); expect(id2).not.toBe(id1);
    return `tab 1 ${id1.slice(0, 8)}… before and after reload; tab 2 ${id2.slice(0, 8)}…`;
  });
  await item('CONN-05', async () => {
    const tab2 = t2 ?? (await g.white.context().newPage());
    if (!t2) { await tab2.goto(url); await waitForBoard(tab2); }
    t2 = tab2;
    await expect(tab2.getByText('You are playing as white.')).toBeVisible();
    await expect(replacedDialog(g.white)).toBeVisible();
    await g.white.waitForTimeout(5000);
    await expect(replacedDialog(g.white)).toBeVisible();
    await expect(tab2.getByRole('alertdialog')).toHaveCount(0);
  });
  await item('CONN-14', async () => {
    const tab2 = t2!;
    const f = await focusDesc(g.white);
    await g.white.keyboard.press('Enter');
    await expect(replacedDialog(g.white)).toHaveCount(0, { timeout: 10000 });
    await expect(g.white.getByText('You are playing as white.')).toBeVisible();
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    const took = await pressUntilSelected(g.white, 'Bb2', 'white');
    await expect(replacedDialog(tab2)).toBeVisible();
    expect(f).toBe('BUTTON:Play here');
    return `focus on "Play here"; Enter took the seat back; Bb2 selectable after ${took} ms; tab 2 shows the dialog`;
  });
  await g.close();
});

test('conn-15 automatic reconnect', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('CONN-15', async () => {
    const tab1 = g.white;
    await dropConnection(tab1, { block: true });
    await expect(tab1.getByText('Reconnecting…')).toBeVisible();
    const tab2 = await tab1.context().newPage();
    await tab2.goto(tab1.url()); await waitForBoard(tab2);
    await expect(tab2.getByText('You are playing as white.')).toBeVisible();
    await releaseConnection(tab1);
    await expect(replacedDialog(tab1)).toBeVisible({ timeout: 20000 });
    await expect(tab1.getByRole('button', { name: 'Play here' })).toBeVisible();
    await tab1.waitForTimeout(1000);
    const alerts = await tab1.getByRole('alert').allTextContents();
    expect(alerts.filter((t) => t.includes('Error:'))).toEqual([]);
    await expect(tab2.getByRole('alertdialog')).toHaveCount(0);
    await playOn(tab2, 'white', 'Ab2', 'Ab3');
    await expect(tab2.getByTestId('turn-indicator')).toHaveText('Black to move');
    await expect(g.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    await expect(presence(g.black)).toHaveText('Opponent: online');
    await expect(replacedDialog(tab1)).toBeVisible();
    return 'tab 1: dialog with "Play here", no error banner; tab 2 played Ab2-Ab3; opponent sees "Opponent: online"';
  });
  await g.close();
});

test('lost answers', async ({ browser }) => {
  await item('CONN-16', async () => {
    const x = await newTappedPage(browser);
    await x.goto('/'); await startScreenReady(x);
    await x.getByRole('button', { name: 'Start New Game' }).click();
    await x.waitForURL(/\/game\/[A-Z0-9]+/);
    const id = x.url().split('/game/')[1];
    const creator = (await storageKeys(x))[`3dchess:role:${id}`];
    const y = await newTappedPage(browser);
    await y.goto(x.url());
    await expect(y.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await y.waitForTimeout(800);
    await clickThenCut(y, 'Join Game');
    await expect(y.getByText('Joined game, waiting for start...')).toBeVisible();
    await y.waitForTimeout(2000);
    const whileDown = await y.getByText('Joined game, waiting for start...').isVisible();
    await releaseConnection(y);
    await waitForBoard(y); await waitForBoard(x);
    const yc = await getPlayerColor(y);
    const stored = (await storageKeys(y))[`3dchess:role:${id}`];
    const alerts = await y.getByRole('alert').allTextContents();
    await x.context().close(); await y.context().close();
    expect(whileDown).toBe(true);
    expect(yc).toBe(creator === 'white' ? 'black' : 'white');
    expect(stored).toBe(yc);
    expect(alerts.join()).not.toContain('Game full');
    return `joined screen while down; then both boards; joiner ${yc} (creator ${creator}), key written; no "Game full"`;
  });
  await item('CONN-17', async () => {
    const p = await newTappedPage(browser);
    await p.goto('/'); await startScreenReady(p);
    await clickThenCut(p, 'Start New Game');
    const btn = p.getByRole('button', { name: 'Creating Game...' });
    await expect(btn).toBeDisabled();
    await p.waitForTimeout(2000);
    await expect(btn).toBeDisabled();
    expect(p.url()).toMatch(/\/$/);
    await releaseConnection(p);
    await p.waitForURL(/\/game\/[A-Z0-9]+/, { timeout: 20000 });
    await expect(p.getByText('Game created! Share this link with a friend:')).toBeVisible();
    const u = p.url();
    await p.context().close();
    return `"Creating Game..." disabled while down; then share-link screen of ${u.split('/game/')[1]}`;
  });
});

test('conn-18 join again', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('CONN-18', async () => {
    await playLine(g, ['Ab2-Ab3']);
    const joiner = g.contexts[1].pages()[0];
    const seat = await getPlayerColor(joiner);
    const id = joiner.url().split('/game/')[1];
    await joiner.evaluate((k) => localStorage.removeItem(k), `3dchess:role:${id}`);
    await joiner.reload();
    await expect(joiner.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await joiner.getByRole('button', { name: 'Join Game' }).click();
    await waitForBoard(joiner);
    await expect(joiner.getByText(`You are playing as ${seat}.`)).toBeVisible();
    expect((await pieceMap(joiner, seat))['Ab3']).toBe('white Pawn');
    await expect(joiner.getByTestId('move-list')).toHaveText('1. Ab2–Ab3');
    await expect(joiner.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect((await joiner.getByRole('alert').allTextContents()).join()).not.toContain('Game full');
    return `joiner (${seat}) got its seat back in the same tab`;
  });
  await g.close();
});

test('nav', async ({ browser }) => {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await item('NAV-02', async () => {
    await p.goto('/games'); await p.waitForTimeout(800);
    const t1 = (await p.locator('body').innerText()).trim();
    const links1 = await p.locator('a').count();
    await p.goto('/game/'); await p.waitForTimeout(800);
    const t2 = (await p.locator('body').innerText()).trim();
    const links2 = await p.locator('a').count();
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const note = `/games text ${JSON.stringify(t1)} links ${links1}; /game/ text ${JSON.stringify(t2)} links ${links2}; body background ${bg}`;
    expect(t1).toBe(''); expect(t2).toBe(''); expect(links1 + links2).toBe(0);
    return note;
  });
  await ctx.close();

  // NAV-01 and NAV-05 in fresh contexts
  const ca = await browser.newContext(); await ca.addInitScript(socketTap);
  const cb = await browser.newContext(); await cb.addInitScript(socketTap);
  const a = await ca.newPage(); const b = await cb.newPage();
  const titles: string[] = [];
  await item('NAV-01', async () => {
    await a.goto('/'); titles.push(`start: ${await a.title()}`);
    await a.getByRole('button', { name: 'Start New Game' }).click();
    await expect(a.getByText('Game created! Share this link with a friend:')).toBeVisible();
    titles.push(`share-link: ${await a.title()}`);
    await b.goto(a.url());
    await expect(b.getByRole('button', { name: 'Join Game' })).toBeVisible();
    const buttons = await b.getByRole('button').allTextContents();
    const joinScreenText = (await b.locator('body').innerText()).trim();
    const seenJoined: boolean[] = [];
    const watch = (async () => { for (let i = 0; i < 40; i++) { seenJoined.push(await b.getByText('Joined game, waiting for start...').isVisible().catch(() => false)); if (await b.evaluate(() => !!(window as any).__r3fState)) break; await b.waitForTimeout(25); } })();
    await b.getByRole('button', { name: 'Join Game' }).click();
    await watch;
    await waitForBoard(a); await waitForBoard(b);
    titles.push(`board: ${await a.title()}`);
    expect(buttons).toEqual(['Join Game']);
    return `join screen buttons ${JSON.stringify(buttons)} (text ${JSON.stringify(joinScreenText.replace(/\n+/g, ' / '))}); "Joined game…" seen ${seenJoined.filter(Boolean).length} of ${seenJoined.length} polls before the board`;
  });
  await item('NAV-05', async () => {
    const aw = (await getPlayerColor(a)) === 'white' ? a : b; const ab = aw === a ? b : a;
    await playOn(aw, 'white', 'Ab2', 'Ab3');
    await expect(ab.getByTestId('turn-indicator')).toHaveText('Black to move');
    titles.push(`after opponent move (Black's page): ${await ab.title()}`);
    for (const t of titles) expect(t.split(': ')[1]).toBe(TITLE);
    return titles.join('; ');
  });
  await ca.close(); await cb.close();

  const g = await startTappedGame(browser);
  await item('NAV-03', async () => {
    const id = g.white.url().split('/game/')[1];
    const c = await browser.newContext(); const q = await c.newPage();
    await q.goto(`/game/${id.toLowerCase()}`);
    await q.getByRole('button', { name: 'Join Game' }).click();
    await expect(q.getByRole('alert')).toHaveText(/Error: Cannot join/);
    await expect(q.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await c.close();
  });
  await item('NAV-06', async () => {
    await dropConnection(g.white, { block: true });
    await expect(g.white.getByText('Reconnecting…')).toBeVisible();
    let always = true;
    for (let i = 0; i < 8; i++) { if ((await g.white.locator('canvas').count()) !== 1) always = false; await g.white.waitForTimeout(250); }
    await releaseConnection(g.white);
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    expect(await g.white.locator('canvas').count()).toBe(1);
    expect(always).toBe(true);
  });
  await finishGame(g);
  await item('NAV-09', async () => {
    const w = g.white;
    await w.waitForTimeout(300);
    const f = await focusDesc(w);
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      await w.keyboard.press('Tab');
      seen.push(await w.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body) return 'BODY';
        const inDlg = !!a.closest('[role="dialog"]');
        return `${inDlg ? 'dialog' : 'OUTSIDE'}:${a.tagName}:${a.id || a.getAttribute('aria-label') || a.textContent?.trim()}`;
      }));
    }
    // Back on the dialog's button, press Enter
    let g2 = await focusDesc(w);
    for (let i = 0; i < 4 && g2 !== 'BUTTON:Start new game'; i++) { await w.keyboard.press('Tab'); g2 = await focusDesc(w); }
    await w.keyboard.press('Enter');
    await expect(w.getByRole('button', { name: 'Start New Game', exact: true })).toBeVisible();
    expect(f).toBe('BUTTON:Start new game');
    expect(seen.filter((s) => s.startsWith('OUTSIDE'))).toEqual([]);
    await w.goBack();
    await expect(w.getByText('Black wins by checkmate!')).toBeVisible();
    return `focus on open: "Start new game"; Tab cycle: ${[...new Set(seen)].join(', ')}; Enter -> start screen`;
  });
  await item('NAV-04', async () => {
    const w = g.white;
    await w.getByRole('button', { name: 'Start new game', exact: true }).click();
    await expect(w.getByRole('button', { name: 'Start New Game', exact: true })).toBeVisible();
    await w.goBack();
    await waitForBoard(w);
    await expect(w.getByText('Black wins by checkmate!')).toBeVisible();
  });
  await item('NAV-08', async () => {
    const w = g.white;
    const urlA = w.url();
    await w.getByRole('button', { name: 'Start new game', exact: true }).click();
    await startScreenReady(w);
    await w.getByRole('button', { name: 'Start New Game', exact: true }).click();
    await w.waitForURL((u) => /\/game\/[A-Z0-9]+/.test(u.toString()) && u.toString() !== urlA);
    await expect(w.getByText('Game created! Share this link with a friend:')).toBeVisible();
    const urlB = w.url();
    await w.evaluate(() => history.go(-2));
    await w.waitForURL(urlA);
    await waitForBoard(w);
    await expect(w.getByText('Black wins by checkmate!')).toBeVisible();
    await w.waitForTimeout(1500);
    const alerts = await w.getByRole('alert').allTextContents();
    expect(alerts.filter((t) => t.includes('Error:'))).toEqual([]);
    await expect(presence(g.black)).toHaveText('Opponent: online');
    return `from ${urlB.split('/game/')[1]} back to ${urlA.split('/game/')[1]}: finished game shown, no error, Black sees "Opponent: online"`;
  });
  await g.close();

  await item('NAV-10', async () => {
    const q = await newTappedPage(browser);
    await q.goto('/'); await startScreenReady(q);
    await q.getByRole('button', { name: 'Start New Game' }).click();
    await expect(q.getByText('Game created! Share this link with a friend:')).toBeVisible();
    const u = q.url();
    await dropConnection(q, { block: true });
    await expect(q.getByText('Reconnecting…')).toBeVisible();
    await q.goBack();
    await expect(q.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    await q.goForward();
    await q.waitForURL(u);
    await expect(q.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await expect(q.getByText('Reconnecting…')).toBeVisible();
    await q.waitForTimeout(1000);
    await releaseConnection(q);
    await expect(q.getByText('Reconnecting…')).toHaveCount(0, { timeout: 20000 });
    await q.waitForTimeout(3000);
    const alerts = await q.getByRole('alert').allTextContents();
    await expect(q.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await q.context().close();
    expect(alerts.join()).not.toContain('Already in a game');
    return `share-link screen with "Reconnecting…" while down; afterwards alerts ${JSON.stringify(alerts)}`;
  });
});

test('view', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('VIEW-01', async () => {
    const pw = await projectCell(g.white, 'Aa1', 'white'); const pw2 = await projectCell(g.white, 'Ae1', 'white'); const pw3 = await projectCell(g.white, 'Ea5', 'white');
    const pb = await projectCell(g.black, 'Ee5', 'black'); const pb2 = await projectCell(g.black, 'Ea5', 'black'); const pb3 = await projectCell(g.black, 'Aa1', 'black');
    expect(pw.x).toBeLessThan(pw2.x); expect(pw.y).toBeGreaterThan(pw3.y);
    expect(pb.x).toBeLessThan(pb2.x); expect(pb.y).toBeGreaterThan(pb3.y);
    expect(Math.abs(pw.x - pb.x)).toBeLessThan(0.5); expect(Math.abs(pw.y - pb.y)).toBeLessThan(0.5);
    await g.white.screenshot({ path: 'test-results/view-white.png' });
    await g.black.screenshot({ path: 'test-results/view-black.png' });
    return `White's Aa1 and Black's Ee5 project to the same pixel (${pw.x.toFixed(0)},${pw.y.toFixed(0)}); a->e runs left to right for White, a on the right for Black`;
  });
  await item('VIEW-03', async () => {
    const w = await cameraInfo(g.white), b = await cameraInfo(g.black);
    const want = new Vector3(6.5, 5, 8.5).normalize();
    for (const c of [w, b]) {
      expect(dirOf(c).angleTo(want)).toBeLessThan(0.001);
      expect(Math.abs(c.dist! - 14.5)).toBeLessThan(0.3);
    }
    for (let i = 0; i < 3; i++) expect(Math.abs(w.pos[i] - b.pos[i])).toBeLessThan(1e-6);
    return `both at [${w.pos.map((v: number) => v.toFixed(3)).join(', ')}], ${w.dist!.toFixed(2)} units from the target`;
  });
  await item('VIEW-13', async () => {
    const { out, w, h } = await cornerPixels(g.white);
    const inside = out.every((c) => c.x >= 0 && c.x <= w && c.y >= 0 && c.y <= h);
    // The feet of White's nearest pieces (back rank of level A): the base of each cell's floor
    const feet = await g.white.evaluate(([cells, floorY]) => {
      const { camera, size } = (window as any).__r3fState.get();
      return (cells as number[][]).map(([x, y, z]) => { const v = new camera.position.constructor(x, y + (floorY as number), z).project(camera); return { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height }; });
    }, [['Aa1', 'Ab1', 'Ac1', 'Ad1', 'Ae1'].map((c) => toWorld(fromZXY(c), 'white')), CELL_FLOOR_Y] as const);
    const feetIn = feet.every((c) => c.x >= 0 && c.x <= w && c.y >= 0 && c.y <= h);
    const ys = out.map((c) => c.y), xs = out.map((c) => c.x);
    await g.white.screenshot({ path: 'test-results/view-13-fit.png' });
    expect(inside).toBe(true); expect(feetIn).toBe(true);
    return `corners span x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}, y ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)} in ${w}x${h}; lowest foot at y ${Math.max(...feet.map((f) => f.y)).toFixed(0)}`;
  });
  await item('VIEW-02', async () => {
    const before = await projectCell(g.white, 'Bb2', 'white'); const after = await projectCell(g.white, 'Cb2', 'white');
    const d0 = await g.white.evaluate(() => 0);
    void d0;
    await playOn(g.white, 'white', 'Bb2', 'Cb2');
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    return `screen shift of the step up a level: dx=${(after.x - before.x).toFixed(0)} dy=${(after.y - before.y).toFixed(0)} px (depth; see screenshots)`;
  });
  await item('VIEW-10', async () => {
    await playOn(g.black, 'black', 'Ed4', 'Ed3');
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('White to move');
    const rate = await fps(g.white);
    await playOn(g.white, 'white', 'Bc1', 'Ec4');
    const t0 = Date.now();
    const seen = { w: { g: 0, h: 0 }, b: { g: 0, h: 0 } };
    let goneAt = 0;
    while (Date.now() - t0 < 10000) {
      const [sw, sb] = await Promise.all([boardState(g.white), boardState(g.black)]);
      seen.w.g = Math.max(seen.w.g, sw.glides); seen.w.h = Math.max(seen.w.h, sw.ghosts);
      seen.b.g = Math.max(seen.b.g, sb.glides); seen.b.h = Math.max(seen.b.h, sb.ghosts);
      if (seen.w.h && !sw.ghosts) { goneAt = Date.now() - t0; break; }
      await g.white.waitForTimeout(20);
    }
    expect(seen.w.g).toBe(1); expect(seen.b.g).toBe(1); expect(seen.w.h).toBe(1); expect(seen.b.h).toBe(1);
    expect(goneAt).toBeGreaterThan(0);
    return `glide and fading piece on both pages; fade finished ${goneAt} ms after the press at ${rate} frames/s (software rendering)`;
  });
  await item('VIEW-11', async () => {
    await g.white.reload(); await waitForBoard(g.white);
    await g.white.waitForTimeout(100);
    let maxG = 0, maxH = 0;
    for (let i = 0; i < 10; i++) { const s = await boardState(g.white); maxG = Math.max(maxG, s.glides); maxH = Math.max(maxH, s.ghosts); await g.white.waitForTimeout(50); }
    const s = await boardState(g.white);
    expect(maxG).toBe(0); expect(maxH).toBe(0); expect(s.lastFrom + s.lastTo).toBe(2);
    expect((await pieceMap(g.white, 'white'))['Ec4']).toBe('white Queen');
  });
  await item('VIEW-07', async () => {
    await drag(g.white, BG, 200, 0); await settle(g.white);
    const c1 = await cameraInfo(g.white);
    await playOn(g.black, 'black', 'Ec5', 'Ec4');
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('White to move');
    await settle(g.white);
    const c2 = await cameraInfo(g.white);
    const moved = Math.hypot(...c2.pos.map((v: number, i: number) => v - c1.pos[i]));
    expect(moved).toBeLessThan(0.1);
    await g.white.reload(); await waitForBoard(g.white); await g.white.waitForTimeout(300);
    const c3 = await cameraInfo(g.white);
    expect(dirOf(c3).angleTo(new Vector3(6.5, 5, 8.5))).toBeLessThan(0.001);
    expect(Math.abs(c3.dist! - 14.5)).toBeLessThan(0.3);
    return `angle kept through the opponent's move (camera moved ${moved.toFixed(3)}); after reload back at the default direction, ${c3.dist!.toFixed(2)} units`;
  });
  await item('VIEW-04', async () => {
    const w = g.white;
    const t = async () => (await cameraInfo(w)).target.map((v: number) => +v.toFixed(2));
    await settle(w); const t0 = await t(); await drag(w, BG, 120, 0, 'left'); await settle(w); const t1 = await t();
    await drag(w, BG, 120, 0, 'right'); await settle(w); const t2 = await t();
    await drag(w, BG, 120, 0, 'left', ['Shift']); await settle(w); const t3 = await t();
    await drag(w, BG, 120, 0, 'right', ['Shift']); await settle(w); const t4 = await t();
    const d = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
    expect(d(t1, t0)).toBeLessThan(0.05); expect(d(t2, t1)).toBeGreaterThan(0.3); expect(d(t3, t2)).toBeGreaterThan(0.3); expect(d(t4, t3)).toBeLessThan(0.05);
    return `target moved: orbit ${d(t1, t0).toFixed(3)}, pan ${d(t2, t1).toFixed(2)}, shift+left ${d(t3, t2).toFixed(2)}, shift+right ${d(t4, t3).toFixed(3)}`;
  });
  await item('VIEW-05', async () => {
    const w = g.white;
    const dIn = await wheelFully(w, -500, 40);
    const dOut = await wheelFully(w, 500, 60);
    expect(dIn).toBeCloseTo(6, 1); expect(dOut).toBeCloseTo(25, 1);
    return `stops at ${dIn.toFixed(2)} and ${dOut.toFixed(2)}`;
  });
  await item('VIEW-06', async () => {
    const w = g.white;
    await w.mouse.move(20, 400); await w.mouse.down(); await w.mouse.move(220, 400, { steps: 4 }); await w.mouse.up();
    const a = (await cameraInfo(w)).pos; await w.waitForTimeout(300); const b = (await cameraInfo(w)).pos;
    expect(b).not.toEqual(a);
    return 'camera still moving 300 ms after release';
  });
  await item('VIEW-12', async () => {
    const w = g.white;
    for (let i = 0; i < 6; i++) { await drag(w, BG, 400, 0, 'right'); }
    await w.waitForTimeout(1500);
    const c = await projectCell(w, 'Cc3', 'white');
    const vp = w.viewportSize()!;
    expect(c.x < 0 || c.x > vp.width || c.y < 0 || c.y > vp.height).toBe(true);
    return `board centre now at (${c.x.toFixed(0)},${c.y.toFixed(0)}) in a ${vp.width}x${vp.height} window`;
  });
  await g.close();

  const g2 = await startTappedGame(browser);
  await item('VIEW-15', async () => {
    const w = g2.white;
    await drag(w, BG, -200, 60); await settle(w);
    await w.mouse.move(640, 360);
    for (let i = 0; i < 40 && (await cameraInfo(w)).dist! > 8.3; i++) { await w.mouse.wheel(0, -100); await w.waitForTimeout(150); }
    await settle(w);
    const c1 = await cameraInfo(w);
    const d1 = dirOf(c1);
    await w.setViewportSize({ width: 800, height: 900 });
    await w.waitForTimeout(500); await settle(w);
    const c2 = await cameraInfo(w);
    const d2 = dirOf(c2);
    const size = await w.evaluate(() => { const s = (window as any).__r3fState.get().size; return [s.width, s.height]; });
    const fitted = fitDistance(d1.clone(), size[0] / size[1], 40);
    const angle = (d1.angleTo(d2) * 180) / Math.PI;
    expect(c1.dist!).toBeLessThan(8.6);
    expect(angle).toBeLessThan(1);
    expect(Math.abs(c2.dist! - fitted)).toBeLessThan(0.2);
    expect(c2.dist!).toBeGreaterThan(8);
    const { out, w: cw, h: ch } = await cornerPixels(w);
    expect(out.every((c) => c.x >= -1 && c.x <= cw + 1 && c.y >= -1 && c.y <= ch + 1)).toBe(true);
    return `before resize ${c1.dist!.toFixed(2)} units; after, direction changed ${angle.toFixed(3)}°, distance ${c2.dist!.toFixed(2)} (fit for ${size[0]}x${size[1]}: ${fitted.toFixed(2)}); all corners in frame`;
  });
  await g2.close();

  const g3 = await startTappedGame(browser, { viewport: { width: 375, height: 667 } });
  await item('VIEW-14', async () => {
    const w = g3.white;
    await settle(w);
    const c = await cameraInfo(w);
    const { out, w: cw } = await cornerPixels(w);
    const xs = out.map((p) => p.x);
    await w.screenshot({ path: 'test-results/view-14-narrow.png' });
    const dOut = await wheelFully(w, 500, 80);
    expect(Math.abs(c.dist! - 21.7)).toBeLessThan(0.3);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0); expect(Math.max(...xs)).toBeLessThanOrEqual(cw);
    expect(Math.abs(dOut - 32.6)).toBeLessThan(0.3);
    return `fitted ${c.dist!.toFixed(2)} units; corners x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)} of ${cw}; wheel-out stops at ${dOut.toFixed(2)}`;
  });
  await g3.close();

  const g4 = await startTappedGame(browser);
  await item('VIEW-16', async () => {
    await g4.white.emulateMedia({ reducedMotion: 'reduce' });
    expect(await g4.white.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await playOn(g4.white, 'white', 'Bc1', 'Ec4');
    const t0 = Date.now();
    const seen = { w: { g: 0, h: 0 }, b: { g: 0, h: 0 } };
    while (Date.now() - t0 < 5000) {
      const [sw, sb] = await Promise.all([boardState(g4.white), boardState(g4.black)]);
      seen.w.g = Math.max(seen.w.g, sw.glides); seen.w.h = Math.max(seen.w.h, sw.ghosts);
      seen.b.g = Math.max(seen.b.g, sb.glides); seen.b.h = Math.max(seen.b.h, sb.ghosts);
      await g4.white.waitForTimeout(20);
    }
    const s = await boardState(g4.white);
    const m = await pieceMap(g4.white, 'white');
    expect(seen.w.g).toBe(0); expect(seen.w.h).toBe(0);
    expect(m['Ec4']).toBe('white Queen'); expect(m['Bc1']).toBeUndefined();
    expect(s.lastFrom + s.lastTo).toBe(2);
    expect(seen.b.g).toBe(1); expect(seen.b.h).toBe(1);
    return 'White (reduced motion): no glide, no fade, Queen on Ec4, teal on both cells; Black: glide and fade';
  });
  await g4.close();
});
