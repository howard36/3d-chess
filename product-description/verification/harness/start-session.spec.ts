import { test, expect, type Page } from '@playwright/test';
import { startTappedGame, newTappedPage, item, record, press, pixelOf, boardState, cameraInfo, settle, pieceMap, turnText, listText, dropConnection, releaseConnection, playOn, drag, clickThenCut, loseIncoming, delayAnswersAfterOpen, focused, socketTap } from './vh';
import { playLine, MATE_LINE } from './line';
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);
const board = (p: Page) => p.waitForFunction(() => !!(window as any).__r3fState);
async function createOn(p: Page) { await p.goto('/'); await p.getByRole('button', { name: 'Start New Game' }).click(); await p.waitForURL(/\/game\/[A-Z0-9]+/); return p.url(); }

test('create', async ({ browser }) => {
  const p = await newTappedPage(browser);
  await item('CREATE-01', async () => {
    await p.goto('/');
    await expect(p.getByRole('status')).toHaveCount(0, { timeout: 5000 });
    await p.getByRole('button', { name: 'Start New Game' }).click();
    await p.waitForURL(/\/game\/[A-Z0-9]{6}$/);
    await expect(p.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await expect(p.getByText(p.url())).toBeVisible();
  });
  await item('CREATE-03', async () => {
    await p.goto('/');
    await expect(p.getByRole('status')).toHaveCount(0, { timeout: 5000 });
    await clickThenCut(p, 'Start New Game');
    await expect(p.getByText('Reconnecting to server…')).toBeVisible();
    await releaseConnection(p);
    await expect(p.getByRole('status')).toHaveCount(0, { timeout: 15000 });
    await p.waitForTimeout(10000);
    await expect(p.getByRole('button', { name: 'Creating Game...' })).toBeDisabled();
    expect(p.url()).toMatch(/\/$/);
    return 'button still "Creating Game..." and disabled 10 s after the connection returned (suspected bug confirmed)';
  });
  await item('CREATE-04', async () => {
    await p.goto('/'); await expect(p.getByRole('status')).toHaveCount(0, { timeout: 5000 });
    const urls: string[] = []; p.on('framenavigated', (f) => { if (f === p.mainFrame()) urls.push(f.url()); });
    await p.getByRole('button', { name: 'Start New Game' }).dblclick();
    await p.waitForURL(/\/game\//); await p.waitForTimeout(1000);
    expect(urls.filter((u) => u.includes('/game/')).length).toBe(1);
    expect(await p.getByRole('alert').count()).toBe(0);
  });
  await item('CREATE-05', async () => {
    await p.goto('/'); await expect(p.getByRole('status')).toHaveCount(0, { timeout: 5000 });
    await p.keyboard.press('Tab');
    expect(await focused(p)).toBe('BUTTON:Start New Game');
    await p.keyboard.press('Enter');
    await p.waitForURL(/\/game\//);
  });
  await item('CREATE-02', async () => {
    const q = await newTappedPage(browser);
    await q.addInitScript(() => { (window as any).__blockSocketsAtStart = true; });
    await q.goto('/');
    await q.evaluate(() => { const w = window as any; w.__blockSockets = true; for (const s of w.__sockets) s.close(); });
    await expect(q.getByText('Reconnecting to server…')).toBeVisible();
    await q.getByRole('button', { name: 'Start New Game' }).click();
    await expect(q.getByRole('button', { name: 'Creating Game...' })).toBeDisabled();
    await expect(q.getByText('Reconnecting to server…')).toBeVisible();
    await releaseConnection(q);
    await q.waitForURL(/\/game\//, { timeout: 15000 });
    await expect(q.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await q.context().close();
    return 'server unreachability simulated by blocking the page socket; "Connecting to server…" not separately observed';
  });
  await p.context().close();
  await item('CREATE-06', async () => {
    const c = await browser.newContext();
    await c.addInitScript(() => { Storage.prototype.setItem = function () { throw new Error('blocked'); }; Storage.prototype.getItem = function () { throw new Error('blocked'); }; });
    const q = await c.newPage();
    await createOn(q);
    await expect(q.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await q.getByRole('button', { name: 'Join Game' }).click();
    await expect(q.getByText('Joined game, waiting for start...')).toBeVisible();
    await expect(q.getByRole('alert')).toHaveText(/Already in a game/);
    await c.close();
    return 'storage refused by making Storage throw (suspected bug confirmed)';
  });
  await item('CREATE-07', async () => {
    const g = await startTappedGame(browser);
    await playLine(g, MATE_LINE.slice(0, 3)); await playOn(g.black, 'black', 'Bc3', 'Ab2');
    await g.white.getByRole('button', { name: 'Start new game', exact: true }).click();
    await g.white.waitForTimeout(2000);
    await expect(g.white.getByRole('button', { name: 'Start New Game', exact: true })).toBeEnabled();
    expect(g.white.url()).toMatch(/\/$/);
    await g.close();
  });
});

test('wait and join', async ({ browser }) => {
  const a = await newTappedPage(browser);
  const url = await createOn(a);
  await item('WAIT-01', async () => {
    const buttons = await a.getByRole('button').count();
    const links = await a.getByRole('link').count();
    await a.getByText(url).click();
    expect(buttons).toBe(0); expect(links).toBe(0);
    const txt = await a.locator('body').innerText();
    expect(txt.toLowerCase()).not.toMatch(/white|black/);
  });
  await item('WAIT-03', async () => {
    await a.reload();
    await expect(a.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await a.waitForTimeout(1000);
    await expect(a.getByText(url)).toBeVisible();
  });
  await item('WAIT-07', async () => {
    await dropConnection(a, { block: true });
    await expect(a.getByText('Reconnecting…')).toBeVisible();
    await expect(a.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await a.waitForTimeout(3000);
    await releaseConnection(a);
    await expect(a.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await expect(a.getByText('Game created! Share this link with a friend:')).toBeVisible();
  });
  await item('WAIT-06', async () => {
    await a.evaluate(() => { (window as any).__blockSockets = true; });
    await a.goBack();
    await expect(a.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    await a.goForward();
    await expect(a.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await releaseConnection(a);
    await a.waitForTimeout(9000);
    const alerts = await a.getByRole('alert').allTextContents();
    await expect(a.getByText('Game created! Share this link with a friend:')).toBeVisible();
    expect(alerts.join()).toContain('Already in a game');
    return `banner: ${JSON.stringify(alerts)} (suspected bug confirmed)`;
  });
  await item('WAIT-05', async () => {
    const t2 = await a.context().newPage();
    await t2.goto(url);
    await expect(t2.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await expect(a.getByRole('alertdialog', { name: 'This game is open in another tab' })).toBeVisible();
    await t2.close();
    await a.getByRole('button', { name: 'Play here' }).click();
    await expect(a.getByRole('alertdialog')).toHaveCount(0);
  });
  // joining
  const b = await newTappedPage(browser);
  await item('JOIN-01', async () => {
    await b.goto(url);
    await expect(b.getByRole('button', { name: 'Join Game' })).toBeVisible();
    expect(await b.getByRole('button').count()).toBe(1);
    expect((await b.locator('body').innerText()).trim()).toBe('3D Chess\nJoin Game');
  });
  await item('WAIT-02', async () => {
    await b.getByRole('button', { name: 'Join Game' }).click();
    await board(a); await board(b);
    const la = await a.locator('text=/You are playing as/').textContent(); const lb = await b.locator('text=/You are playing as/').textContent();
    expect(la).not.toBe(lb);
    await expect(a.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await expect(b.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    expect(await turnText(a)).toBe('White to move');
    return `creator: ${la}; joiner: ${lb}`;
  });
  record('JOIN-02', 'pass', 'checked together with WAIT-02');
  await item('JOIN-04', async () => {
    const c = await newTappedPage(browser);
    await c.goto(url); await c.getByRole('button', { name: 'Join Game' }).click();
    await expect(c.getByRole('alert')).toHaveText(/Game full/);
    await expect(c.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await c.context().close();
  });
  await item('JOIN-03', async () => {
    const c = await newTappedPage(browser);
    await c.goto('/game/NOPE00'); await c.getByRole('button', { name: 'Join Game' }).click();
    await expect(c.getByRole('alert')).toHaveText(/Cannot join/);
    await expect(c.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await c.context().close();
  });
  await a.context().close(); await b.context().close();

  await item('WAIT-04', async () => {
    const x = await newTappedPage(browser); const u = await createOn(x);
    const ctx = x.context(); await x.close();
    const y = await newTappedPage(browser); await y.goto(u); await y.getByRole('button', { name: 'Join Game' }).click(); await board(y);
    await expect(y.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    const x2 = await ctx.newPage(); await x2.goto(u); await board(x2);
    await expect(y.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await ctx.close(); await y.context().close();
    record('JOIN-06', 'pass', 'checked within WAIT-04: joiner saw "Opponent: offline" with the creator away');
  });
  await item('JOIN-05', async () => {
    const x = await newTappedPage(browser); const u = await createOn(x);
    const y = await newTappedPage(browser); await y.goto(u);
    await expect(y.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await y.waitForTimeout(500);
    await clickThenCut(y, 'Join Game');
    await releaseConnection(y);
    await expect(y.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await y.waitForTimeout(10000);
    const stuck = await y.getByText('Joined game, waiting for start...').isVisible();
    const creatorBoard = await x.evaluate(() => !!(window as any).__r3fState);
    const pres = await x.getByTestId('opponent-presence').textContent().catch(() => null);
    await y.reload(); await y.getByRole('button', { name: 'Join Game' }).click();
    await expect(y.getByRole('alert')).toHaveText(/Game full/);
    expect(stuck).toBe(true); expect(creatorBoard).toBe(true);
    await x.context().close(); await y.context().close();
    return `joiner stuck on joined screen; creator's board shown with presence "${pres}"; after reload, "Game full" (suspected bug confirmed)`;
  });
  await item('JOIN-07', async () => {
    const x = await newTappedPage(browser); const u = await createOn(x);
    const y = await newTappedPage(browser); await y.goto(u);
    const y2 = await y.context().newPage(); await y2.goto(u);
    await y.getByRole('button', { name: 'Join Game' }).click(); await board(y);
    await y2.getByRole('button', { name: 'Join Game' }).click();
    await expect(y2.getByRole('alert')).toHaveText(/Game full/);
    await x.context().close(); await y.context().close();
  });
});

test('session', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('RELOAD-01', async () => {
    await playOn(g.white, 'white', 'Bc1', 'Ec4');
    await expect(g.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    await drag(g.white, { x: 20, y: 400 }, 150, 0); await settle(g.white);
    await g.white.reload(); await board(g.white); await g.white.waitForTimeout(100);
    const s = await boardState(g.white);
    expect(s.glides).toBe(0); expect(s.lastFrom + s.lastTo).toBe(2);
    expect((await pieceMap(g.white, 'white'))['Ec4']).toBe('white Queen');
    expect(await turnText(g.white)).toBe('Black to move');
    expect(await listText(g.white)).toContain('1. Bc1–Ec4');
    expect((await cameraInfo(g.white)).pos.map((v: number) => +v.toFixed(3))).toEqual([6.5, 5, 8.5]);
    await expect(g.white.getByTestId('opponent-presence')).toHaveText('Opponent: online');
  });
  await item('DROP-01', async () => {
    await playOn(g.black, 'black', 'Ec5', 'Ec4');
    await expect(g.white.getByTestId('turn-indicator')).toHaveText('White to move');
    await press(g.white, 'Bb2', 'white'); await g.white.waitForTimeout(150);
    await dropConnection(g.white, { block: true });
    await expect(g.white.getByText('Reconnecting…')).toBeVisible();
    expect((await boardState(g.white)).selectionRings).toBe(0);
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    await releaseConnection(g.white);
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await playOn(g.white, 'white', 'Bb2', 'Bb3');
    await expect(g.black.getByTestId('turn-indicator')).toHaveText('Black to move');
  });
  await item('DROP-03', async () => {
    await g.white.evaluate(() => { for (const s of (window as any).__sockets) if (s.readyState === 1) s.close(4000, 'test'); });
    await expect(g.white.getByText('Reconnecting…')).toBeVisible();
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    return 'closed with application code 4000 from the page; retried and recovered';
  });
  await g.close();

  const h = await startTappedGame(browser);
  await item('DROP-02', async () => {
    await loseIncoming(h.white, true);
    await press(h.white, 'Bb2', 'white'); await h.white.waitForTimeout(150);
    await press(h.white, 'Bb3', 'white');
    await h.white.waitForTimeout(300);
    await dropConnection(h.white, { block: true });
    await loseIncoming(h.white, false);
    await expect(h.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    await playOn(h.black, 'black', 'Ed4', 'Ed3');
    await expect(h.black.getByTestId('turn-indicator')).toHaveText('White to move');
    expect(await turnText(h.white)).toBe('White to move');
    await delayAnswersAfterOpen(h.white, 5000);
    await releaseConnection(h.white);
    await expect(h.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await press(h.white, 'Bb2', 'white'); await h.white.waitForTimeout(150);
    await press(h.white, 'Bb3', 'white');
    await delayAnswersAfterOpen(h.white, 0);
    await h.white.waitForTimeout(6000);
    const bw = await h.white.getByRole('alert').allTextContents();
    const bb = await h.black.getByRole('alert').allTextContents();
    const lw = await listText(h.white);
    await h.white.screenshot({ path: 'test-results/stale-move-frozen.png' });
    expect(bb.join()).toMatch(/Move 3 in this game's history is not a legal move/);
    return `White banners ${JSON.stringify(bw)}; Black banners ${JSON.stringify(bb)}; list "${lw}" (suspected bug confirmed)`;
  });
  await h.close();

  const k = await startTappedGame(browser);
  await item('TAB-01', async () => {
    await drag(k.white, { x: 20, y: 400 }, 150, 0); await settle(k.white);
    const cam = await cameraInfo(k.white);
    const t2 = await k.white.context().newPage(); await t2.goto(k.white.url()); await board(t2);
    await expect(k.white.getByRole('alertdialog')).toBeVisible();
    const seen: string[] = [];
    const poll = (async () => { for (let i = 0; i < 40; i++) { seen.push((await k.black.getByTestId('opponent-presence').textContent()) ?? ''); await k.black.waitForTimeout(50); } })();
    await playOn(t2, 'white', 'Bb2', 'Bb3');
    await expect(k.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    await k.white.getByRole('button', { name: 'Play here' }).click();
    await expect(k.white.getByTestId('turn-indicator')).toHaveText('Black to move', { timeout: 10000 });
    let glide = 0; for (let i = 0; i < 10; i++) { glide = Math.max(glide, (await boardState(k.white)).glides); await k.white.waitForTimeout(20); }
    await poll;
    await expect(t2.getByRole('alertdialog')).toBeVisible();
    const cam2 = await cameraInfo(k.white);
    expect(Math.hypot(...cam2.pos.map((v: number, i: number) => v - cam.pos[i]))).toBeLessThan(0.1);
    expect(seen).not.toContain('Opponent: offline');
    await t2.close();
    return `glide seen after Play here: ${glide}; opponent presence samples never offline`;
  });
  await item('TAB-03', async () => {
    const t3 = await k.white.context().newPage(); await t3.goto(k.white.url()); await board(t3);
    await expect(k.white.getByRole('alertdialog')).toBeVisible();
    await t3.close();
    await expect(k.black.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    await k.white.waitForTimeout(1500);
    await expect(k.white.getByRole('alertdialog')).toBeVisible();
  });
  await item('RELOAD-04', async () => {
    await k.white.reload(); await board(k.white);
    await expect(k.white.getByRole('alertdialog')).toHaveCount(0);
    await expect(k.black.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    return 'reloading a replaced tab took the seat back';
  });
  await item('TAB-02', async () => {
    await dropConnection(k.white, { block: true });
    await expect(k.white.getByText('Reconnecting…')).toBeVisible();
    const t4 = await k.white.context().newPage(); await t4.goto(k.white.url()); await board(t4);
    await t4.waitForTimeout(500);
    await releaseConnection(k.white);
    await expect(k.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await expect(t4.getByRole('alertdialog', { name: 'This game is open in another tab' })).toBeVisible({ timeout: 5000 });
    await expect(k.white.getByRole('alertdialog')).toHaveCount(0);
    await t4.close();
    return 'the reconnecting tab took the seat back without a click; the newer tab shows the dialog (suspected bug confirmed)';
  });
  await k.close();

  const m = await startTappedGame(browser);
  await item('TAB-04', async () => {
    await playLine(m, MATE_LINE.slice(0, 3)); await playOn(m.black, 'black', 'Bc3', 'Ab2');
    await expect(m.white.getByText('Black wins by checkmate!')).toBeVisible();
    const t2 = await m.white.context().newPage(); await t2.goto(m.white.url()); await board(t2);
    const dlg = m.white.getByRole('alertdialog');
    await expect(dlg).toBeVisible();
    await m.white.keyboard.press('Escape'); await m.white.mouse.click(10, 10); await m.white.waitForTimeout(300);
    await expect(dlg).toBeVisible();
    const order: string[] = [await focused(m.white)];
    for (let i = 0; i < 4; i++) { await m.white.keyboard.press('Tab'); order.push(await focused(m.white)); }
    await t2.close();
    return `focus on open: ${order[0]}; Tab order: ${order.slice(1).join(' -> ')}`;
  });
  await m.close();

  // RELOAD-02 and DROP-04 need the server to forget games: restart is not scripted; RELOAD-03 history jump
  await item('RELOAD-03', async () => {
    const n = await startTappedGame(browser);
    const aUrl = n.white.url();
    await playLine(n, MATE_LINE.slice(0, 3)); await playOn(n.black, 'black', 'Bc3', 'Ab2');
    await n.white.getByRole('button', { name: 'Start new game', exact: true }).click();
    await n.white.getByRole('button', { name: 'Start New Game', exact: true }).click();
    await n.white.waitForURL(/\/game\//);
    const bUrl = n.white.url();
    await expect(n.white.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await n.white.evaluate(() => history.go(-2));
    await n.white.waitForURL(aUrl);
    await n.white.waitForTimeout(2000);
    const text = await n.white.locator('body').innerText();
    const dialog = await n.white.getByText('Black wins by checkmate!').count();
    await n.close();
    return `address ${aUrl.split('/game/')[1]} (was ${bUrl.split('/game/')[1]}); end-game dialog shown: ${dialog > 0}; page text: ${JSON.stringify(text.slice(0, 120))}`;
  });
});
