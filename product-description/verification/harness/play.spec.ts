import { test, expect, type Page } from '@playwright/test';
import { settle, startTappedGame, item, press, pressAt, projectCell, pixelOf, boardState, cameraInfo, pieceMap, highlighted, turnText, listText, dropConnection, releaseConnection, playOn, drag } from './vh';
import { playLine, MATE_LINE, PROMO_LINE } from './line';
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);
const SHOT = 'test-results/';
const focused = (p: Page) => p.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? `${a.tagName}:${a.textContent}` : 'BODY'; });
const kingGlow = (p: Page, color: string) => p.evaluate((c) => { let e = ''; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.piece?.type === 'King' && o.userData.piece.color === c) e = o.userData.emissive; }); return e; }, color);

test('move', async ({ browser }) => {
  const g = await startTappedGame(browser);
  const w = g.white, b = g.black;
  await item('MOVE-01', async () => {
    await press(w, 'Bc1', 'white'); await w.waitForTimeout(200);
    const s = await boardState(w);
    expect(s.selectionRings).toBe(1); expect(s.highlights).toBe(14); expect(s.captureRings).toBe(1);
    const emissive = await w.evaluate(() => { let e = ''; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.piece?.type === 'Queen' && o.userData.piece.color === 'white') e = o.userData.emissive; }); return e; });
    expect(emissive).toBe('#6b4a00');
    const dots = await w.evaluate(() => { let n = 0; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.geometry?.type === 'SphereGeometry' && o.geometry.parameters?.radius === 0.11) n++; }); return n; });
    expect(dots).toBe(13);
    await w.screenshot({ path: SHOT + 'queen-selected.png' });
  });
  await item('MOVE-05', async () => {
    await press(w, 'Bb2', 'white'); await w.waitForTimeout(150);
    await w.keyboard.press('Escape'); await w.waitForTimeout(150);
    expect((await boardState(w)).selectionRings).toBe(1);
  });
  await item('MOVE-04', async () => {
    const c = await projectCell(w, 'Cd3', 'white');
    await pressAt(w, c); await w.waitForTimeout(200);
    expect((await boardState(w)).selectionRings).toBe(0);
    expect(await turnText(w)).toBe('White to move');
  });
  await item('MOVE-03', async () => {
    await press(w, 'Bc2', 'white'); await w.waitForTimeout(200);
    expect((await boardState(w)).selectionRings).toBe(0);
  });
  await item('OPP-01', async () => {
    await press(w, 'Ba2', 'white'); await w.waitForTimeout(150);
    expect((await boardState(w)).selectionRings).toBe(0);
    const c0 = await cameraInfo(w); await drag(w, { x: 20, y: 400 }, 120, 0); await settle(w);
    expect((await cameraInfo(w)).pos).not.toEqual(c0.pos);
  });
  await item('MOVE-08', async () => {
    await playOn(b, 'black', 'Ec4', 'Ec3');
    await expect(w.getByTestId('turn-indicator')).toHaveText('White to move');
    await press(w, 'Bd2', 'white'); await w.waitForTimeout(150);
    await press(w, 'Bd3', 'white', 'right');
    await expect(w.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await listText(w)).toContain('Bd2–Bd3');
  });
  await item('MOVE-09', async () => {
    await playOn(b, 'black', 'Eb4', 'Eb3');
    await expect(w.getByTestId('turn-indicator')).toHaveText('White to move');
    await press(w, 'Be2', 'white'); await w.waitForTimeout(150);
    await press(w, 'Be3', 'white');
    await dropConnection(w);
    await expect(w.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await w.waitForTimeout(800);
    const t = await turnText(w);
    const l = await listText(w);
    return `after reconnect: "${t}", list ${l.includes('Be2–Be3') ? 'includes' : 'does not include'} Be2–Be3`;
  });
  await g.close();

  const g2 = await startTappedGame(browser);
  await item('MOVE-06', async () => {
    await press(g2.white, 'Bc1', 'white'); await g2.white.waitForTimeout(150);
    // press the pawn mesh itself: raw projection of the pawn's body centre (cell floor + ~0.25)
    const pix = await pixelOf(g2.white, 'Ec4', 'white');
    await pressAt(g2.white, pix);
    await expect(g2.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await listText(g2.white)).toContain('1. Bc1–Ec4');
    expect((await pieceMap(g2.white, 'white'))['Ec4']).toBe('white Queen');
  });
  await item('OPP-02', async () => {
    const s = await boardState(g2.black);
    expect(s.lastFrom + s.lastTo).toBe(2);
    expect(await listText(g2.black)).toContain('1. Bc1–Ec4');
    expect(await turnText(g2.black)).toBe('Black to move');
    expect(await kingGlow(g2.black, 'black')).toBe('#ff2222');
    await g2.black.screenshot({ path: SHOT + 'black-in-check.png' });
  });
  await g2.close();
});

