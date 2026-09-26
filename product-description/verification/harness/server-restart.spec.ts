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
    return 'the reloaded page of a started game showed "Game created! Share this link with a friend:" with "Reconnecting…" (bug-triage B-12, still open)';
  });
  // the restart wipes the games: both pages reconnect and are refused
  await item('DROP-04', async () => {
    startServer();
    await expect(g.white.getByText('Reconnecting…')).toHaveCount(0, { timeout: 20000 });
    await expect(g.white.getByRole('alert')).toHaveText(/Cannot rejoin/, { timeout: 10000 });
    expect(await g.white.evaluate(() => !!(window as any).__r3fState)).toBe(true);
    await press(g.white, 'Bb2', 'white'); await g.white.waitForTimeout(300);
    expect((await boardState(g.white)).selectionRings).toBe(0);
    const box = g.white.getByRole('textbox', { name: 'Type a move (e.g. Ab2-Ab3)' });
    await box.fill('Bb2-Bb3'); await box.press('Enter'); await g.white.waitForTimeout(500);
    await expect(g.white.getByRole('button', { name: 'Move', exact: true })).toBeDisabled();
    expect(await turnText(g.white)).toBe('White to move');
    expect(await g.white.getByRole('alert').allTextContents()).toEqual(['Error: Cannot rejoin✕']);
    const u = g.white.url();
    expect(await role(g.white, u)).toBe('white');
    return 'board kept; "Error: Cannot rejoin"; a press selected nothing, "Move" stayed disabled, and nothing was sent; stored seat kept';
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
    await press(g.white, 'Bc1', 'white'); await g.white.waitForTimeout(300);
    expect((await boardState(g.white)).captureRings).toBeGreaterThan(0);
    await g.white.screenshot({ path: 'test-results/markers.png' });
    const c = await g.white.evaluate(() => { const out: string[] = []; (window as any).__r3fState.get().scene.traverse((o: any) => { if (o.userData?.selectionRing || o.userData?.captureRing) out.push((o.userData.selectionRing ? 'select ' : 'capture ') + '#' + o.material.color.getHexString()); if (o.geometry?.type === 'SphereGeometry' && o.geometry.parameters?.radius === 0.11) out.push('dot #' + o.material.color.getHexString()); }); return [...new Set(out)]; });
    return `marker colors: ${c.join(', ')} (screenshot markers.png)`;
  });
  await item('INPUT-11', async () => {
    // What a press at the centre of each panel reaches: the canvas means the
    // press goes through to the board
    const at = async (loc: import('@playwright/test').Locator) => {
      const b = (await loc.boundingBox())!;
      return g.white.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    };
    const turn = await at(g.white.getByTestId('turn-indicator'));
    const seat = await at(g.white.locator('text=/You are playing as/'));
    const moveBox = await at(g.white.getByText('Type a move (e.g. Ab2-Ab3)'));
    expect(turn).toBe('CANVAS'); expect(seat).toBe('CANVAS'); expect(moveBox).not.toBe('CANVAS');
    return `a press on the turn indicator reaches <${turn}>, on the seat label <${seat}>, on the move box's label <${moveBox}>`;
  });
  await g.close();
  await item('INPUT-14', async () => {
    const t = await startTappedGame(browser, { hasTouch: true, viewport: { width: 800, height: 600 } });
    const p = await pixelOf(t.white, 'Bb2', 'white');
    const cdp = await t.white.context().newCDPSession(t.white);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await t.white.waitForTimeout(300);
    const down = await boardState(t.white);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await t.white.waitForTimeout(400);
    const up = await boardState(t.white);
    await t.close();
    expect(down.selectionRings).toBe(0);
    expect(up.selectionRings).toBe(1);
    return 'nothing selected while the emulated finger was down; selected when it lifted';
  });
});
