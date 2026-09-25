import { test, expect } from '@playwright/test';
import { startTappedGame, item, press, pressAt, drag, projectCell, pixelOf, boardState, cameraInfo, pieceMap, highlighted, turnText, listText, dropConnection, releaseConnection, attemptTimes, playOn } from './vh';
import { playLine, MATE_LINE, PROMO_LINE } from './line';

test.describe.configure({ mode: 'serial' });

test('rules', async ({ browser }) => {
  const g = await startTappedGame(browser);
  await item('RULES-01', async () => {
    const m = await pieceMap(g.white, 'white');
    expect(Object.keys(m).length).toBe(40);
    const exp: Record<string, string> = { Aa1: 'white Rook', Ab1: 'white Knight', Ac1: 'white King', Ad1: 'white Knight', Ae1: 'white Rook', Ba1: 'white Bishop', Bb1: 'white Unicorn', Bc1: 'white Queen', Bd1: 'white Bishop', Be1: 'white Unicorn', Ea5: 'black Rook', Eb5: 'black Knight', Ec5: 'black King', Ed5: 'black Knight', Ee5: 'black Rook', Da5: 'black Unicorn', Db5: 'black Bishop', Dc5: 'black Queen', Dd5: 'black Unicorn', De5: 'black Bishop' };
    for (const f of 'abcde') { exp[`A${f}2`] = exp[`B${f}2`] = 'white Pawn'; exp[`E${f}4`] = exp[`D${f}4`] = 'black Pawn'; }
    expect(m).toEqual(exp);
  });
  await item('RULES-02', async () => {
    expect(await turnText(g.white)).toBe('White to move');
    expect(await turnText(g.black)).toBe('White to move');
    await press(g.black, 'Ed4', 'black');
    await g.black.waitForTimeout(200);
    expect((await boardState(g.black)).selectionRings).toBe(0);
  });
  await item('RULES-03', async () => {
    await press(g.white, 'Bb2', 'white'); await g.white.waitForTimeout(200);
    expect(await highlighted(g.white, 'white')).toEqual(['Bb3', 'Cb2']);
    await press(g.white, 'Ab2', 'white'); await g.white.waitForTimeout(200);
    expect(await highlighted(g.white, 'white')).toEqual(['Ab3']);
  });
  await item('RULES-04', async () => {
    await press(g.white, 'Ab1', 'white'); await g.white.waitForTimeout(200);
    expect(await highlighted(g.white, 'white')).toEqual(['Aa3', 'Ac3', 'Bb3', 'Ca1', 'Cb2', 'Cc1']);
  });
  await item('RULES-05', async () => {
    await press(g.white, 'Bc1', 'white'); await g.white.waitForTimeout(200);
    expect(await highlighted(g.white, 'white')).toEqual(['Cb1', 'Cb2', 'Cc1', 'Cc2', 'Cd1', 'Cd2', 'Da1', 'Da3', 'Dc1', 'Dc3', 'De1', 'De3', 'Ec1', 'Ec4']);
    expect((await boardState(g.white)).captureRings).toBe(1);
  });
  await item('RULES-06', async () => {
    await press(g.white, 'Ac1', 'white'); await g.white.waitForTimeout(200);
    const s = await boardState(g.white);
    expect(s.selectionRings).toBe(1); expect(s.highlights).toBe(0);
  });
  await g.close();

  const g2 = await startTappedGame(browser);
  await item('RULES-07', async () => {
    await playLine(g2, PROMO_LINE);
    await press(g2.white, 'Da4', 'white'); await g2.white.waitForTimeout(200);
    expect(await highlighted(g2.white, 'white')).toEqual(['Db5', 'Ea5', 'Eb4']);
    expect((await boardState(g2.white)).captureRings).toBe(3);
  });
  await item('RULES-08', async () => {
    await playOn(g2.white, 'white', 'Da4', 'Db5');
    await expect(g2.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await g2.white.getByRole('dialog').count()).toBe(0);
    const l = await listText(g2.white);
    expect(l).toContain('Da4–Db5'); expect(l).not.toContain('=');
    expect((await pieceMap(g2.white, 'white'))['Db5']).toBe('white Pawn');
  });
  await g2.close();

  const g3 = await startTappedGame(browser);
  await item('RULES-10', async () => {
    await playLine(g3, MATE_LINE.slice(0, 3));
    await playOn(g3.black, 'black', 'Bc3', 'Ab2');
    await expect(g3.white.getByText('Black wins by checkmate!')).toBeVisible();
    await expect(g3.black.getByText('Black wins by checkmate!')).toBeVisible();
  });
  await g3.close();
});

