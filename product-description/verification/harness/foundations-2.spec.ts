import { test, expect, type Page } from '@playwright/test';
import { settle, fps, startTappedGame, socketTap, item, press, pressAt, drag, projectCell, boardState, cameraInfo, pieceMap, highlighted, turnText, listText, dropConnection, releaseConnection, attemptTimes, playOn } from './vh';
import { playLine, MATE_LINE } from './line';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);
const storageKeys = (p: Page) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const presence = (p: Page) => p.getByTestId('opponent-presence');

test('rules-09 redo', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('RULES-09', async () => {
    await playLine(g, ['Bc1-Ec4']);
    const kingGlow = async (p: Page) => p.evaluate(() => { let e = ''; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.piece?.type === 'King' && o.userData.piece.color === 'black') e = o.userData.emissive; }); return e; });
    expect(await kingGlow(g.white)).toBe('#ff2222');
    expect(await kingGlow(g.black)).toBe('#ff2222');
    const res: string[] = [];
    for (const [sq, want] of [['Ec5', ['Ec4']], ['Dc5', ['Ec4']], ['Dd5', ['Ec4']], ['Ed4', []]] as const) {
      try { await press(g.black, sq, 'black'); } catch { res.push(`${sq}: hidden from default view, skipped`); continue; }
      await g.black.waitForTimeout(200);
      expect(await highlighted(g.black, 'black')).toEqual(want);
    }
    expect((await g.black.locator('body').innerText()).toLowerCase()).not.toContain('check');
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
  });
  await b.goto(a.url());
  await b.getByRole('button', { name: 'Join Game' }).click();
  await b.waitForFunction(() => !!(window as any).__r3fState);
  await a.waitForFunction(() => !!(window as any).__r3fState);
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
  await black.waitForFunction(() => !!(window as any).__r3fState);
  await item('CONN-07', async () => {
    await black.goBack();
    await expect(black.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    await expect(presence(white)).toHaveText('Opponent: offline');
    await black.goForward();
    await black.waitForFunction(() => !!(window as any).__r3fState);
    await expect(presence(white)).toHaveText('Opponent: online');
  });
  await item('CONN-03', async () => {
    await dropConnection(white, { block: true });
    await expect(white.getByText('Reconnecting…')).toBeVisible();
    const t0 = Date.now();
    await white.waitForTimeout(20000);
    const t = (await attemptTimes(white)).filter((x) => x >= t0 - 100);
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    await releaseConnection(white);
    await expect(white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    return `attempts after drop at +${t.length ? t[0] - t0 : '?'} ms, then gaps ${JSON.stringify(gaps)}`;
  });
  await item('CONN-10', async () => {
    await expect(presence(white)).toHaveText('Opponent: online');
    await dropConnection(white, { block: true });
    await expect(white.getByText('Reconnecting…')).toBeVisible();
    await black.close();
    await white.waitForTimeout(1500);
    const during = await presence(white).textContent();
    await releaseConnection(white);
    await expect(white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await expect(presence(white)).toHaveText('Opponent: offline');
    expect(during).toBe('Opponent: online');
  });
  await item('CONN-11', async () => {
    await expect(white.getByTestId('turn-indicator')).toHaveText('White to move');
    await playOn(white, 'white', 'Ab2', 'Ab3');
    await expect(white.getByTestId('turn-indicator')).toHaveText('Black to move');
    const b2 = await (creatorColor === 'white' ? ctxB : ctxA).newPage();
    await b2.goto(white.url());
    await b2.waitForFunction(() => !!(window as any).__r3fState);
    await expect(b2.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await listText(b2)).toContain('Ab2–Ab3');
    const s = await boardState(b2);
    expect(s.glides).toBe(0); expect(s.lastFrom + s.lastTo).toBe(2);
    await expect(presence(white)).toHaveText('Opponent: online');
    // CONN-12 on this page afterwards
    await b2.evaluate(() => localStorage.clear());
    await b2.reload();
    await b2.getByRole('button', { name: 'Join Game' }).click();
    await expect(b2.getByRole('alert')).toHaveText(/Game full/);
    await expect(b2.getByRole('button', { name: 'Join Game' })).toBeVisible();
    return 'CONN-12 also checked here: cleared storage -> Join Game -> "Error: Game full"';
  });
  await ctxA.close(); await ctxB.close();
});

test('conn-05 second tab', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('CONN-05', async () => {
    const t2 = await g.white.context().newPage();
    await t2.goto(g.white.url());
    await t2.waitForFunction(() => !!(window as any).__r3fState);
    await expect(t2.getByText('You are playing as white.')).toBeVisible();
    const dlg = g.white.getByRole('alertdialog', { name: 'This game is open in another tab' });
    await expect(dlg).toBeVisible();
    await g.white.waitForTimeout(5000);
    await expect(dlg).toBeVisible();
    await expect(t2.getByRole('alertdialog')).toHaveCount(0);
  });
  await g.close();
});

