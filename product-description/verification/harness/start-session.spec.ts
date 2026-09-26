import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { item, record, press, boardState, cameraInfo, settle, pieceMap, turnText, listText, dropConnection, releaseConnection, playOn, drag, clickThenCut, loseIncoming, delayAnswersAfterOpen, focused, socketTap, rawSend, getPlayerColor, highlighted } from './vh';
import { playLine, MATE_LINE } from './line';
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

// --- Local helpers (vh.ts is shared with other specs and is not edited) --------
type Seat = 'white' | 'black';
const SHARE = 'Game created! Share this link with a friend:';
const DIALOG = 'This game is open in another tab';

/** Records every message the page sends on the game socket (window.__sent). */
const sendTap = () => {
  const w = window as any;
  w.__sent = [];
  const orig = WebSocket.prototype.send;
  WebSocket.prototype.send = function (this: WebSocket, d: any) {
    if (String(this.url).includes(':8000/ws')) w.__sent.push(String(d));
    return orig.call(this, d);
  };
};
/** Per-tab flags kept in sessionStorage, read at load (so a reload of one tab can start lossy). */
const tabFlags = () => {
  try {
    if (sessionStorage.getItem('vh:lose')) (window as any).__loseIncoming = true;
  } catch { /* storage off */ }
};
/** Background samplers: presence text changes (window.__pres) and frames with a glide (window.__glides). */
const watchers = () => {
  const w = window as any;
  w.__pres = [];
  w.__glides = 0;
  setInterval(() => {
    const el = document.querySelector('[data-testid=opponent-presence]');
    const t = el ? el.textContent : null;
    if (t !== null && w.__pres[w.__pres.length - 1] !== t) w.__pres.push(t);
    const s = w.__r3fState;
    if (s && document.querySelector('canvas')) {
      const { scene } = s.get ? s.get() : s;
      let n = 0;
      scene.traverse((o: any) => { if (o.userData?.moveGlide) n++; });
      if (n) w.__glides++;
    }
  }, 40);
};
async function ctx(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const c = await browser.newContext(opts);
  for (const s of [socketTap, sendTap, tabFlags, watchers]) await c.addInitScript(s);
  return c;
}
async function page(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  return (await ctx(browser, opts)).newPage();
}
const sent = (p: Page): Promise<any[]> => p.evaluate(() => (window as any).__sent.map((s: string) => JSON.parse(s)));
const presLog = (p: Page): Promise<string[]> => p.evaluate(() => (window as any).__pres.slice());
const resetPres = (p: Page) => p.evaluate(() => { const w = window as any; w.__pres = w.__pres.slice(-1); });
const glides = (p: Page): Promise<number> => p.evaluate(() => (window as any).__glides);
const resetGlides = (p: Page) => p.evaluate(() => { (window as any).__glides = 0; });
const socketOpen = (p: Page) => p.waitForFunction(() => (window as any).__sockets.some((s: WebSocket) => s.readyState === 1));
const gid = (p: Page) => p.url().split('/game/')[1];
const role = (p: Page, id = gid(p)) => p.evaluate((i) => localStorage.getItem(`3dchess:role:${i}`), id);
async function onBoard(p: Page, timeout = 20000) {
  await expect(p.getByTestId('turn-indicator')).toBeVisible({ timeout });
  await expect(p.locator('canvas')).toBeVisible();
  await p.waitForFunction(() => !!(window as any).__r3fState);
}
async function connectedStart(p: Page) {
  await p.goto('/');
  await expect(p.getByRole('button', { name: 'Start New Game' })).toBeEnabled();
  await expect(p.getByRole('status')).toHaveCount(0, { timeout: 10000 });
}
async function createOn(p: Page) {
  await connectedStart(p);
  await p.getByRole('button', { name: 'Start New Game' }).click();
  await p.waitForURL(/\/game\/[A-Z0-9]{6}$/);
  await expect(p.getByText(SHARE)).toBeVisible();
  return p.url();
}
async function joinOn(p: Page, url: string) {
  await p.goto(url);
  await p.getByRole('button', { name: 'Join Game' }).click();
  await onBoard(p);
}
/** Two contexts, both seated; like vh's startTappedGame but with this file's init scripts. */
async function startGame(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const contexts: BrowserContext[] = [await ctx(browser, opts), await ctx(browser, opts)];
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const url = await createOn(a);
  await joinOn(b, url);
  await onBoard(a);
  const seats = {} as Record<Seat, Page>;
  for (const p of [a, b]) seats[await getPlayerColor(p)] = p;
  return { white: seats.white, black: seats.black, url, close: () => Promise.all(contexts.map((c) => c.close())) };
}
const alertTexts = (p: Page) => p.getByRole('alert').allTextContents();
const dialog = (p: Page) => p.getByRole('alertdialog', { name: DIALOG });
const moveBox = (p: Page) => p.getByLabel('Type a move (e.g. Ab2-Ab3)');
const moveButton = (p: Page) => p.getByRole('button', { name: 'Move', exact: true });
const hasFocusRing = (p: Page) => p.evaluate(() => { const a = document.activeElement as HTMLElement; const s = getComputedStyle(a); return s.boxShadow !== 'none' || (s.outlineStyle !== 'none' && s.outlineWidth !== '0px'); });
/** Opens a second tab of `p`'s context on the same game and waits for its board. */
async function secondTab(p: Page, url = p.url()) {
  const t = await p.context().newPage();
  await t.goto(url);
  await onBoard(t);
  return t;
}
/** White plays a move on the board and both pages see the turn flip. */
async function playBoth(mover: Page, seat: Seat, from: string, to: string, other: Page) {
  await playOn(mover, seat, from, to);
  const next = new RegExp(`^${seat === 'white' ? 'Black' : 'White'} to move`);
  await expect(mover.getByTestId('turn-indicator')).toHaveText(next, { timeout: 15000 });
  await expect(other.getByTestId('turn-indicator')).toHaveText(next, { timeout: 15000 });
}
/** An in-app navigation to the start screen (as a link would do): same document, history push. */
const pushStart = (p: Page) => p.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });

// ============================================================================
test('create', async ({ browser }) => {
  await item('CREATE-01', async () => {
    const p = await page(browser);
    await connectedStart(p);
    // Hold the answer back 2 s so the in-flight button can be read at 9 fps
    await p.evaluate(() => { (window as any).__delayUntil = Date.now() + 2000; });
    await p.getByRole('button', { name: 'Start New Game' }).click();
    const btn = p.getByRole('button', { name: 'Creating Game...' });
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
    await p.waitForURL(/\/game\/[A-Z0-9]{6}$/);
    await expect(p.getByText(SHARE)).toBeVisible();
    await expect(p.getByText(p.url(), { exact: true })).toBeVisible();
    await expect(p.getByRole('button', { name: 'Copy link' })).toBeVisible();
    const id = gid(p);
    await p.context().close();
    return `"Creating Game..." disabled while the answer was held back 2 s; then /game/${id} with the share link and "Copy link"`;
  });

  await item('CREATE-02', async () => {
    const c = await ctx(browser);
    // Server stopped, as the page sees it: every connection attempt is refused
    await c.addInitScript(() => { (window as any).__blockSockets = true; });
    await c.addInitScript(() => {
      const w = window as any; w.__statusLog = [];
      setInterval(() => { const s = document.querySelector('[role=status]')?.textContent ?? null; if (w.__statusLog[w.__statusLog.length - 1] !== s) w.__statusLog.push(s); }, 10);
    });
    const q = await c.newPage();
    await q.goto('/');
    await expect(q.getByText('Reconnecting to server…')).toBeVisible();
    await q.getByRole('button', { name: 'Start New Game' }).click();
    await expect(q.getByRole('button', { name: 'Creating Game...' })).toBeDisabled();
    await expect(q.getByText('Reconnecting to server…')).toBeVisible();
    const log: (string | null)[] = await q.evaluate(() => (window as any).__statusLog);
    await q.waitForTimeout(2000);
    await releaseConnection(q);
    const t0 = Date.now();
    await q.waitForURL(/\/game\/[A-Z0-9]{6}$/, { timeout: 10000 });
    await expect(q.getByText(SHARE)).toBeVisible();
    const dt = (Date.now() - t0) / 1000;
    const seen = log.filter((s) => s);
    expect(seen[0]).toBe('Connecting to server…');
    expect(seen).toContain('Reconnecting to server…');
    expect(dt).toBeLessThan(8.5);
    await c.close();
    return `status line: ${JSON.stringify(seen)}; share link ${dt.toFixed(1)} s after the connection was allowed (server stop simulated by refusing every connection from the page; the local server kept running)`;
  });

  await item('CREATE-03', async () => {
    const p = await page(browser);
    await connectedStart(p);
    await clickThenCut(p, 'Start New Game');
    const btn = p.getByRole('button', { name: 'Creating Game...' });
    await expect(btn).toBeDisabled();
    const status = p.getByText('Reconnecting to server…');
    await expect(status).toBeVisible();
    const bb = (await btn.boundingBox())!, sb = (await status.boundingBox())!;
    expect(sb.y).toBeGreaterThan(bb.y + bb.height - 1);
    await p.waitForTimeout(1500);
    await expect(btn).toBeDisabled();
    await releaseConnection(p);
    await socketOpen(p);
    const t0 = Date.now();
    await p.waitForURL(/\/game\/[A-Z0-9]{6}$/, { timeout: 8000 });
    await expect(p.getByText(SHARE)).toBeVisible();
    const dt = (Date.now() - t0) / 1000;
    const creates = (await sent(p)).filter((m) => m.type === 'create_game').length;
    await p.context().close();
    return `"Creating Game..." disabled with "Reconnecting to server…" below it; share-link screen ${dt.toFixed(1)} s after the connection returned; create_game sent ${creates} times`;
  });

  await item('CREATE-04', async () => {
    const p = await page(browser);
    await connectedStart(p);
    const urls: string[] = [];
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) urls.push(f.url()); });
    await p.getByRole('button', { name: 'Start New Game' }).dblclick();
    await p.waitForURL(/\/game\//);
    await p.waitForTimeout(1500);
    const gameNavs = urls.filter((u) => u.includes('/game/'));
    expect(gameNavs.length).toBe(1);
    expect(await p.getByRole('alert').count()).toBe(0);
    const creates = (await sent(p)).filter((m) => m.type === 'create_game').length;
    await p.context().close();
    return `one navigation to a game page, no error; create_game sent ${creates} time(s)`;
  });

  await item('CREATE-05', async () => {
    const p = await page(browser);
    await connectedStart(p);
    expect(await focused(p)).toBe('BODY');
    await p.keyboard.press('Tab');
    expect(await focused(p)).toBe('BUTTON:Start New Game');
    expect(await hasFocusRing(p)).toBe(true);
    await p.keyboard.press('Enter');
    await p.waitForURL(/\/game\/[A-Z0-9]{6}$/);
    await expect(p.getByText(SHARE)).toBeVisible();
    await p.context().close();
    return 'focus ring read from the computed box-shadow';
  });

  // Storage off: the browser refuses site data, so both storages throw on access
  const c6 = await ctx(browser);
  await c6.addInitScript(() => {
    for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  });
  const s6 = await c6.newPage();
  let url6 = '';
  await item('CREATE-06', async () => {
    await connectedStart(s6);
    await s6.getByRole('button', { name: 'Start New Game' }).click();
    await s6.waitForURL(/\/game\/[A-Z0-9]{6}$/);
    url6 = s6.url();
    await expect(s6.getByRole('button', { name: 'Join Game' })).toBeVisible();
    const share = await s6.getByText(SHARE).count();
    await s6.getByRole('button', { name: 'Join Game' }).click();
    await expect(s6.getByText('Joined game, waiting for start...')).toBeVisible();
    await expect(s6.getByRole('alert')).toContainText('Error: Already in a game');
    return `1: join screen ("Join Game", share link shown: ${share > 0}); 2: "Joined game, waiting for start..." with "Error: Already in a game" (storage refused by making localStorage and sessionStorage throw SecurityError)`;
  });
  await item('CREATE-08', async () => {
    expect(url6).not.toBe('');
    await dropConnection(s6, { block: true });
    await expect(s6.getByText('Reconnecting…')).toBeVisible();
    await s6.waitForTimeout(1000);
    await releaseConnection(s6);
    await expect(s6.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await s6.waitForTimeout(2500);
    await expect(s6.getByText('Joined game, waiting for start...')).toBeVisible();
    expect((await alertTexts(s6)).join()).toContain('Already in a game');
    expect(await s6.locator('canvas').count()).toBe(0);
    const joins = (await sent(s6)).filter((m) => m.type === 'join_game').length;
    const other = await page(browser);
    await joinOn(other, url6);
    await onBoard(s6);
    const cOther = await getPlayerColor(other), cMine = await getPlayerColor(s6);
    expect(cMine).not.toBe(cOther);
    await other.context().close();
    return `after the reconnect: joined screen kept, old "Already in a game" banner kept, no board (join_game sent ${joins} times); after the second context joined: board as ${cMine}, second context ${cOther}`;
  });
  await c6.close();

  await item('CREATE-07', async () => {
    const g = await startGame(browser);
    await playLine(g, MATE_LINE.slice(0, 3));
    await playOn(g.black, 'black', 'Bc3', 'Ab2');
    await expect(g.white.getByText('Black wins by checkmate!')).toBeVisible();
    await g.white.getByRole('button', { name: 'Start new game', exact: true }).click();
    await g.white.waitForTimeout(2000);
    await expect(g.white.getByRole('button', { name: 'Start New Game', exact: true })).toBeEnabled();
    expect(new URL(g.white.url()).pathname).toBe('/');
    expect(await g.white.getByRole('alert').count()).toBe(0);
    await g.close();
  });
});