test('input', async ({ browser }) => {
  const g = await startTappedGame(browser);
  const w = g.white;
  await item('INPUT-01', async () => {
    const p = await pixelOf(w, 'Bb2', 'white');
    await w.mouse.move(p.x, p.y); await w.mouse.down();
    await w.waitForTimeout(250);
    const s = await boardState(w);
    await w.mouse.up();
    expect(s.selectionRings).toBe(1); expect(s.highlights).toBe(2);
  });
  await item('INPUT-04', async () => {
    await pressAt(w, { x: 8, y: 400 }); await w.waitForTimeout(200);
    expect((await boardState(w)).selectionRings).toBe(1);
  });
  await item('INPUT-06', async () => {
    const c = await projectCell(w, 'Cc3', 'white');
    await w.mouse.move(c.x, c.y); await w.mouse.wheel(0, -300); await w.waitForTimeout(300); await w.mouse.wheel(0, 300); await w.waitForTimeout(300);
    expect((await boardState(w)).selectionRings).toBe(1);
  });
  await item('INPUT-07', async () => {
    await press(w, 'Ed4', 'white'); await w.waitForTimeout(200);
    expect((await boardState(w)).selectionRings).toBe(0);
  });
  await item('INPUT-08', async () => {
    await press(w, 'Bb2', 'white'); await w.waitForTimeout(150);
    await press(w, 'Bc2', 'white'); await w.waitForTimeout(150);
    expect(await highlighted(w, 'white')).toEqual(['Bc3', 'Cc2']);
  });
  await item('INPUT-05', async () => {
    await pressAt(w, { x: 8, y: 400 });
    await press(w, 'Ed4', 'white'); // clear
    await press(w, 'Bb2', 'white', 'right'); await w.waitForTimeout(200);
    const r = await highlighted(w, 'white');
    await press(w, 'Ed4', 'white');
    await press(w, 'Bb2', 'white', 'middle'); await w.waitForTimeout(200);
    const m = await highlighted(w, 'white');
    expect(r).toEqual(['Bb3', 'Cb2']); expect(m).toEqual(['Bb3', 'Cb2']);
    return 'context menu not observable in headless Chromium';
  });
  await item('INPUT-03', async () => {
    await press(w, 'Bb2', 'white'); await w.waitForTimeout(150);
    const c = await projectCell(w, 'Cd3', 'white');
    const cam0 = await cameraInfo(w);
    await drag(w, c, 150, 0); await w.waitForTimeout(600);
    const cam1 = await cameraInfo(w);
    expect(cam1.pos).not.toEqual(cam0.pos);
    expect((await boardState(w)).selectionRings).toBe(0);
    expect(await turnText(w)).toBe('White to move');
    return 'view orbited and selection cleared (suspected bug confirmed)';
  });
  await w.reload(); await w.waitForFunction(() => !!(window as any).__r3fState);
  await expect(w.getByTestId('turn-indicator')).toHaveText('White to move');
  await item('INPUT-09', async () => {
    await press(w, 'Bc1', 'white'); await w.waitForTimeout(150);
    const dests = await highlighted(w, 'white');
    // find a destination whose raw centre projection first hits one of White's pieces
    for (const d of dests) {
      const c = await projectCell(w, d, 'white');
      const hit = await w.evaluate(({ x, y }) => {
        const st = (window as any).__r3fState.get();
        const rect = document.querySelector('canvas')!.getBoundingClientRect();
        const nx = ((x - rect.left) / st.size.width) * 2 - 1, ny = -((y - rect.top) / st.size.height) * 2 + 1;
        st.raycaster.setFromCamera({ x: nx, y: ny }, st.camera);
        for (const h of st.raycaster.intersectObjects(st.scene.children, true)) {
          for (let o = h.object; o; o = o.parent) {
            if (o.userData?.piece) return { kind: 'piece', color: o.userData.piece.color, type: o.userData.piece.type, pos: o.position.toArray() };
            if (o.userData?.cube) { if (o.userData.highlight) return { kind: 'dest' }; break; }
          }
        }
        return { kind: 'none' };
      }, c);
      if (hit.kind === 'piece' && hit.color === 'white') {
        await pressAt(w, c); await w.waitForTimeout(200);
        const s = await boardState(w);
        expect(await turnText(w)).toBe('White to move');
        expect(s.selectionRings).toBe(1);
        const now = await highlighted(w, 'white');
        expect(now).not.toEqual(dests);
        return `destination ${d} blocked by white ${hit.type}; press selected it instead`;
      }
    }
    throw new Error('no destination occluded by an own piece from the default view');
  });
  await item('INPUT-10', async () => {
    await press(w, 'Bc1', 'white'); await w.waitForTimeout(150);
    await press(w, 'Cc2', 'white');
    await expect(w.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await listText(w)).toContain('Bc1–Cc2');
  });
  await g.close();

  const g2 = await startTappedGame(browser);
  await item('INPUT-02', async () => {
    await press(g2.white, 'Ab2', 'white'); await g2.white.waitForTimeout(150);
    const d = await pixelOf(g2.white, 'Ab3', 'white');
    const cam0 = await cameraInfo(g2.white);
    await drag(g2.white, d, -200, 0); await g2.white.waitForTimeout(800);
    expect((await cameraInfo(g2.white)).pos).not.toEqual(cam0.pos);
    await expect(g2.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await listText(g2.white)).toContain('1. Ab2–Ab3');
    return 'view orbited AND move played (suspected bug confirmed)';
  });
  await item('INPUT-12', async () => {
    await press(g2.black, 'Ed4', 'black'); await g2.black.waitForTimeout(150);
    expect((await boardState(g2.black)).selectionRings).toBe(1);
    await dropConnection(g2.black, { block: true });
    await expect(g2.black.getByText('Reconnecting…')).toBeVisible();
    expect((await boardState(g2.black)).selectionRings).toBe(0);
    await press(g2.black, 'Ec4', 'black').catch(() => {});
    await g2.black.waitForTimeout(200);
    expect((await boardState(g2.black)).selectionRings).toBe(0);
    const cam0 = await cameraInfo(g2.black);
    await drag(g2.black, { x: 20, y: 400 }, 150, 0); await g2.black.waitForTimeout(500);
    expect((await cameraInfo(g2.black)).pos).not.toEqual(cam0.pos);
    await releaseConnection(g2.black);
    await expect(g2.black.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
  });
  await item('INPUT-13', async () => {
    // provoke an error banner? none reachable; check Tab order on the board screen
    await g2.black.keyboard.press('Tab');
    const f = await g2.black.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.textContent ?? ''));
    const before = await turnText(g2.black);
    for (const k of ['ArrowLeft', 'ArrowUp', 'Enter', ' ', 'Escape']) await g2.black.keyboard.press(k);
    const cam = await cameraInfo(g2.black);
    expect(await turnText(g2.black)).toBe(before);
    expect((await boardState(g2.black)).selectionRings).toBe(0);
    return `with no error showing, Tab focused ${f}; keys changed nothing; camera ${JSON.stringify(cam.pos.map((v: number) => +v.toFixed(2)))}`;
  });
  await g2.close();
});