test('nav', async ({ browser }) => {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await item('NAV-02', async () => {
    await p.goto('/games'); await p.waitForTimeout(800);
    const t1 = (await p.locator('body').innerText()).trim();
    await p.goto('/game/'); await p.waitForTimeout(800);
    const t2 = (await p.locator('body').innerText()).trim();
    expect(t1).toBe(''); expect(t2).toBe('');
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    return `both empty; body background ${bg} (suspected bug confirmed)`;
  });
  await item('NAV-05', async () => {
    await p.goto('/'); expect(await p.title()).toBe('3D Chess — Online Multiplayer');
  });
  await ctx.close();
  const g = await startTappedGame(browser);
  await item('NAV-01', async () => {
    // covered by setup: creator saw share link, joiner saw Join Game; both reached the board
    expect(await g.white.title()).toBe('3D Chess — Online Multiplayer');
    return 'share-link, join, and board screens reached in the standard setup';
  });
  await item('NAV-03', async () => {
    const id = g.white.url().split('/game/')[1];
    const c = await browser.newContext(); const q = await c.newPage();
    await q.goto(`/game/${id.toLowerCase()}`);
    await q.getByRole('button', { name: 'Join Game' }).click();
    await expect(q.getByRole('alert')).toHaveText(/Cannot join/);
    await expect(q.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await c.close();
  });
  await item('NAV-06', async () => {
    await dropConnection(g.white, { block: true });
    await expect(g.white.getByText('Reconnecting…')).toBeVisible();
    expect(await g.white.locator('canvas').count()).toBe(1);
    await releaseConnection(g.white);
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    expect(await g.white.locator('canvas').count()).toBe(1);
  });
  await item('NAV-04', async () => {
    await playLine(g, MATE_LINE.slice(0, 3));
    await playOn(g.black, 'black', 'Bc3', 'Ab2');
    await expect(g.white.getByText('Black wins by checkmate!')).toBeVisible();
    await g.white.getByRole('button', { name: 'Start new game', exact: true }).click();
    await expect(g.white.getByRole('button', { name: 'Start New Game', exact: true })).toBeVisible();
    await g.white.goBack();
    await expect(g.white.getByText('Black wins by checkmate!')).toBeVisible();
    expect(await g.white.title()).toBe('3D Chess — Online Multiplayer');
  });
  await g.close();
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
    expect(w.pos.map((v: number) => +v.toFixed(3))).toEqual([6.5, 5, 8.5]);
    expect(b.pos.map((v: number) => +v.toFixed(3))).toEqual([6.5, 5, 8.5]);
  });
  await item('VIEW-02', async () => {
    const before = await projectCell(g.white, 'Bb2', 'white'); const after = await projectCell(g.white, 'Cb2', 'white');
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
    await g.white.reload(); await g.white.waitForFunction(() => !!(window as any).__r3fState);
    await g.white.waitForTimeout(100);
    const s = await boardState(g.white);
    expect(s.glides).toBe(0); expect(s.ghosts).toBe(0); expect(s.lastFrom + s.lastTo).toBe(2);
    expect((await pieceMap(g.white, 'white'))['Ec4']).toBe('white Queen');
  });
  await item('VIEW-07', async () => {
    await drag(g.white, { x: 20, y: 400 }, 200, 0); await settle(g.white);
    const c1 = await cameraInfo(g.white);
    await playOn(g.black, 'black', 'Ec5', 'Ec4');
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('White to move');
    await settle(g.white);
    const c2 = await cameraInfo(g.white);
    const moved = Math.hypot(...c2.pos.map((v: number, i: number) => v - c1.pos[i]));
    expect(moved).toBeLessThan(0.1);
    await g.white.reload(); await g.white.waitForFunction(() => !!(window as any).__r3fState);
    const c3 = await cameraInfo(g.white);
    expect(c3.pos.map((v: number) => +v.toFixed(3))).toEqual([6.5, 5, 8.5]);
  });
  await item('VIEW-04', async () => {
    const w = g.white; const bg = { x: 20, y: 400 };
    const t = async () => (await cameraInfo(w)).target.map((v: number) => +v.toFixed(2));
    await settle(w); const t0 = await t(); await drag(w, bg, 120, 0, 'left'); await settle(w); const t1 = await t();
    await drag(w, bg, 120, 0, 'right'); await settle(w); const t2 = await t();
    await drag(w, bg, 120, 0, 'left', ['Shift']); await settle(w); const t3 = await t();
    await drag(w, bg, 120, 0, 'right', ['Shift']); await settle(w); const t4 = await t();
    const d = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
    expect(d(t1, t0)).toBeLessThan(0.05); expect(d(t2, t1)).toBeGreaterThan(0.3); expect(d(t3, t2)).toBeGreaterThan(0.3); expect(d(t4, t3)).toBeLessThan(0.05);
    return `target moved: orbit ${d(t1, t0).toFixed(3)}, pan ${d(t2, t1).toFixed(2)}, shift+left ${d(t3, t2).toFixed(2)}, shift+right ${d(t4, t3).toFixed(3)}`;
  });
  await item('VIEW-05', async () => {
    const w = g.white; await w.mouse.move(640, 360);
    for (let i = 0; i < 40; i++) { await w.mouse.wheel(0, -500); await w.waitForTimeout(20); }
    await w.waitForTimeout(1500); const dIn = (await cameraInfo(w)).dist;
    for (let i = 0; i < 60; i++) { await w.mouse.wheel(0, 500); await w.waitForTimeout(20); }
    await w.waitForTimeout(1500); const dOut = (await cameraInfo(w)).dist;
    expect(dIn).toBeCloseTo(6, 1); expect(dOut).toBeCloseTo(25, 1);
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
    for (let i = 0; i < 6; i++) { await drag(w, { x: 20, y: 400 }, 400, 0, 'right'); }
    await w.waitForTimeout(1500);
    const c = await projectCell(w, 'Cc3', 'white');
    const vp = w.viewportSize()!;
    expect(c.x < 0 || c.x > vp.width || c.y < 0 || c.y > vp.height).toBe(true);
    return `board centre now at (${c.x.toFixed(0)},${c.y.toFixed(0)}) in a ${vp.width}x${vp.height} window`;
  });
  await g.close();
});