// ============================================================================
test('wait', async ({ browser }) => {
  await item('WAIT-01', async () => {
    const a = await page(browser);
    const url = await createOn(a);
    const buttons = await a.getByRole('button').allTextContents();
    const links = await a.getByRole('link').count();
    await a.getByText(url, { exact: true }).click();
    await a.waitForTimeout(500);
    expect(a.url()).toBe(url);
    expect(buttons).toEqual(['Copy link']);
    expect(links).toBe(0);
    const txt = await a.locator('body').innerText();
    expect(txt.toLowerCase()).not.toMatch(/white|black/);
    await a.context().close();
  });

  await item('WAIT-02', async () => {
    const a = await page(browser);
    const url = await createOn(a);
    const stored = await role(a);
    const b = await page(browser);
    await joinOn(b, url);
    await onBoard(a);
    await expect(a.getByText(`You are playing as ${stored}.`)).toBeVisible();
    await expect(a.getByTestId('turn-indicator')).toHaveText('White to move');
    await expect(a.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await a.context().close(); await b.context().close();
    return `creator stored ${stored} and showed "You are playing as ${stored}."`;
  });

  await item('WAIT-03', async () => {
    const a = await page(browser);
    const url = await createOn(a);
    await a.reload();
    await expect(a.getByText(SHARE)).toBeVisible();
    await a.waitForTimeout(1500);
    await expect(a.getByText(SHARE)).toBeVisible();
    await expect(a.getByText(url, { exact: true })).toBeVisible();
    await a.context().close();
  });

  await item('WAIT-04', async () => {
    const x = await page(browser);
    const u = await createOn(x);
    const cx = x.context();
    await x.close();
    const y = await page(browser);
    await joinOn(y, u);
    await expect(y.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    const x2 = await cx.newPage();
    await x2.goto(u);
    await onBoard(x2);
    await expect(y.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await cx.close(); await y.context().close();
  });

  await item('WAIT-05', async () => {
    const a = await page(browser);
    const url = await createOn(a);
    const t2 = await a.context().newPage();
    await t2.goto(url);
    await expect(t2.getByText(SHARE)).toBeVisible();
    await expect(dialog(a)).toBeVisible();
    await t2.waitForTimeout(1000);
    await expect(t2.getByText(SHARE)).toBeVisible();
    await expect(dialog(t2)).toHaveCount(0);
    await a.context().close();
  });

  await item('WAIT-06', async () => {
    const a = await page(browser);
    const url = await createOn(a);
    const stored = await role(a);
    // Hold every new connection down before leaving the game page
    await a.evaluate(() => { (window as any).__blockSockets = true; });
    await a.goBack();
    await expect(a.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    const before = (await sent(a)).length;
    await a.goForward();
    await expect(a.getByText(SHARE)).toBeVisible();
    await a.waitForTimeout(1000);
    await releaseConnection(a);
    await socketOpen(a);
    await expect(a.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await a.waitForTimeout(3000);
    await expect(a.getByText(SHARE)).toBeVisible();
    expect(await alertTexts(a)).toEqual([]);
    const rejoins = (await sent(a)).slice(before).filter((m) => m.type === 'rejoin_game');
    expect(rejoins.length).toBe(1);
    const b = await page(browser);
    await joinOn(b, url);
    await onBoard(a);
    expect(await getPlayerColor(a)).toBe(stored);
    await a.context().close(); await b.context().close();
    return `one rejoin sent (takeover ${rejoins[0].takeover}); share-link screen, no banner; a later join brought the creator's board as ${stored}`;
  });

  await item('WAIT-07', async () => {
    const a = await page(browser);
    const url = await createOn(a);
    await socketOpen(a);
    await dropConnection(a, { block: true });
    const rc = a.getByText('Reconnecting…');
    await expect(rc).toBeVisible();
    const box = (await rc.boundingBox())!;
    const vw = a.viewportSize()!.width;
    expect(box.x + box.width).toBeGreaterThan(vw - 40);
    expect(box.y).toBeLessThan(40);
    await a.waitForTimeout(3000);
    await expect(a.getByText(SHARE)).toBeVisible();
    await expect(a.getByText(url, { exact: true })).toBeVisible();
    await releaseConnection(a);
    await expect(rc).toHaveCount(0, { timeout: 15000 });
    await a.waitForTimeout(1500);
    await expect(a.getByText(SHARE)).toBeVisible();
    await expect(a.getByText(url, { exact: true })).toBeVisible();
    await a.context().close();
    return `"Reconnecting…" at x=${box.x.toFixed(0)}..${(box.x + box.width).toFixed(0)}, y=${box.y.toFixed(0)} in a ${vw} px window`;
  });

  await item('WAIT-08', async () => {
    const c = await ctx(browser);
    await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5173' });
    const a = await c.newPage();
    const url = await createOn(a);
    const btn = a.getByRole('button', { name: 'Copy link' });
    await btn.click();
    const copied = a.getByText('Copied', { exact: true });
    await expect(copied).toBeVisible();
    const bb = (await btn.boundingBox())!, cb = (await copied.boundingBox())!;
    expect(cb.x).toBeGreaterThan(bb.x + bb.width - 1);
    expect(Math.abs(cb.y + cb.height / 2 - (bb.y + bb.height / 2))).toBeLessThan(bb.height);
    const clip = await a.evaluate(() => navigator.clipboard.readText());
    const shown = await a.locator('p.break-all').textContent();
    expect(clip).toBe(shown);
    expect(clip).toBe(`http://localhost:5173/game/${gid(a)}`);
    const other = await page(browser);
    await other.goto(clip);
    await expect(other.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await other.context().close(); await c.close();
    return `clipboard read back "${clip}" = the link shown (${url === clip ? 'same as the address' : 'differs from address'}); opening it in another context shows the join screen`;
  });

  await item('WAIT-09', async () => {
    const c = await ctx(browser);
    await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5173' });
    const a = await c.newPage();
    await createOn(a);
    await a.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await focused(a)).toBe('BODY');
    await a.keyboard.press('Tab');
    expect(await focused(a)).toBe('BUTTON:Copy link');
    expect(await hasFocusRing(a)).toBe(true);
    await a.keyboard.press('Enter');
    await expect(a.getByText('Copied', { exact: true })).toBeVisible();
    await c.close();
    return 'focus ring read from the computed box-shadow';
  });

  await item('WAIT-10', async () => {
    const a = await page(browser, { viewport: { width: 375, height: 667 } });
    const url = await createOn(a);
    const m = await a.evaluate((u) => {
      const link = [...document.querySelectorAll('p')].find((p) => p.textContent === u)!;
      const h1 = document.querySelector('h1')!;
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Copy link')!;
      const lh = (el: Element) => parseFloat(getComputedStyle(el).lineHeight);
      const r = (el: Element) => el.getBoundingClientRect();
      const lr = r(link), hr = r(h1), br = r(btn);
      window.scrollTo(200, 0);
      const sx = window.scrollX;
      return {
        linkLines: Math.round((lr.height - parseFloat(getComputedStyle(link).paddingTop) - parseFloat(getComputedStyle(link).paddingBottom)) / lh(link)),
        linkOverflow: link.scrollWidth > link.clientWidth, linkLeft: lr.left, linkRight: lr.right,
        linkBg: getComputedStyle(link).backgroundColor,
        titleLines: Math.round(hr.height / lh(h1)), titleOverflow: h1.scrollWidth > h1.clientWidth,
        btn: [br.left, br.top, br.right, br.bottom],
        docW: document.documentElement.scrollWidth, vw: window.innerWidth, vh: window.innerHeight, sx,
      };
    }, url);
    expect(m.linkLines).toBeGreaterThan(1);
    expect(m.linkOverflow).toBe(false);
    expect(m.linkLeft).toBeGreaterThanOrEqual(0); expect(m.linkRight).toBeLessThanOrEqual(m.vw);
    expect(m.titleLines).toBe(1); expect(m.titleOverflow).toBe(false);
    expect(m.btn[0]).toBeGreaterThanOrEqual(0); expect(m.btn[2]).toBeLessThanOrEqual(m.vw); expect(m.btn[3]).toBeLessThanOrEqual(m.vh);
    expect(m.docW).toBeLessThanOrEqual(m.vw); expect(m.sx).toBe(0);
    await a.screenshot({ path: 'test-results/wait-10-narrow.png' });
    await a.context().close();
    return `link on ${m.linkLines} lines inside its box (${m.linkBg}); title ${m.titleLines} line; "Copy link" at ${m.btn.map((v) => v.toFixed(0)).join(',')}; page width ${m.docW} of ${m.vw}, scrollX after scrollTo(200) = ${m.sx}`;
  });

  {
    // A plain-http LAN address: the dev server listens on localhost only, so the
    // harness serves it under http://192.168.1.50:5173 by proxying each request.
    const LAN = 'http://192.168.1.50:5173';
    const c = await ctx(browser);
    await c.route((u) => u.href.startsWith(LAN), async (route) => {
      const r = await route.fetch({ url: route.request().url().replace(LAN, 'http://localhost:5173') });
      await route.fulfill({ response: r });
    });
    const a = await c.newPage();
    let served = false;
    try {
      await a.goto(LAN + '/');
      await a.getByRole('button', { name: 'Start New Game' }).waitFor({ timeout: 15000 });
      await expect(a.getByRole('status')).toHaveCount(0, { timeout: 10000 });
      served = true;
    } catch { /* below */ }
    if (!served) record('WAIT-11', 'blocked', 'the dev server could not be reached and connected under a LAN address in this container');
    else await item('WAIT-11', async () => {
      const secure = await a.evaluate(() => window.isSecureContext);
      await a.getByRole('button', { name: 'Start New Game' }).click();
      await a.waitForURL(/\/game\/[A-Z0-9]{6}$/);
      await expect(a.getByText(SHARE)).toBeVisible();
      await expect(a.getByText(`${LAN}/game/${gid(a)}`, { exact: true })).toBeVisible();
      await a.waitForTimeout(500);
      const copy = await a.getByRole('button', { name: 'Copy link' }).count();
      expect(secure).toBe(false);
      expect(copy).toBe(0);
      return `page served as ${LAN} (dev server proxied by the harness, isSecureContext=${secure}); share link shown, no "Copy link"; emulated in desktop Chromium, not a real second device`;
    });
    await c.close();
  }

  await item('WAIT-12', async () => {
    const a = await page(browser);
    const url = await createOn(a);
    const stored = await role(a);
    await a.goBack();
    await expect(a.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    await expect(a.getByRole('status')).toHaveCount(0, { timeout: 10000 });
    await dropConnection(a, { block: true });
    await expect(a.getByText('Reconnecting to server…')).toBeVisible();
    const before = (await sent(a)).length;
    await a.goForward();
    await expect(a.getByText(SHARE)).toBeVisible();
    await a.waitForTimeout(1000);
    await releaseConnection(a);
    await socketOpen(a);
    await expect(a.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await a.waitForTimeout(3000);
    await expect(a.getByText(SHARE)).toBeVisible();
    expect(await alertTexts(a)).toEqual([]);
    const rejoins = (await sent(a)).slice(before).filter((m) => m.type === 'rejoin_game');
    expect(rejoins.length).toBe(1);
    expect(await role(a)).toBe(stored);
    const b = await page(browser);
    await joinOn(b, url);
    await onBoard(a);
    expect(await getPlayerColor(a)).toBe(stored);
    await a.context().close(); await b.context().close();
    return `one rejoin sent; no banner; stored seat ${stored} kept and a later join seated the creator as ${stored}`;
  });
});

// ============================================================================
test('join', async ({ browser }) => {
  const a = await page(browser);
  const url = await createOn(a);
  const b = await page(browser);
  await item('JOIN-01', async () => {
    await b.goto(url);
    await expect(b.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await b.waitForTimeout(1000);
    expect(await b.getByRole('button').count()).toBe(1);
    expect((await b.locator('body').innerText()).trim()).toBe('3D Chess\nJoin Game');
  });
  await item('JOIN-02', async () => {
    await b.getByRole('button', { name: 'Join Game' }).click();
    await onBoard(a); await onBoard(b);
    const la = await a.locator('text=/You are playing as/').first().textContent();
    const lb = await b.locator('text=/You are playing as/').first().textContent();
    const ca = await getPlayerColor(a), cb = await getPlayerColor(b);
    expect(ca).not.toBe(cb);
    for (const p of [a, b]) {
      await expect(p.getByTestId('turn-indicator')).toHaveText('White to move');
      await expect(p.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    }
    return `creator ${ca}, joiner ${cb}`;
  });
  await item('JOIN-03', async () => {
    const c = await page(browser);
    await c.goto('/game/NOPE00');
    await c.getByRole('button', { name: 'Join Game' }).click();
    await expect(c.getByRole('alert')).toContainText('Error: Cannot join');
    await expect(c.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await c.context().close();
  });
  await item('JOIN-04', async () => {
    const c = await page(browser);
    await c.goto(url);
    await c.getByRole('button', { name: 'Join Game' }).click();
    await expect(c.getByRole('alert')).toContainText('Error: Game full');
    await expect(c.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await c.context().close();
  });
  await a.context().close(); await b.context().close();

  await item('JOIN-05', async () => {
    const x = await page(browser);
    const u = await createOn(x);
    const y = await page(browser);
    await y.goto(u);
    await expect(y.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await socketOpen(y);
    await clickThenCut(y, 'Join Game');
    await expect(y.getByText('Joined game, waiting for start...')).toBeVisible();
    await expect(y.getByText('Reconnecting…')).toBeVisible();
    await y.waitForTimeout(1000);
    await releaseConnection(y);
    await onBoard(y);
    const cy = await getPlayerColor(y);
    await onBoard(x);
    const cx = await getPlayerColor(x);
    expect(cy).not.toBe(cx);
    await expect(x.getByTestId('opponent-presence')).toHaveText('Opponent: online', { timeout: 15000 });
    expect((await alertTexts(y)).join()).not.toContain('Game full');
    await y.reload();
    await onBoard(y);
    expect(await getPlayerColor(y)).toBe(cy);
    await x.context().close(); await y.context().close();
    return `joiner seated as ${cy} (creator ${cx}) after the reconnect; same color after reload`;
  });

  await item('JOIN-06', async () => {
    const x = await page(browser);
    const u = await createOn(x);
    await x.close();
    const y = await page(browser);
    await joinOn(y, u);
    await expect(y.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    await x.context().close(); await y.context().close();
  });

  await item('JOIN-07', async () => {
    const x = await page(browser);
    const u = await createOn(x);
    const y = await page(browser);
    await y.goto(u);
    const y2 = await y.context().newPage();
    await y2.goto(u);
    await expect(y2.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await y.getByRole('button', { name: 'Join Game' }).click();
    await onBoard(y);
    await y2.getByRole('button', { name: 'Join Game' }).click();
    await expect(y2.getByRole('alert')).toContainText('Error: Game full');
    await x.context().close(); await y.context().close();
  });

  await item('JOIN-08', async () => {
    const x = await page(browser);
    const u = await createOn(x);
    const y = await page(browser);
    await y.goto(u);
    await expect(y.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await socketOpen(y);
    await clickThenCut(y, 'Join Game');
    await onBoard(x); // the join reached the server
    // A reload runs the page afresh, with connections allowed
    await y.reload();
    await expect(y.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await y.waitForTimeout(1000);
    await expect(y.getByRole('button', { name: 'Join Game' })).toBeVisible();
    expect(await role(y)).toBeNull();
    await socketOpen(y);
    await y.getByRole('button', { name: 'Join Game' }).click();
    await onBoard(y);
    const cy = await getPlayerColor(y), cx = await getPlayerColor(x);
    expect(cy).not.toBe(cx);
    expect((await alertTexts(y)).join()).not.toContain('Game full');
    await expect(x.getByTestId('opponent-presence')).toHaveText('Opponent: online', { timeout: 15000 });
    await x.context().close(); await y.context().close();
    return `after the reload: join screen, nothing stored; "Join Game" seated the tab as ${cy} (creator ${cx})`;
  });

  await item('JOIN-09', async () => {
    const x = await page(browser);
    const u = await createOn(x);
    const y = await page(browser);
    await y.goto(u);
    await expect(y.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await socketOpen(y);
    await clickThenCut(y, 'Join Game');
    await onBoard(x);
    const cy = y.context();
    await y.close();
    const y2 = await cy.newPage();
    await y2.goto(u);
    await expect(y2.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await socketOpen(y2);
    await y2.getByRole('button', { name: 'Join Game' }).click();
    await expect(y2.getByRole('alert')).toContainText('Error: Game full');
    await x.context().close(); await cy.close();
  });

  await item('JOIN-10', async () => {
    let x: Page | null = null, u = '', tries = 0;
    for (; tries < 12; tries++) {
      const p = await page(browser);
      u = await createOn(p);
      if ((await role(p)) === 'white') { x = p; break; }
      await p.context().close();
    }
    if (!x) throw new Error('creator never got white');
    const y = await page(browser);
    await y.goto(u);
    await expect(y.getByRole('button', { name: 'Join Game' })).toBeVisible();
    await socketOpen(y);
    await clickThenCut(y, 'Join Game');
    await onBoard(x);
    await expect(x.getByText('You are playing as white.')).toBeVisible();
    await playOn(x, 'white', 'Bb2', 'Bb3');
    await expect(x.getByTestId('turn-indicator')).toHaveText('Black to move');
    await resetGlides(y);
    await releaseConnection(y);
    await onBoard(y);
    await expect(y.getByTestId('turn-indicator')).toHaveText('Black to move');
    await y.waitForTimeout(2500);
    const pm = await pieceMap(y, 'black');
    expect(pm['Bb3']).toBe('white Pawn');
    expect(pm['Bb2']).toBeUndefined();
    expect(await listText(y)).toContain('1. Bb2–Bb3');
    expect(await glides(y)).toBe(0);
    await expect(x.getByTestId('opponent-presence')).toHaveText('Opponent: online', { timeout: 15000 });
    await x.context().close(); await y.context().close();
    return `creator white after ${tries + 1} game(s); joiner's board had the pawn on Bb3 with no glide frame sampled, "Black to move", list "${'1. Bb2–Bb3'}"`;
  });
});

// ============================================================================
test('reload', async ({ browser }) => {
  await item('RELOAD-01', async () => {
    const g = await startGame(browser);
    await settle(g.white);
    const cam0 = await cameraInfo(g.white);
    await playBoth(g.white, 'white', 'Bc1', 'Ec4', g.black);
    await drag(g.white, { x: 20, y: 400 }, 150, 0); await settle(g.white);
    const camOrbit = await cameraInfo(g.white);
    expect(Math.hypot(...camOrbit.pos.map((v: number, i: number) => v - cam0.pos[i]))).toBeGreaterThan(0.5);
    await g.white.reload();
    await onBoard(g.white);
    await settle(g.white);
    const s = await boardState(g.white);
    expect(s.lastFrom).toBe(1); expect(s.lastTo).toBe(1);
    expect(await glides(g.white)).toBe(0);
    expect((await pieceMap(g.white, 'white'))['Ec4']).toBe('white Queen');
    const tt = await turnText(g.white);
    expect(tt).toMatch(/^Black to move/);
    expect(await listText(g.white)).toContain('1. Bc1–Ec4');
    const cam = await cameraInfo(g.white);
    const d = Math.hypot(...cam.pos.map((v: number, i: number) => v - cam0.pos[i]));
    expect(d).toBeLessThan(0.05);
    await expect(g.white.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await g.close();
    return `turn indicator "${tt}"; camera after reload ${cam.pos.map((v: number) => v.toFixed(2)).join(',')} = first view (off by ${d.toFixed(3)}); no glide frame sampled`;
  });

  await item('RELOAD-03', async () => {
    const n = await startGame(browser);
    const aUrl = n.white.url();
    await playLine(n, MATE_LINE.slice(0, 3));
    await playOn(n.black, 'black', 'Bc3', 'Ab2');
    await expect(n.white.getByText('Black wins by checkmate!')).toBeVisible();
    const finalMap = await pieceMap(n.white, 'white');
    await n.white.getByRole('button', { name: 'Start new game', exact: true }).click();
    await n.white.getByRole('button', { name: 'Start New Game', exact: true }).click();
    await n.white.waitForURL(/\/game\/[A-Z0-9]{6}$/);
    const bUrl = n.white.url(), bId = gid(n.white);
    await expect(n.white.getByText(SHARE)).toBeVisible();
    await n.white.evaluate(() => history.go(-2));
    await n.white.waitForURL(aUrl);
    await onBoard(n.white);
    await expect(n.white.getByRole('dialog', { name: 'Black wins by checkmate!' })).toBeVisible();
    await settle(n.white);
    expect(await pieceMap(n.white, 'white')).toEqual(finalMap);
    const text = await n.white.locator('body').innerText();
    expect(text).not.toContain(bId);
    expect(text).not.toContain(SHARE);
    expect(n.white.url()).toBe(aUrl);
    await n.close();
    return `jumped from B ${bUrl.split('/game/')[1]} to A ${aUrl.split('/game/')[1]}: A's board, final position and end-game dialog; no trace of B`;
  });

  await item('RELOAD-04', async () => {
    const g = await startGame(browser);
    const t2 = await secondTab(g.white);
    await expect(dialog(g.white)).toBeVisible();
    await g.white.reload();
    await onBoard(g.white);
    await expect(dialog(t2)).toBeVisible();
    await g.white.waitForTimeout(1000);
    await expect(dialog(g.white)).toHaveCount(0);
    await g.close();
  });

  await item('RELOAD-05', async () => {
    const pc = await ctx(browser), qc = await ctx(browser);
    const P = await pc.newPage();
    const bUrl = await createOn(P);
    const bId = gid(P);
    const colorB = await role(P);
    const qB = await qc.newPage();
    await joinOn(qB, bUrl);
    await onBoard(P);
    expect(await getPlayerColor(P)).toBe(colorB);
    await pushStart(P);
    await expect(P.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    let aUrl = '', colorA = '', tries = 0;
    for (; tries < 12; tries++) {
      await expect(P.getByRole('status')).toHaveCount(0, { timeout: 10000 });
      await P.getByRole('button', { name: 'Start New Game' }).click();
      await P.waitForURL(/\/game\/[A-Z0-9]{6}$/);
      aUrl = P.url(); colorA = (await role(P))!;
      if (colorA !== colorB) break;
      await P.goBack();
      await expect(P.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    }
    expect(colorA).not.toBe(colorB);
    const qA = await qc.newPage();
    await joinOn(qA, aUrl);
    await onBoard(P);
    expect(await getPlayerColor(P)).toBe(colorA);
    await resetPres(qB);
    await P.evaluate(() => history.go(-2));
    await P.waitForURL(bUrl);
    await onBoard(P);
    await expect(P.getByText(`You are playing as ${colorB}.`)).toBeVisible();
    await P.waitForTimeout(2500);
    await expect(P.getByRole('alertdialog')).toHaveCount(0);
    await expect(qB.getByRole('alertdialog')).toHaveCount(0);
    await expect(qB.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    const stored = await role(P, bId);
    expect(stored).toBe(colorB);
    await pc.close(); await qc.close();
    return `P was ${colorB} in B, ${colorA} in A (after ${tries + 1} game(s)); after the jump P shows B as ${colorB}, stored seat ${stored}; start screen reached by an in-page history push (no link exists), Back used to discard an A with the same color`;
  });

  await item('RELOAD-06', async () => {
    const g = await startGame(browser);
    const w1 = g.white;
    const w2 = await secondTab(w1);
    await expect(dialog(w1)).toBeVisible();
    // Reload the first tab with every incoming message lost, then cut it once its rejoin is out
    await w1.evaluate(() => sessionStorage.setItem('vh:lose', '1'));
    await w1.reload();
    await w1.waitForFunction(() => (window as any).__sent.some((s: string) => JSON.parse(s).type === 'rejoin_game'));
    await dropConnection(w1, { block: true });
    await w1.evaluate(() => { sessionStorage.removeItem('vh:lose'); (window as any).__loseIncoming = false; });
    const firstRejoin = (await sent(w1)).find((m) => m.type === 'rejoin_game');
    await expect(w1.getByText('Reconnecting…')).toBeVisible();
    await w2.reload();
    await onBoard(w2);
    await w2.waitForTimeout(1000);
    await expect(dialog(w2)).toHaveCount(0);
    await releaseConnection(w1);
    await onBoard(w1);
    await expect(dialog(w2)).toBeVisible({ timeout: 15000 });
    await w1.waitForTimeout(1000);
    await expect(dialog(w1)).toHaveCount(0);
    const rejoins = (await sent(w1)).filter((m) => m.type === 'rejoin_game').map((m) => m.takeover);
    await g.close();
    return `first tab's rejoins (takeover): ${JSON.stringify(rejoins)}; first answer lost by discarding incoming messages, then cut (first rejoin takeover ${firstRejoin?.takeover})`;
  });
});

// ============================================================================
test('drop', async ({ browser }) => {
  await item('DROP-01', async () => {
    const g = await startGame(browser);
    await press(g.white, 'Bb2', 'white');
    await expect.poll(async () => (await boardState(g.white)).selectionRings).toBe(1);
    await resetPres(g.black);
    await dropConnection(g.white, { block: true });
    await expect(g.white.getByText('Reconnecting…')).toBeVisible();
    await expect.poll(async () => (await boardState(g.white)).selectionRings).toBe(0);
    await moveBox(g.white).fill('Bb2-Bb3');
    await expect(moveButton(g.white)).toBeDisabled();
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    await moveBox(g.white).fill('');
    await releaseConnection(g.white);
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await playBoth(g.white, 'white', 'Bb2', 'Bb3', g.black);
    await g.close();
    return '"Move" checked disabled with "Bb2-Bb3" typed during the drop';
  });

  await item('DROP-03', async () => {
    const g = await startGame(browser);
    await g.white.evaluate(() => { for (const s of (window as any).__sockets) if (s.readyState === 1) s.close(4000, 'test'); });
    await expect(g.white.getByText('Reconnecting…')).toBeVisible();
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await playBoth(g.white, 'white', 'Bb2', 'Bb3', g.black);
    await g.close();
    return 'closed from the page with code 4000; retried, recovered, and White then moved';
  });

  await item('DROP-02', async () => {
    const h = await startGame(browser);
    const W = h.white;
    await loseIncoming(W, true);
    await press(W, 'Bb2', 'white');
    await expect.poll(async () => (await highlighted(W, 'white')).includes('Bb3')).toBe(true);
    await press(W, 'Bb3', 'white');
    await expect(h.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    await dropConnection(W, { block: true });
    await loseIncoming(W, false);
    await playBoth(h.black, 'black', 'Ed4', 'Ed3', h.black);
    expect(await turnText(W)).toBe('White to move');
    expect((await pieceMap(W, 'white'))['Bb2']).toBe('white Pawn');
    await delayAnswersAfterOpen(W, 9000);
    const before = (await sent(W)).length;
    await releaseConnection(W);
    await expect(W.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    const tOpen = Date.now();
    await delayAnswersAfterOpen(W, 0);
    // Still the stale position: Bb2 in place
    expect((await pieceMap(W, 'white'))['Bb2']).toBe('white Pawn');
    await press(W, 'Bb2', 'white');
    await W.waitForTimeout(400);
    const sel = (await boardState(W)).selectionRings;
    await moveBox(W).fill('Bb2-Bb3');
    const disabled = await moveButton(W).isDisabled();
    await moveBox(W).press('Enter');
    await W.waitForTimeout(300);
    const stillStale = (await pieceMap(W, 'white'))['Bb2'] === 'white Pawn';
    const tChecked = (Date.now() - tOpen) / 1000;
    expect(stillStale).toBe(true);
    expect(sel).toBe(0);
    expect(disabled).toBe(true);
    await resetGlides(W);
    await expect.poll(async () => (await pieceMap(W, 'white'))['Ed3'], { timeout: 20000 }).toBe('black Pawn');
    await expect.poll(() => glides(W), { timeout: 5000 }).toBeGreaterThan(0);
    const after = (await sent(W)).slice(before);
    expect(after.filter((m) => m.type === 'move')).toEqual([]);
    const pm = await pieceMap(W, 'white');
    expect(pm['Bb3']).toBe('white Pawn');
    expect(pm['Bb2']).toBeUndefined();
    expect(await turnText(W)).toBe('White to move');
    expect(await W.getByText(/is not a legal move/).count()).toBe(0);
    await moveBox(W).fill('');
    await playBoth(W, 'white', 'Bc2', 'Bc3', h.black);
    await playBoth(h.black, 'black', 'Ec4', 'Ec3', W);
    const lw = await listText(W);
    await h.close();
    return `stale checks done ${tChecked.toFixed(1)} s into a 9 s hold: no selection, "Move" disabled, nothing sent (${JSON.stringify(after.map((m) => m.type))}); then Bb3 in place, Ed4-Ed3 glided in, play continued: "${lw}"`;
  });

  await item('DROP-05', async () => {
    const g = await startGame(browser);
    await dropConnection(g.white, { block: true });
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    const t2 = await secondTab(g.white);
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: online');
    await resetPres(g.black);
    await releaseConnection(g.white);
    await expect(dialog(g.white)).toBeVisible({ timeout: 15000 });
    await expect.poll(() => focused(g.white)).toBe('BUTTON:Play here');
    expect(await alertTexts(g.white)).toEqual([]);
    await expect(dialog(t2)).toHaveCount(0);
    await playBoth(t2, 'white', 'Bb2', 'Bb3', g.black);
    await g.white.waitForTimeout(1000);
    const pres = await presLog(g.black);
    expect(pres).not.toContain('Opponent: offline');
    await g.close();
    return `Black presence after the second tab opened: ${JSON.stringify(pres)}`;
  });

  await item('DROP-06', async () => {
    const g = await startGame(browser, { viewport: { width: 375, height: 667 } });
    await dropConnection(g.white, { block: true });
    const rc = g.white.getByText('Reconnecting…');
    await expect(rc).toBeVisible();
    const t = (await g.white.getByTestId('turn-indicator').boundingBox())!;
    const s = (await g.white.getByText(/You are playing as/).first().boundingBox())!;
    const r = (await rc.boundingBox())!;
    const overlap = (a: any, b: any) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    await g.white.screenshot({ path: 'test-results/drop-06-narrow.png' });
    expect(t.y + t.height).toBeLessThanOrEqual(Math.min(s.y, r.y) + 0.5);
    expect(r.x).toBeGreaterThanOrEqual(s.x + s.width - 0.5);
    expect(r.y).toBeLessThan(s.y + s.height);
    expect(r.x + r.width).toBeGreaterThan(375 - 30);
    expect(overlap(t, r) || overlap(t, s) || overlap(s, r)).toBe(false);
    await g.close();
    const f = (b: any) => `${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.width.toFixed(0)}x${b.height.toFixed(0)}`;
    return `turn ${f(t)}; seat ${f(s)}; reconnecting ${f(r)}`;
  });
});

// ============================================================================
test('tab', async ({ browser }) => {
  await item('TAB-01', async () => {
    const k = await startGame(browser);
    await drag(k.white, { x: 20, y: 400 }, 150, 0); await settle(k.white);
    const cam = await cameraInfo(k.white);
    await resetPres(k.black);
    const t2 = await secondTab(k.white);
    await expect(dialog(k.white)).toBeVisible();
    await playBoth(t2, 'white', 'Bb2', 'Bb3', k.black);
    await resetGlides(k.white);
    await k.white.getByRole('button', { name: 'Play here' }).click();
    await expect(dialog(k.white)).toHaveCount(0, { timeout: 10000 });
    await expect(k.white.getByTestId('turn-indicator')).toHaveText('Black to move', { timeout: 15000 });
    await expect.poll(() => glides(k.white), { timeout: 5000 }).toBeGreaterThan(0);
    await expect(dialog(t2)).toBeVisible();
    await settle(k.white);
    expect((await pieceMap(k.white, 'white'))['Bb3']).toBe('white Pawn');
    const cam2 = await cameraInfo(k.white);
    const d = Math.hypot(...cam2.pos.map((v: number, i: number) => v - cam.pos[i]));
    expect(d).toBeLessThan(0.1);
    const pres = await presLog(k.black);
    expect(pres).not.toContain('Opponent: offline');
    await k.close();
    return `glide seen after "Play here"; camera moved ${d.toFixed(3)}; Black presence ${JSON.stringify(pres)}`;
  });

  await item('TAB-03', async () => {
    const k = await startGame(browser);
    const t3 = await secondTab(k.white);
    await expect(dialog(k.white)).toBeVisible();
    await t3.close();
    await expect(k.black.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    await k.white.waitForTimeout(1500);
    await expect(dialog(k.white)).toBeVisible();
    await k.close();
  });

  // TAB-02 then TAB-05 on the same game
  {
    const g = await startGame(browser);
    let t2: Page | null = null;
    let ok02 = false;
    await item('TAB-02', async () => {
      await dropConnection(g.white, { block: true });
      await expect(g.white.getByText('Reconnecting…')).toBeVisible();
      t2 = await secondTab(g.white);
      await releaseConnection(g.white);
      await expect(dialog(g.white)).toBeVisible({ timeout: 15000 });
      await expect.poll(() => focused(g.white)).toBe('BUTTON:Play here');
      expect(await alertTexts(g.white)).toEqual([]);
      await g.white.waitForTimeout(1000);
      await expect(dialog(t2)).toHaveCount(0);
      await playBoth(t2, 'white', 'Bb2', 'Bb3', g.black);
      await expect(dialog(g.white)).toBeVisible();
      ok02 = true;
    });
    await item('TAB-05', async () => {
      if (!ok02 || !t2) throw new Error('setup (TAB-02) failed');
      const T2 = t2 as Page;
      await playBoth(g.black, 'black', 'Ed4', 'Ed3', T2);
      await resetPres(g.black);
      await g.white.getByRole('button', { name: 'Play here' }).click();
      const t0 = Date.now();
      await expect(dialog(g.white)).toHaveCount(0, { timeout: 2000 });
      const closeMs = Date.now() - t0;
      await expect(dialog(T2)).toBeVisible({ timeout: 15000 });
      await expect.poll(() => focused(T2)).toBe('BUTTON:Play here');
      await playBoth(g.white, 'white', 'Bc2', 'Bc3', g.black);
      await g.white.waitForTimeout(500);
      const pres = await presLog(g.black);
      expect(pres).not.toContain('Opponent: offline');
      return `dialog gone ${closeMs} ms after the click; first tab then moved Bc2-Bc3; Black presence ${JSON.stringify(pres)}`;
    });
    await g.close();
  }

  await item('TAB-07', async () => {
    const g = await startGame(browser);
    await dropConnection(g.white, { block: true });
    await expect(g.white.getByText('Reconnecting…')).toBeVisible();
    const t2 = await secondTab(g.white);
    await releaseConnection(g.white);
    await expect(dialog(g.white)).toBeVisible({ timeout: 15000 });
    await t2.close();
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: offline');
    await dropConnection(g.white, { block: true });
    await expect(g.white.getByText('Reconnecting…')).toBeVisible();
    await expect(dialog(g.white)).toHaveCount(0);
    await releaseConnection(g.white);
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    await expect(g.black.getByTestId('opponent-presence')).toHaveText('Opponent: online', { timeout: 15000 });
    await expect(dialog(g.white)).toHaveCount(0);
    await playBoth(g.white, 'white', 'Bb2', 'Bb3', g.black);
    const rejoins = (await sent(g.white)).filter((m) => m.type === 'rejoin_game').map((m) => m.takeover);
    await g.close();
    return `no click; rejoins sent by the first tab (takeover): ${JSON.stringify(rejoins)}`;
  });

  await item('TAB-04', async () => {
    const m = await startGame(browser);
    await playLine(m, MATE_LINE.slice(0, 3));
    await playOn(m.black, 'black', 'Bc3', 'Ab2');
    await expect(m.white.getByText('Black wins by checkmate!')).toBeVisible();
    const t2 = await secondTab(m.white);
    await expect(dialog(m.white)).toBeVisible();
    await expect.poll(() => focused(m.white)).toBe('BUTTON:Play here');
    const first = await focused(m.white);
    await m.white.keyboard.press('Escape');
    await m.white.mouse.click(10, 10);
    await m.white.waitForTimeout(500);
    await expect(dialog(m.white)).toBeVisible();
    const order: string[] = [];
    for (let i = 0; i < 8; i++) { await m.white.keyboard.press('Tab'); order.push(await focused(m.white)); }
    expect(order.every((f) => f === 'BUTTON:Play here' || f === 'BODY')).toBe(true);
    expect(order).toContain('BUTTON:Play here');
    await t2.close(); await m.close();
    return `focus on open: ${first}; after Escape and a backdrop click the dialog stayed; Tab x8: ${order.join(' -> ')}`;
  });

  await item('TAB-06', async () => {
    const a = await page(browser);
    const url = await createOn(a);
    await socketOpen(a);
    // Put an error banner on the page first, so there is a "✕" to keep out of reach
    await rawSend(a, { type: 'join_game', gameId: 'NOPE00' });
    await expect(a.getByRole('alert')).toContainText('Error:');
    const banner = (await alertTexts(a)).join();
    const t2 = await a.context().newPage();
    await t2.goto(url);
    await expect(t2.getByText(SHARE)).toBeVisible();
    await expect(dialog(a)).toBeVisible();
    await expect.poll(() => focused(a)).toBe('BUTTON:Play here');
    const first = await focused(a);
    expect(await a.getByRole('button', { name: 'Dismiss error' }).count()).toBe(1);
    const order: string[] = [];
    for (let i = 0; i < 8; i++) { await a.keyboard.press('Tab'); order.push(await focused(a)); }
    expect(order.every((f) => f === 'BUTTON:Play here' || f === 'BODY')).toBe(true);
    await a.context().close();
    return `banner present ("${banner}"); focus on open: ${first}; Tab x8: ${order.join(' -> ')}`;
  });
});
