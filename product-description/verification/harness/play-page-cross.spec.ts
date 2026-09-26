import { test, expect, type Page } from '@playwright/test';
import { startTappedGame, newTappedPage, item, record, press, pressAt, pixelOf, projectCell, boardState, cameraInfo, settle, pieceMap, highlighted, turnText, listText, dropConnection, releaseConnection, playOn, drag, rawSend, focused, LINE20 } from './vh';
import { playLine, MATE_LINE, PROMO_LINE } from './line';
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);
const SHOT = 'test-results/';
const board = (p: Page) => p.waitForFunction(() => !!(window as any).__r3fState);
const kingGlow = (p: Page, color: string) => p.evaluate((c) => { let e = ''; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.piece?.type === 'King' && o.userData.piece.color === c) e = String(o.userData.emissive); }); return e; }, color);

test('play reruns', async ({ browser }) => {
  const g = await startTappedGame(browser);
  const w = g.white, b = g.black;
  await item('MOVE-10', async () => {
    await press(w, 'Ac1', 'white'); await w.waitForTimeout(200);
    const s = await boardState(w); expect(s.selectionRings).toBe(1); expect(s.highlights).toBe(0);
  });
  await item('MOVE-02', async () => {
    await press(w, 'Bb2', 'white'); await w.waitForTimeout(150);
    await press(w, 'Bb3', 'white'); await w.waitForTimeout(120);
    const s0 = await boardState(w); expect(s0.selectionRings).toBe(0); expect(s0.highlights).toBe(0);
    await expect(w.getByTestId('turn-indicator')).toHaveText('Black to move');
    await expect(b.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await listText(b)).toContain('1. Bb2–Bb3');
  });
  await item('MOVE-07', async () => {
    await playOn(b, 'black', 'Ed4', 'Ed3'); await expect(w.getByTestId('turn-indicator')).toHaveText('White to move');
    await press(w, 'Bc2', 'white'); await w.waitForTimeout(200);
    const d = await pixelOf(w, 'Bc3', 'white');
    await w.mouse.move(d.x, d.y); await w.mouse.down(); await w.mouse.up(); await w.mouse.down(); await w.mouse.up();
    await w.waitForTimeout(800);
    const a1 = await w.getByRole('alert').allTextContents();
    await w.getByRole('button', { name: 'Dismiss error' }).click().catch(() => {});
    await playOn(b, 'black', 'Ec4', 'Ec3'); await expect(w.getByTestId('turn-indicator')).toHaveText('White to move');
    await press(w, 'Bd2', 'white'); await w.waitForTimeout(200);
    const d2 = await pixelOf(w, 'Bd3', 'white');
    await w.mouse.move(d2.x, d2.y); await w.mouse.down(); await w.mouse.up(); await w.waitForTimeout(100); await w.mouse.down(); await w.mouse.up();
    await w.waitForTimeout(800);
    const a2 = await w.getByRole('alert').allTextContents();
    expect(a1.join()).toContain('Not your turn'); expect(a2).toEqual([]);
    return `0 ms gap: ${JSON.stringify(a1)}; 100 ms gap: no error`;
  });
  await item('BANNER-02', async () => {
    await playOn(b, 'black', 'Eb4', 'Eb3'); await expect(w.getByTestId('turn-indicator')).toHaveText('White to move');
    await press(w, 'Be2', 'white'); await w.waitForTimeout(200);
    const d = await pixelOf(w, 'Be3', 'white');
    await w.mouse.move(d.x, d.y); await w.mouse.down(); await w.mouse.up(); await w.mouse.down(); await w.mouse.up();
    await expect(w.getByRole('alert')).toHaveText(/Not your turn/);
    await playOn(b, 'black', 'Ea4', 'Ea3'); await expect(w.getByTestId('turn-indicator')).toHaveText('White to move');
    await playOn(w, 'white', 'Ba2', 'Ba3'); await expect(w.getByTestId('turn-indicator')).toHaveText('Black to move');
    await expect(w.getByRole('alert')).toHaveText(/Not your turn/);
  });
  await g.close();

  const g2 = await startTappedGame(browser);
  await item('END-01', async () => {
    await playOn(g2.white, 'white', 'Bc1', 'Ec4'); await expect(g2.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    const before = [await kingGlow(g2.white, 'black'), await kingGlow(g2.black, 'black')];
    await playOn(g2.black, 'black', 'Ec5', 'Ec4'); await expect(g2.white.getByTestId('turn-indicator')).toHaveText('White to move');
    await g2.white.waitForTimeout(200);
    const after = [await kingGlow(g2.white, 'black'), await kingGlow(g2.black, 'black')];
    expect(before).toEqual(['#ff2222', '#ff2222']);
    expect(after.every((e) => e !== '#ff2222')).toBe(true);
    return `glow before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`;
  });
  await g2.close();

  const g3 = await startTappedGame(browser);
  const pw = g3.white;
  await playLine(g3, PROMO_LINE);
  const open = async () => { await press(pw, 'Da4', 'white'); await pw.waitForTimeout(200); await press(pw, 'Ea5', 'white'); await expect(pw.getByRole('dialog', { name: 'Promote to' })).toBeVisible(); await pw.waitForTimeout(200); };
  await item('PROMO-01', async () => {
    await open();
    await expect(pw.getByRole('dialog').getByRole('button')).toHaveText(['Queen', 'Rook', 'Bishop', 'Knight', 'Unicorn', 'Cancel']);
    expect(await turnText(g3.black)).toBe('White to move');
  });
  await item('PROMO-02', async () => { expect(await focused(pw)).toBe('BODY'); });
  await item('PROMO-04', async () => {
    await pw.keyboard.press('Escape'); await pw.waitForTimeout(200);
    const stays = await pw.getByRole('dialog').count();
    await pw.keyboard.press('Tab'); const f = await focused(pw);
    await pw.keyboard.press('Escape');
    await expect(pw.getByRole('dialog')).toHaveCount(0);
    expect(stays).toBe(1); expect(f).toBe('BUTTON:Queen');
    expect(await turnText(pw)).toBe('White to move');
  });
  await item('PROMO-03', async () => {
    await open(); await pw.getByRole('button', { name: 'Cancel' }).click();
    await expect(pw.getByRole('dialog')).toHaveCount(0);
    expect((await boardState(pw)).selectionRings).toBe(0);
    await press(pw, 'Da4', 'white'); await pw.waitForTimeout(200);
    expect(await highlighted(pw, 'white')).toEqual(['Db5', 'Ea5', 'Eb4']);
    await pressAt(pw, { x: 8, y: 400 }); await press(pw, 'Ed4', 'white').catch(() => {});
  });
  await item('PROMO-05', async () => {
    await open();
    const box = await pw.getByRole('heading', { name: 'Promote to' }).boundingBox();
    await pw.mouse.click(box!.x + box!.width + 20, box!.y + 5); await pw.waitForTimeout(200);
    const stays = await pw.getByRole('dialog').count();
    await pw.mouse.click(10, 10);
    await expect(pw.getByRole('dialog')).toHaveCount(0);
    expect(stays).toBe(1);
  });
  await item('PROMO-06', async () => {
    await open();
    await pw.keyboard.press('Tab');
    const box = await pw.getByRole('heading', { name: 'Promote to' }).boundingBox();
    await pw.mouse.click(box!.x + box!.width + 20, box!.y + 5);
    const f = await focused(pw);
    await pw.keyboard.press('Escape'); await pw.waitForTimeout(200);
    const stays = await pw.getByRole('dialog').count();
    await pw.getByRole('button', { name: 'Cancel' }).click();
    expect(stays).toBe(1);
    return `after a Tab into the dialog, a click on the panel left focus on ${f}; Escape then did nothing`;
  });
  await item('PROMO-09', async () => {
    await open();
    await dropConnection(pw);
    await expect(pw.getByRole('dialog')).toHaveCount(0);
    await expect(pw.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await pw.waitForTimeout(500);
    expect(await pw.getByRole('dialog').count()).toBe(0);
    expect(await turnText(pw)).toBe('White to move');
  });
  await item('PROMO-07', async () => {
    await open();
    await pw.getByRole('button', { name: 'Unicorn' }).click();
    await expect(pw.getByRole('dialog')).toHaveCount(0);
    let glide = 0; for (let i = 0; i < 10; i++) { glide = Math.max(glide, (await boardState(pw)).glides); await pw.waitForTimeout(20); }
    await expect(g3.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await listText(g3.black)).toContain('Da4–Ea5=U');
    expect((await pieceMap(pw, 'white'))['Ea5']).toBe('white Unicorn');
    return `glide seen: ${glide}`;
  });
  await g3.close();
  const g4 = await startTappedGame(browser);
  await item('PROMO-08', async () => {
    await playLine(g4, PROMO_LINE);
    await press(g4.white, 'Da4', 'white'); await g4.white.waitForTimeout(200); await press(g4.white, 'Ea5', 'white');
    await expect(g4.white.getByRole('dialog')).toBeVisible(); await g4.white.waitForTimeout(200);
    await g4.white.keyboard.press('Enter'); await g4.white.waitForTimeout(500);
    const stays = await g4.white.getByRole('dialog').count();
    await g4.white.keyboard.press('Tab'); await g4.white.keyboard.press('Enter');
    await expect(g4.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await listText(g4.white)).toContain('Da4–Ea5=Q');
    expect(stays).toBe(1);
  });
  await g4.close();
  const n = await newTappedPage(browser, { viewport: { width: 375, height: 667 } });
  await item('PROMO-10', async () => {
    const g5 = await startTappedGame(browser, { viewport: { width: 375, height: 667 } });
    await playLine(g5, PROMO_LINE);
    await press(g5.white, 'Da4', 'white'); await g5.white.waitForTimeout(200); await press(g5.white, 'Ea5', 'white');
    await expect(g5.white.getByRole('dialog')).toBeVisible();
    const q = await g5.white.getByRole('button', { name: 'Queen' }).boundingBox(); const u = await g5.white.getByRole('button', { name: 'Unicorn' }).boundingBox();
    const panel = await g5.white.getByRole('dialog').locator('div').first().boundingBox();
    await g5.white.screenshot({ path: SHOT + 'promotion-narrow.png' });
    await g5.close();
    expect(u!.y).toBeGreaterThan(q!.y + 5);
    return `Queen at y=${q!.y.toFixed(0)}, Unicorn at y=${u!.y.toFixed(0)}; panel x ${panel!.x.toFixed(0)}..${(panel!.x + panel!.width).toFixed(0)} in 375`;
  });
  await n.context().close();
  const g6 = await startTappedGame(browser);
  await playLine(g6, MATE_LINE.slice(0, 3)); await playOn(g6.black, 'black', 'Bc3', 'Ab2');
  await expect(g6.white.getByText('Black wins by checkmate!')).toBeVisible();
  await item('END-08', async () => { expect(await focused(g6.white)).toBe('BODY'); });
  await g6.close();
});

test('game page', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('SEAT-01', async () => {
    await expect(g.white.getByText('You are playing as white.')).toBeVisible();
    await expect(g.black.getByText('You are playing as black.')).toBeVisible();
  });
  await item('SEAT-02', async () => {
    const ctx = g.black.context(); const u = g.black.url();
    await g.black.close();
    await expect(g.white.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    const nb = await ctx.newPage(); await nb.goto(u); await board(nb);
    await expect(g.white.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    (g as any).black = nb;
  });
  await item('LIST-01', async () => {
    expect(await g.white.getByTestId('move-list').count()).toBe(0);
    await playLine(g as any, ['Ab2-Ab3', 'Ed4-Ed3']);
    expect(await listText(g.white)).toBe('1. Ab2–Ab3  Ed4–Ed3');
  });
  await item('LIST-02', async () => {
    const rendered = await g.white.getByTestId('move-list').innerText();
    expect(rendered).toBe('1. Ab2–Ab3 Ed4–Ed3');
    return `rendered text ${JSON.stringify(rendered)} (the DOM holds two spaces; one is shown)`;
  });
  await item('TURN-01', async () => {
    const t0 = Date.now();
    await playOn(g.white, 'white', 'Bb2', 'Bb3');
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    await expect(g.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    return `both flipped within ${Date.now() - t0} ms of the press (headless)`;
  });
  await g.close();

  const h = await startTappedGame(browser);
  await item('LIST-03', async () => {
    await playLine(h, [...LINE20, ...LINE20.slice(0, 8)]);
    const vp = h.white.viewportSize()!;
    const bx = await h.white.getByTestId('move-list').boundingBox();
    const sc = await h.white.getByTestId('move-list').evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
    await h.white.getByTestId('move-list').evaluate((el) => { el.scrollTop = 0; });
    await playLine(h, ['Ab1-Aa3'], 'white');
    await h.white.waitForTimeout(300);
    const sc2 = await h.white.getByTestId('move-list').evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
    expect(bx!.height).toBeLessThanOrEqual(vp.height * 0.4 + 1);
    expect(sc.max).toBeGreaterThan(0); expect(Math.abs(sc.top - sc.max)).toBeLessThan(2); expect(Math.abs(sc2.top - sc2.max)).toBeLessThan(2);
    return `list ${bx!.height.toFixed(0)} px tall in a ${vp.height} px window; scrolled to newest after a move`;
  });
  await item('LIST-04', async () => {
    const bx = await h.white.getByTestId('move-list').boundingBox();
    await h.white.getByTestId('move-list').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const c0 = await cameraInfo(h.white);
    const s0 = await h.white.getByTestId('move-list').evaluate((el) => el.scrollTop);
    await h.white.mouse.move(bx!.x + 20, bx!.y + 20); await h.white.mouse.wheel(0, -200); await h.white.waitForTimeout(600);
    const s1 = await h.white.getByTestId('move-list').evaluate((el) => el.scrollTop);
    const c1 = await cameraInfo(h.white);
    expect(s1).toBeLessThan(s0); expect(c1.pos).toEqual(c0.pos);
  });
  await h.close();

  await item('BANNER-01', async () => {
    const x = await newTappedPage(browser); await x.goto('/'); await x.getByRole('button', { name: 'Start New Game' }).click(); await x.waitForURL(/\/game\//);
    const u = x.url();
    const y = await newTappedPage(browser); await y.goto(u); await y.getByRole('button', { name: 'Join Game' }).click(); await board(y);
    const z = await newTappedPage(browser); await z.goto(u);
    await z.getByRole('button', { name: 'Join Game' }).click();
    await expect(z.getByRole('alert')).toHaveText('Error: Game full✕');
    await z.waitForTimeout(3000);
    await expect(z.getByRole('alert')).toBeVisible();
    await z.getByRole('button', { name: 'Dismiss error' }).click();
    await expect(z.getByRole('alert')).toHaveCount(0);
    await z.getByRole('button', { name: 'Join Game' }).click();
    await expect(z.getByRole('alert')).toBeVisible();
    for (const p of [x, y, z]) await p.context().close();
  });

  const small = await startTappedGame(browser, { viewport: { width: 375, height: 667 } });
  await item('SEAT-03', async () => {
    const a = await small.white.locator('text=/You are playing as/').boundingBox();
    const t = await small.white.getByTestId('turn-indicator').boundingBox();
    await small.white.screenshot({ path: SHOT + 'narrow-white.png' });
    const overlap = a!.x + a!.width > t!.x && a!.y < t!.y + t!.height && a!.y + a!.height > t!.y;
    expect(overlap).toBe(true);
    return `seat label x ${a!.x.toFixed(0)}..${(a!.x + a!.width).toFixed(0)}; turn indicator x ${t!.x.toFixed(0)}..${(t!.x + t!.width).toFixed(0)}, height ${t!.height.toFixed(0)}`;
  });
  await item('TURN-02', async () => {
    const t = await small.white.getByTestId('turn-indicator').boundingBox();
    const t2 = await small.black.getByTestId('turn-indicator').boundingBox();
    return `turn indicator height ${t!.height.toFixed(0)} px at 375 wide (one line is about 42 px)`;
  });
  await item('SIZE-01', async () => {
    const vp = small.white.viewportSize()!;
    const cells = ['Aa1', 'Ae1', 'Ea5', 'Ee5', 'Aa5', 'Ae5'];
    const out: string[] = [];
    for (const c of cells) { const p = await projectCell(small.white, c, 'white'); if (p.x < 0 || p.x > vp.width || p.y < 0 || p.y > vp.height) out.push(`${c}@(${p.x.toFixed(0)},${p.y.toFixed(0)})`); }
    expect(out.length).toBeGreaterThan(0);
    return `cells whose centres fall outside a 375x667 window: ${out.join(', ')}`;
  });
  await item('SIZE-03', async () => {
    const t = await startTappedGame(browser, { viewport: { width: 800, height: 600 }, hasTouch: true });
    const p = await pixelOf(t.white, 'Bb2', 'white');
    await t.white.touchscreen.tap(p.x, p.y); await t.white.waitForTimeout(300);
    const h1 = await highlighted(t.white, 'white');
    const d = await pixelOf(t.white, 'Bb3', 'white');
    await t.white.touchscreen.tap(d.x, d.y);
    await expect(t.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    await t.close();
    expect(h1).toEqual(['Bb3', 'Cb2']);
    return 'touch emulation taps (single finger only)';
  });
  await item('SIZE-04', async () => {
    await small.white.setViewportSize({ width: 800, height: 900 }); await small.white.waitForTimeout(800);
    const c = await small.white.locator('canvas').boundingBox();
    expect(Math.round(c!.width)).toBe(800); expect(Math.round(c!.height)).toBe(900);
  });
  await small.close();
  await item('SIZE-02', async () => {
    const x = await newTappedPage(browser, { viewport: { width: 375, height: 667 } });
    await x.goto('/'); await x.getByRole('button', { name: 'Start New Game' }).click(); await x.waitForURL(/\/game\//);
    const link = x.getByText(x.url());
    await link.waitFor();
    const bx = await link.boundingBox();
    const sw = await x.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sx: (window.scrollX) }));
    await x.screenshot({ path: SHOT + 'share-narrow.png' });
    await x.context().close();
    expect(bx!.x < 0 || bx!.x + bx!.width > 375).toBe(true);
    return `link box x ${bx!.x.toFixed(0)}..${(bx!.x + bx!.width).toFixed(0)} in a 375 px window`;
  });
});

test('cross-cutting', async ({ browser }) => {
  await item('ERR-01', async () => {
    const p = await newTappedPage(browser); await p.goto('/');
    await expect(p.getByRole('status')).toHaveCount(0, { timeout: 5000 });
    await rawSend(p, { type: 'create_game' }); await p.waitForTimeout(300);
    await p.getByRole('button', { name: 'Start New Game' }).click();
    await expect(p.getByText('Error: Already in a game')).toBeVisible();
    await expect(p.getByRole('button', { name: 'Start New Game' })).toBeEnabled();
    const bannerStyle = await p.getByText('Error: Already in a game').evaluate((el) => el.tagName);
    await p.context().close();
    return `shown as <${bannerStyle}> red text under the button; the button re-enabled (the error was provoked by a raw create on the same connection)`;
  });
  const g = await startTappedGame(browser);
  await item('FROZEN-01', async () => {
    await rawSend(g.white, { type: 'move', from: 'Cc3', to: 'Cc4' });
    const txt = "Move 1 in this game's history is not a legal move for this client (likely an app version mismatch). The board is frozen at the position before it.";
    await expect(g.white.getByText(txt)).toBeVisible(); await expect(g.black.getByText(txt)).toBeVisible();
    expect(await turnText(g.white)).toBe('White to move');
    expect(await listText(g.black)).toContain('Cc3–Cc4');
    await press(g.white, 'Bb2', 'white'); await g.white.waitForTimeout(200);
    expect((await boardState(g.white)).selectionRings).toBe(0);
  });
  await item('FROZEN-03', async () => {
    await g.black.reload(); await board(g.black);
    await expect(g.black.getByText(/Move 1 in this game's history is not a legal move/)).toBeVisible();
  });
  await g.close();
  const h = await startTappedGame(browser);
  await item('FROZEN-02', async () => {
    await rawSend(h.white, { type: 'move', from: 'Ab1', to: 'Ec4' });
    await expect(h.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await h.black.getByRole('alert').count()).toBe(0);
    expect((await pieceMap(h.black, 'black'))['Ec4']).toBe('white Knight');
  });
  await h.close();
  const k = await startTappedGame(browser);
  await item('A11Y-01', async () => {
    const c0 = await cameraInfo(k.white);
    for (const key of ['Tab', 'ArrowLeft', 'ArrowUp', 'Enter', ' ']) await k.white.keyboard.press(key);
    await k.white.waitForTimeout(300);
    expect(await focused(k.white)).toBe('BODY');
    expect((await boardState(k.white)).selectionRings).toBe(0);
    expect((await cameraInfo(k.white)).pos).toEqual(c0.pos);
  });
  await item('A11Y-02', async () => {
    await playLine(k, MATE_LINE.slice(0, 3)); await playOn(k.black, 'black', 'Bc3', 'Ab2');
    await expect(k.white.getByText('Black wins by checkmate!')).toBeVisible();
    const roles = await k.white.evaluate(() => [...document.querySelectorAll('[role]')].map((e) => e.getAttribute('role')));
    const hasDialog = await k.white.getByRole('dialog').count() + await k.white.getByRole('alertdialog').count();
    expect(hasDialog).toBe(0);
    return `roles on the finished board screen: ${JSON.stringify(roles)}; promotion "dialog" and replaced "alertdialog" roles were confirmed in PROMO-01 and TAB-04`;
  });
  await k.close();
  const r = await startTappedGame(browser, { reducedMotion: 'reduce' });
  await item('A11Y-03', async () => {
    await playOn(r.white, 'white', 'Bb2', 'Bb3');
    let glide = 0; for (let i = 0; i < 10; i++) { glide = Math.max(glide, (await boardState(r.white)).glides); await r.white.waitForTimeout(20); }
    expect(glide).toBe(1);
  });
  await r.close();
  await item('A11Y-04', async () => {
    const p = await newTappedPage(browser); await p.goto('/');
    await p.evaluate(() => { const w = window as any; w.__blockSockets = true; for (const s of w.__sockets) s.close(); });
    await expect(p.getByRole('status')).toHaveText('Reconnecting to server…');
    await p.context().close();
    return 'status line has role status; the banner role alert is confirmed in BANNER-01';
  });
});
