import { test, expect, type Page } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import { startTappedGame, newTappedPage, item, press, pressAt, pixelOf, projectCell, boardState, highlighted, turnText, playOn } from './vh';
import { playLine } from './line';
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);
const board = (p: Page) => p.waitForFunction(() => !!(window as any).__r3fState);
function stopServer() { try { execSync('kill $(lsof -ti tcp:8000 -sTCP:LISTEN)'); } catch { /* none */ } execSync('sleep 1'); }
function startServer() {
  const c = spawn('uv', ['run', '--extra', 'test', 'uvicorn', 'modal_app:create_web_app', '--factory', '--host', '127.0.0.1', '--port', '8000'], { cwd: require('node:path').join(__dirname, '../../../server'), detached: true, stdio: 'ignore' });
  c.unref();
  for (let i = 0; i < 40; i++) { try { execSync('curl -sf http://127.0.0.1:8000/health', { stdio: 'ignore' }); return; } catch { execSync('sleep 0.5'); } }
  throw new Error('server did not start');
}
const role = (p: Page, url: string) => p.evaluate((id) => localStorage.getItem(`3dchess:role:${id}`), url.split('/game/')[1]);

test('server stop and restart', async ({ browser }) => {
  await item('CONN-04', async () => {
    const p = await newTappedPage(browser); await p.goto('/');
    await expect(p.getByRole('status')).toHaveCount(0, { timeout: 5000 });
    stopServer();
    await expect(p.getByRole('status')).toHaveText('Reconnecting to server…');
    startServer();
    await expect(p.getByRole('status')).toHaveCount(0, { timeout: 15000 });
    await p.context().close();
  });
  await item('NAV-07', async () => {
    const p = await newTappedPage(browser); await p.goto('/'); await p.getByRole('button', { name: 'Start New Game' }).click(); await p.waitForURL(/\/game\//);
    stopServer();
    await expect(p.getByText('Reconnecting…')).toBeVisible();
    const box = await p.getByText('Reconnecting…').boundingBox();
    startServer();
    await p.context().close();
    return `"Reconnecting…" at x=${box!.x.toFixed(0)}, y=${box!.y.toFixed(0)} on the share-link screen`;
  });
  // A started game, then the joiner reloads while the server is down
  const g = await startTappedGame(browser);
  const joinerIsWhite = await g.white.evaluate(() => performance.navigation.type === 0);
  await item('CONN-09', async () => {
    stopServer();
    await g.black.reload();
    await expect(g.black.getByText('Game created! Share this link with a friend:')).toBeVisible();
    await expect(g.black.getByText('Reconnecting…')).toBeVisible({ timeout: 10000 });
    return 'the reloaded page of a started game showed "Game created! Share this link with a friend:" with "Reconnecting…" (suspected copy bug confirmed)';
  });
  // the restart wipes the games: both pages reconnect and are refused
  await item('DROP-04', async () => {
    startServer();
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 20000 });
    await expect(g.white.getByRole('alert')).toHaveText(/Cannot rejoin/, { timeout: 10000 });
    expect(await g.white.evaluate(() => !!(window as any).__r3fState)).toBe(true);
    await playOn(g.white, 'white', 'Bb2', 'Bb3');
    await expect(g.white.getByRole('alert')).toHaveText(/Not in a game/);
    expect(await turnText(g.white)).toBe('White to move');
    const u = g.white.url();
    expect(await role(g.white, u)).toBe('white');
    return 'board kept; "Error: Cannot rejoin", then "Error: Not in a game" for a move; stored seat kept';
  });
  await item('CONN-08', async () => {
    const u = g.black.url();
    await expect(g.black.getByRole('button', { name: 'Join Game' })).toBeVisible({ timeout: 20000 });
    await expect(g.black.getByRole('alert')).toHaveText(/Cannot rejoin/);
    expect(await role(g.black, u)).toBeNull();
    return 'the reloaded (never snapshotted) page: join screen, "Error: Cannot rejoin", stored seat deleted';
  });
  await item('RELOAD-02', async () => {
    const seen: string[] = [];
    const poll = (async () => { for (let i = 0; i < 40; i++) { seen.push(await g.black.getByText('Joined game, waiting for start...').isVisible() ? 'joined' : 'x'); await g.black.waitForTimeout(25); } })();
    await g.black.getByRole('button', { name: 'Join Game' }).click();
    await poll;
    await expect(g.black.getByRole('alert')).toHaveText(/Cannot join/);
    await expect(g.black.getByRole('button', { name: 'Join Game' })).toBeVisible();
    return `joined screen observed in ${seen.filter((s) => s === 'joined').length} of 40 samples at 25 ms; ended on "Error: Cannot join"`;
  });
  await g.close();
});

test('view and input leftovers', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('VIEW-09', async () => {
    await playLine(g, ['Ab2-Ab3', 'Ed4-Ed3']);
    await press(g.white, 'Bd1', 'white'); await g.white.waitForTimeout(200);
    const r = await g.white.evaluate(() => { const out: Record<string, unknown>[] = []; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.cube && (o.userData.highlight || o.userData.lastMoveFrom || o.userData.lastMoveTo)) out.push({ ...o.userData, color: '#' + o.material.color.getHexString(), p: o.position.toArray().map((v: number) => +v.toFixed(2)) }); }); return out; });
    const dests = await highlighted(g.white, 'white');
    expect(dests).toContain('Ed4');
    const teal = r.filter((x) => x.color === '#14b8a6');
    expect(teal.length).toBe(1);
    return `Bishop destinations ${dests.join(',')}; teal cells now ${teal.length} (Ed3 only); Ed4 amber`;
  });
  await item('VIEW-08', async () => {
    await g.white.screenshot({ path: 'test-results/markers.png' });
    const c = await g.white.evaluate(() => { const out: string[] = []; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.selectionRing || o.userData?.captureRing) out.push((o.userData.selectionRing ? 'select ' : 'capture ') + '#' + o.material.color.getHexString()); if (o.geometry?.type === 'SphereGeometry' && o.geometry.parameters?.radius === 0.11) out.push('dot #' + o.material.color.getHexString()); }); return [...new Set(out)]; });
    return `marker colors: ${c.join(', ')} (screenshot markers.png)`;
  });
  await item('INPUT-11', async () => {
    await pressAt(g.white, { x: 8, y: 400 });
    const t = await g.white.getByTestId('turn-indicator').boundingBox();
    const hit = await g.white.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x: t!.x + t!.width / 2, y: t!.y + t!.height / 2 });
    const s = await g.white.locator('text=/You are playing as/').boundingBox();
    const hit2 = await g.white.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x: s!.x + 20, y: s!.y + 10 });
    expect(hit).toBe('CANVAS'); expect(hit2).not.toBe('CANVAS');
    return `the point under the turn indicator hits <${hit}>; under the seat label <${hit2}>`;
  });
  await g.close();
  await item('INPUT-14', async () => {
    const t = await startTappedGame(browser, { hasTouch: true, viewport: { width: 800, height: 600 } });
    const p = await pixelOf(t.white, 'Bb2', 'white');
    const cdp = await t.white.context().newCDPSession(t.white);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await t.white.waitForTimeout(300);
    const s = await boardState(t.white);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await t.close();
    expect(s.selectionRings).toBe(1);
    return 'selected while the emulated finger was still down';
  });
});