test('opponent', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('OPP-05', async () => {
    const seen: string[] = [];
    const poll = (async () => { for (let i = 0; i < 60; i++) { seen.push((await g.black.getByTestId('opponent-presence').textContent().catch(() => '')) ?? ''); await g.black.waitForTimeout(50); } })();
    await g.white.reload();
    await poll;
    await g.white.waitForFunction(() => !!(window as any).__r3fState);
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    expect(seen).toContain('Opponent: offline');
    expect(await turnText(g.black)).toBe('White to move');
  });
  await item('OPP-03', async () => {
    await dropConnection(g.black, { block: true });
    await expect(g.black.getByText('Reconnecting…')).toBeVisible();
    await playOn(g.white, 'white', 'Bb2', 'Bb3');
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await turnText(g.black)).toBe('White to move');
    await releaseConnection(g.black);
    await expect(g.black.getByTestId('turn-indicator')).toHaveText('Black to move', { timeout: 15000 });
    const s = await boardState(g.black);
    expect((await pieceMap(g.black, 'black'))['Bb3']).toBe('white Pawn');
    return `glide wrapper present right after the snapshot: ${s.glides}`;
  });
  await item('OPP-04', async () => {
    const ctx = g.black.context();
    const url = g.black.url();
    await g.black.close();
    await expect(g.white.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    // it is Black's turn; Black plays from a reopened page later. White can't move now; use the opposite: close White instead
    const nb = await ctx.newPage(); await nb.goto(url); await nb.waitForFunction(() => !!(window as any).__r3fState);
    await playOn(nb, 'black', 'Ed4', 'Ed3');
    const wctx = g.white.context(); const wurl = g.white.url();
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('White to move');
    await g.white.close();
    await nb.waitForTimeout(300);
    const nw = await wctx.newPage();
    // Black cannot move on White's turn; so instead check: White's reopened page shows Black's last move in place, no glide
    await nw.goto(wurl); await nw.waitForFunction(() => !!(window as any).__r3fState);
    await nw.waitForTimeout(100);
    const s = await boardState(nw);
    expect(s.glides).toBe(0); expect(s.lastFrom + s.lastTo).toBe(2);
    expect(await turnText(nw)).toBe('White to move');
    expect(await listText(nw)).toContain('Ed4–Ed3');
    return 'checked as: opponent moved, then this player reopened the game; move in place, no glide';
  });
  await g.close();
});

test('end', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await playLine(g, MATE_LINE.slice(0, 3));
  await playOn(g.black, 'black', 'Bc3', 'Ab2');
  await item('END-02', async () => {
    for (const p of [g.white, g.black]) {
      await expect(p.getByText('Black wins by checkmate!')).toBeVisible();
      const buttons = await p.getByRole('button').allTextContents();
      expect(buttons).toEqual(['Start new game']);
    }
    await g.white.screenshot({ path: SHOT + 'end-dialog.png' });
  });
  await item('END-04', async () => {
    const c0 = await cameraInfo(g.white);
    await drag(g.white, { x: 20, y: 400 }, 200, 0); await g.white.mouse.move(1200, 650); await g.white.mouse.wheel(0, -500); await g.white.waitForTimeout(500);
    expect((await cameraInfo(g.white)).pos).toEqual(c0.pos);
  });
  await item('END-05', async () => { expect(await turnText(g.white)).toBe('White to move'); });
  await item('END-07', async () => {
    await g.black.reload(); await g.black.waitForFunction(() => !!(window as any).__r3fState);
    await expect(g.black.getByText('Black wins by checkmate!')).toBeVisible();
    expect((await boardState(g.black)).glides).toBe(0);
  });
  await item('END-06', async () => {
    const oldUrl = g.white.url();
    await g.white.getByRole('button', { name: 'Start new game', exact: true }).click();
    await expect(g.white.getByRole('button', { name: 'Start New Game', exact: true })).toBeEnabled();
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    // END-09
    await g.white.getByRole('button', { name: 'Start New Game', exact: true }).click();
    await g.white.waitForURL(/\/game\/[A-Z0-9]+/);
    expect(g.white.url()).not.toBe(oldUrl);
    return 'END-09 also checked: Start New Game then created a new game with a new id';
  });
  await g.close();
});
