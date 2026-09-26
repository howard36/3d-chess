import { test, expect, type Page } from '@playwright/test';
import { startTappedGame, item, press, pressAt, drag, projectCell, pixelOf, boardState, cameraInfo, pieceMap, highlighted, turnText, listText, dropConnection, releaseConnection, playOn, rawSend, delayAnswersAfterOpen, settle } from './vh';
import { playLine, MATE_LINE, PROMO_LINE } from './line';

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

// --- Local helpers --------------------------------------------------------------
/** Records every frame the page sends to the game server from now until the next load. */
const logSends = (p: Page) =>
  p.evaluate(() => {
    const w = window as any;
    if (w.__sent) return;
    w.__sent = [];
    const proto = w.WebSocket.prototype;
    const orig = proto.send;
    proto.send = function (d: unknown) {
      if (String(this.url).includes('/ws')) w.__sent.push(String(d));
      return orig.call(this, d);
    };
  });
const sentMoves = (p: Page) => p.evaluate(() => ((window as any).__sent as string[]).filter((s) => JSON.parse(s).type === 'move').length);
const focusDesc = (p: Page) =>
  p.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return 'BODY';
    return `${a.tagName}${a.id ? '#' + a.id : ''}:${a.getAttribute('aria-label') ?? a.textContent?.trim() ?? ''}`;
  });
const sel = async (p: Page) => (await boardState(p)).selectionRings;
const moveField = (p: Page) => p.getByLabel('Type a move (e.g. Ab2-Ab3)');
const moveButton = (p: Page) => p.getByRole('button', { name: 'Move', exact: true });
const moveProblem = (p: Page) => p.locator('#typed-move-problem');
/** Clicks an empty background pixel well clear of the cube. */
const BG = { x: 20, y: 400 };

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
    await g.black.waitForTimeout(300);
    expect(await sel(g.black)).toBe(0);
  });
  await item('RULES-03', async () => {
    await press(g.white, 'Bb2', 'white'); await g.white.waitForTimeout(300);
    expect(await highlighted(g.white, 'white')).toEqual(['Bb3', 'Cb2']);
    await press(g.white, 'Ab2', 'white'); await g.white.waitForTimeout(300);
    expect(await highlighted(g.white, 'white')).toEqual(['Ab3']);
  });
  await item('RULES-04', async () => {
    await press(g.white, 'Ab1', 'white'); await g.white.waitForTimeout(300);
    expect(await highlighted(g.white, 'white')).toEqual(['Aa3', 'Ac3', 'Bb3', 'Ca1', 'Cb2', 'Cc1']);
  });
  await item('RULES-05', async () => {
    await press(g.white, 'Bc1', 'white'); await g.white.waitForTimeout(300);
    expect(await highlighted(g.white, 'white')).toEqual(['Cb1', 'Cb2', 'Cc1', 'Cc2', 'Cd1', 'Cd2', 'Da1', 'Da3', 'Dc1', 'Dc3', 'De1', 'De3', 'Ec1', 'Ec4']);
    expect((await boardState(g.white)).captureRings).toBe(1);
  });
  await item('RULES-06', async () => {
    await press(g.white, 'Ac1', 'white'); await g.white.waitForTimeout(300);
    const s = await boardState(g.white);
    expect(s.selectionRings).toBe(1); expect(s.highlights).toBe(0);
  });
  await item('RULES-11', async () => {
    const w = g.white;
    // What in the scene could carry a label: sprites, textured materials, text meshes, canvas textures.
    const scan = () => w.evaluate(() => {
      const { scene } = (window as any).__r3fState.get();
      const found: string[] = []; const types = new Set<string>();
      scene.traverse((o: any) => {
        types.add(o.type);
        if (o.type === 'Sprite' || /Text/i.test(o.type) || /Text/i.test(o.geometry?.type ?? '')) found.push(o.type);
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) if (m.map || m.alphaMap || m.emissiveMap) found.push(`${o.type} with texture`);
      });
      return { found, types: [...types].sort() };
    });
    const r0 = await scan();
    // Orbit the view all the way round in steps, screenshotting each.
    for (let i = 0; i < 4; i++) {
      await drag(w, BG, 250, 0); await settle(w);
      await w.screenshot({ path: `test-results/rules-11-orbit-${i}.png` });
    }
    const r1 = await scan();
    expect(r0.found).toEqual([]); expect(r1.found).toEqual([]);
    return `no sprite, text or textured object in the scene (object types: ${r1.types.join(', ')}); orbit screenshots rules-11-orbit-0..3.png`;
  });
  await g.close();

  const g2 = await startTappedGame(browser);
  await item('RULES-07', async () => {
    await playLine(g2, PROMO_LINE);
    await press(g2.white, 'Da4', 'white'); await g2.white.waitForTimeout(300);
    expect(await highlighted(g2.white, 'white')).toEqual(['Db5', 'Ea5', 'Eb4']);
    expect((await boardState(g2.white)).captureRings).toBe(3);
  });
  await item('RULES-08', async () => {
    await playOn(g2.white, 'white', 'Da4', 'Db5');
    // (the pawn on Db5 checks the King on Ec5, so the indicator adds " — in check")
    await expect(g2.white.getByTestId('turn-indicator')).toHaveText(/^Black to move/);
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
    await w.waitForTimeout(600);
    const held = await boardState(w);
    await w.mouse.up();
    await w.waitForTimeout(400);
    const after = await boardState(w);
    expect(held.selectionRings).toBe(0); expect(held.highlights).toBe(0);
    expect(after.selectionRings).toBe(1); expect(after.highlights).toBe(2);
  });
  await item('INPUT-04', async () => {
    // Bb2 still selected from INPUT-01
    expect(await sel(w)).toBe(1);
    await pressAt(w, { x: 8, y: 400 }); await w.waitForTimeout(300);
    expect(await sel(w)).toBe(1);
    expect(await highlighted(w, 'white')).toEqual(['Bb3', 'Cb2']);
  });
  await item('INPUT-06', async () => {
    const c = await projectCell(w, 'Cc3', 'white');
    const d0 = (await cameraInfo(w)).dist!;
    await w.mouse.move(c.x, c.y); await w.mouse.wheel(0, -300); await w.waitForTimeout(800);
    const d1 = (await cameraInfo(w)).dist!;
    await w.mouse.wheel(0, 300); await w.waitForTimeout(800); await settle(w);
    const d2 = (await cameraInfo(w)).dist!;
    expect(Math.abs(d1 - d0)).toBeGreaterThan(0.1);
    expect(Math.abs(d2 - d1)).toBeGreaterThan(0.1);
    expect(await sel(w)).toBe(1);
    expect(await highlighted(w, 'white')).toEqual(['Bb3', 'Cb2']);
    return `distance ${d0.toFixed(2)} -> ${d1.toFixed(2)} -> ${d2.toFixed(2)}; Bb2 still selected`;
  });
  await item('INPUT-07', async () => {
    await press(w, 'Ed4', 'white'); await w.waitForTimeout(300);
    expect(await sel(w)).toBe(0);
  });
  await item('INPUT-08', async () => {
    await press(w, 'Bb2', 'white'); await w.waitForTimeout(300);
    expect(await highlighted(w, 'white')).toEqual(['Bb3', 'Cb2']);
    await press(w, 'Bc2', 'white'); await w.waitForTimeout(300);
    expect(await sel(w)).toBe(1);
    expect(await highlighted(w, 'white')).toEqual(['Bc3', 'Cc2']);
  });
  await item('INPUT-05', async () => {
    await press(w, 'Ed4', 'white'); await w.waitForTimeout(300); // clear
    expect(await sel(w)).toBe(0);
    await w.evaluate(() => { (window as any).__ctx = []; window.addEventListener('contextmenu', (e) => (window as any).__ctx.push(e.defaultPrevented)); });
    await press(w, 'Bb2', 'white', 'right'); await w.waitForTimeout(400);
    const r = await sel(w);
    await press(w, 'Bb2', 'white', 'middle'); await w.waitForTimeout(400);
    const m = await sel(w);
    const ctx: boolean[] = await w.evaluate(() => (window as any).__ctx);
    await press(w, 'Bb2', 'white'); await w.waitForTimeout(400);
    const l = await sel(w);
    expect(r).toBe(0); expect(m).toBe(0);
    expect(ctx.every((x) => x)).toBe(true);
    expect(l).toBe(1);
    expect(await highlighted(w, 'white')).toEqual(['Bb3', 'Cb2']);
    return `right and middle click selected nothing; contextmenu events ${JSON.stringify(ctx)} (true = default prevented, so no menu); left click selected Bb2`;
  });
  await item('INPUT-03', async () => {
    await press(w, 'Bc1', 'white'); await w.waitForTimeout(300);
    const dests = await highlighted(w, 'white');
    expect(dests.length).toBe(14);
    const c = await projectCell(w, 'Cc3', 'white');
    const cam0 = await cameraInfo(w);
    await drag(w, c, 150, 0); await settle(w);
    const cam1 = await cameraInfo(w);
    expect(cam1.pos).not.toEqual(cam0.pos);
    expect(await sel(w)).toBe(1);
    expect(await highlighted(w, 'white')).toEqual(dests);
    expect(await turnText(w)).toBe('White to move');
    return 'view orbited; Queen still selected with its 14 destinations';
  });
  await w.reload(); await w.waitForFunction(() => !!(window as any).__r3fState);
  await expect(w.getByTestId('turn-indicator')).toHaveText('White to move');
  await w.waitForTimeout(500);
  await item('INPUT-09', async () => {
    await logSends(w);
    await press(w, 'Bc1', 'white'); await w.waitForTimeout(300);
    const dests = await highlighted(w, 'white');
    // find a destination whose raw centre projection first hits one of White's pieces
    for (const d of dests) {
      const c = await projectCell(w, d, 'white');
      const hit = await w.evaluate(({ x, y }) => {
        const st = (window as any).__r3fState.get();
        const rect = document.querySelector('canvas')!.getBoundingClientRect();
        if (document.elementFromPoint(x, y) !== document.querySelector('canvas')) return { kind: 'hud' };
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
        await pressAt(w, c); await w.waitForTimeout(400);
        const s = await boardState(w);
        expect(await turnText(w)).toBe('White to move');
        expect(await sentMoves(w)).toBe(0);
        expect(s.selectionRings).toBe(1);
        const now = await highlighted(w, 'white');
        expect(now).not.toEqual(dests);
        return `destination ${d} blocked by white ${hit.type}; press selected it instead, no move sent`;
      }
    }
    throw new Error('no destination occluded by an own piece from the default view');
  });
  await item('INPUT-10', async () => {
    await press(w, 'Bc1', 'white'); await w.waitForTimeout(300);
    await press(w, 'Cc2', 'white');
    await expect(w.getByTestId('turn-indicator')).toHaveText('Black to move');
    expect(await listText(w)).toContain('Bc1–Cc2');
  });
  await g.close();
});

test('input drags and connection', async ({ browser }) => {
  const g2 = await startTappedGame(browser);
  await item('INPUT-02', async () => {
    const p = g2.white;
    await press(p, 'Ab2', 'white'); await p.waitForTimeout(300);
    expect(await highlighted(p, 'white')).toEqual(['Ab3']);
    const d = await pixelOf(p, 'Ab3', 'white');
    const cam0 = await cameraInfo(p);
    await drag(p, d, -200, 0); await settle(p);
    expect((await cameraInfo(p)).pos).not.toEqual(cam0.pos);
    await p.waitForTimeout(500);
    expect(await turnText(p)).toBe('White to move');
    expect(await p.getByTestId('move-list').count()).toBe(0);
    expect(await sel(p)).toBe(1);
    expect(await highlighted(p, 'white')).toEqual(['Ab3']);
    return 'view orbited; no move played; Ab2 still selected with Ab3';
  });
  await g2.white.reload(); await g2.white.waitForFunction(() => !!(window as any).__r3fState);
  await expect(g2.white.getByTestId('turn-indicator')).toHaveText('White to move');
  await g2.white.waitForTimeout(500);
  await item('INPUT-15', async () => {
    const p = g2.white;
    expect(await sel(p)).toBe(0);
    const a = await pixelOf(p, 'Bb2', 'white');
    await drag(p, a, 4, 0); await settle(p);
    const s1 = await sel(p);
    const h1 = await highlighted(p, 'white');
    await press(p, 'Ed4', 'white'); await p.waitForTimeout(300); // clear
    expect(await sel(p)).toBe(0);
    const b = await pixelOf(p, 'Bb2', 'white');
    const cam0 = await cameraInfo(p);
    await drag(p, b, 12, 0); await settle(p);
    const cam1 = await cameraInfo(p);
    const s2 = await sel(p);
    expect(s1).toBe(1); expect(h1).toEqual(['Bb3', 'Cb2']);
    expect(s2).toBe(0);
    const turned = Math.hypot(...cam1.pos.map((v: number, i: number) => v - cam0.pos[i]));
    expect(turned).toBeGreaterThan(0.01);
    return `4 px drag selected Bb2; 12 px drag selected nothing and moved the camera ${turned.toFixed(2)} units`;
  });
  await g2.white.reload(); await g2.white.waitForFunction(() => !!(window as any).__r3fState);
  await expect(g2.white.getByTestId('turn-indicator')).toHaveText('White to move');
  await g2.white.waitForTimeout(500);
  await item('INPUT-16', async () => {
    const p = g2.white;
    await logSends(p);
    await press(p, 'Ab2', 'white'); await p.waitForTimeout(300);
    expect(await highlighted(p, 'white')).toEqual(['Ab3']);
    const d = await pixelOf(p, 'Ab3', 'white');
    const cam0 = await cameraInfo(p);
    await drag(p, d, 150, 0, 'right'); await settle(p);
    const cam1 = await cameraInfo(p);
    const panned = Math.hypot(...cam1.target.map((v: number, i: number) => v - cam0.target[i]));
    expect(panned).toBeGreaterThan(0.3);
    await p.waitForTimeout(500);
    expect(await turnText(p)).toBe('White to move');
    expect(await sentMoves(p)).toBe(0);
    expect(await sel(p)).toBe(1);
    expect(await highlighted(p, 'white')).toEqual(['Ab3']);
    return `target panned ${panned.toFixed(2)} units; no move sent; Ab2 still selected`;
  });
  await g2.white.reload(); await g2.white.waitForFunction(() => !!(window as any).__r3fState);
  await expect(g2.white.getByTestId('turn-indicator')).toHaveText('White to move');
  await g2.white.waitForTimeout(500);
  await item('INPUT-12', async () => {
    const p = g2.white;
    await press(p, 'Bb2', 'white'); await p.waitForTimeout(300);
    expect(await sel(p)).toBe(1);
    await dropConnection(p, { block: true });
    await expect(p.getByText('Reconnecting…')).toBeVisible();
    await p.waitForTimeout(300);
    expect(await sel(p)).toBe(0);
    await press(p, 'Bc2', 'white');
    await p.waitForTimeout(300);
    expect(await sel(p)).toBe(0);
    const cam0 = await cameraInfo(p);
    await drag(p, BG, 150, 0); await settle(p);
    expect((await cameraInfo(p)).pos).not.toEqual(cam0.pos);
    await releaseConnection(p);
    await expect(p.getByText('Reconnecting…')).toHaveCount(0, { timeout: 20000 });
    await p.waitForTimeout(500);
    await press(p, 'Bc2', 'white'); await p.waitForTimeout(300);
    expect(await sel(p)).toBe(1);
    expect(await highlighted(p, 'white')).toEqual(['Bc3', 'Cc2']);
  });
  await g2.close();
});

test('input move box and dialogs', async ({ browser }) => {
  // Move box
  const g3 = await startTappedGame(browser);
  await item('INPUT-17', async () => {
    const p = g3.white;
    await p.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let f = '';
    for (let i = 0; i < 6 && f !== 'INPUT#typed-move:'; i++) { await p.keyboard.press('Tab'); f = await focusDesc(p); }
    expect(f).toBe('INPUT#typed-move:');
    await p.keyboard.type('ab2 ab3');
    const seen = { w: 0, b: 0 };
    const watch = (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 6000) {
        const [sw, sb] = await Promise.all([boardState(g3.white), boardState(g3.black)]);
        seen.w = Math.max(seen.w, sw.glides); seen.b = Math.max(seen.b, sb.glides);
        if (seen.w && seen.b) break;
        await p.waitForTimeout(20);
      }
    })();
    await p.keyboard.press('Enter');
    await watch;
    await expect(moveField(p)).toHaveValue('');
    await expect(g3.white.getByTestId('turn-indicator')).toHaveText('Black to move');
    await expect(g3.black.getByTestId('turn-indicator')).toHaveText('Black to move');
    await expect(g3.white.getByTestId('move-list')).toHaveText('1. Ab2–Ab3');
    await expect(g3.black.getByTestId('move-list')).toHaveText('1. Ab2–Ab3');
    expect(seen.w).toBe(1); expect(seen.b).toBe(1);
    expect((await pieceMap(g3.black, 'black'))['Ab3']).toBe('white Pawn');
    return 'field emptied; glide seen on both pages; "1. Ab2–Ab3" on both';
  });
  await g3.close();

  const g4 = await startTappedGame(browser);
  await item('INPUT-18', async () => {
    const p = g4.white;
    await logSends(p);
    const out: string[] = [];
    for (const [typed, want] of [['Ab2-Ab5', 'The piece on Ab2 cannot move to Ab5.'], ['Ed4-Ed3', 'You have no piece on Ed4.'], ['hello', 'Type a move as two cells, like Ab2-Ab3.']]) {
      await moveField(p).fill(typed);
      await moveField(p).press('Enter');
      await expect(moveProblem(p)).toHaveText(want);
      await expect(moveField(p)).toHaveValue(typed);
      await expect(moveField(p)).toHaveAttribute('aria-invalid', 'true');
      out.push(`${typed}: "${want}"`);
    }
    await p.waitForTimeout(500);
    expect(await sentMoves(p)).toBe(0);
    expect(await turnText(g4.white)).toBe('White to move');
    expect(await turnText(g4.black)).toBe('White to move');
    return out.join('; ');
  });
  await item('INPUT-19', async () => {
    // As written: White to move, typed on Black's page
    const p = g4.black;
    await logSends(p);
    await moveField(p).fill('Ed4-Ed3');
    const disabled = await moveButton(p).isDisabled();
    await moveField(p).press('Enter');
    await p.waitForTimeout(800);
    expect(disabled).toBe(true);
    await expect(moveField(p)).toHaveValue('Ed4-Ed3');
    expect(await sentMoves(p)).toBe(0);
    expect(await turnText(g4.white)).toBe('White to move');
    return 'Move button disabled; Enter did nothing; text kept; no move frame sent';
  });
  await g4.close();

  const g5 = await startTappedGame(browser);
  await item('INPUT-20', async () => {
    const p = g5.white;
    await playLine(g5, PROMO_LINE);
    await logSends(p);
    await press(p, 'Da4', 'white');
    await expect.poll(() => highlighted(p, 'white')).toContain('Ea5');
    await press(p, 'Ea5', 'white');
    const dlg = p.getByRole('dialog', { name: 'Promote to' });
    await expect(dlg).toBeVisible();
    await p.waitForTimeout(300);
    const first = await focusDesc(p);
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      await p.keyboard.press('Tab');
      seen.push(await p.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body) return 'BODY';
        const inDlg = !!a.closest('[role="dialog"]');
        return `${inDlg ? 'dialog' : 'OUTSIDE'}:${a.tagName}:${a.id || a.textContent?.trim()}`;
      }));
    }
    await p.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await p.waitForTimeout(500);
    expect(first).toBe('BUTTON:Queen');
    expect(seen.filter((s) => s.startsWith('OUTSIDE'))).toEqual([]);
    expect(await sentMoves(p)).toBe(0);
    expect(await turnText(p)).toBe('White to move');
    return `focus on open: Queen; Tab cycle: ${[...new Set(seen)].join(', ')}; Escape closed it, nothing sent`;
  });
  await g5.close();

  const g6 = await startTappedGame(browser);
  await item('INPUT-21', async () => {
    const p = g6.white;
    await delayAnswersAfterOpen(p, 8000);
    await dropConnection(p);
    await expect(p.getByText('Reconnecting…')).toBeVisible();
    await expect(p.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15000 });
    const t0 = Date.now();
    await delayAnswersAfterOpen(p, 0);
    await press(p, 'Bb2', 'white'); await p.waitForTimeout(300);
    const s1 = await sel(p);
    await moveField(p).fill('Ab2-Ab3');
    const disabled = await moveButton(p).isDisabled();
    const elapsed = Date.now() - t0;
    // Wait for the held answers to be delivered
    await p.waitForTimeout(Math.max(0, 8500 - elapsed));
    await expect(moveButton(p)).toBeEnabled();
    await press(p, 'Bb2', 'white'); await p.waitForTimeout(300);
    const s2 = await sel(p);
    expect(elapsed).toBeLessThan(7000);
    expect(s1).toBe(0); expect(disabled).toBe(true);
    expect(s2).toBe(1);
    return `while the rejoin answer was held (${elapsed} ms into an 8 s hold): nothing selected, Move disabled; after: Bb2 selected`;
  });
  await g6.close();
});

test('input keyboard', async ({ browser }) => {
  const g7 = await startTappedGame(browser);
  await item('INPUT-13', async () => {
    const p = g7.black;
    // An error on Black's page: a move out of turn, sent as a modified client would.
    await rawSend(p, { type: 'move', from: 'Ed4', to: 'Ed3' });
    await expect(p.getByRole('alert')).toContainText('Error:');
    const banner = (await p.getByRole('alert').textContent()) ?? '';
    await p.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) { await p.keyboard.press('Tab'); seen.push(await focusDesc(p)); }
    const reached = [...new Set(seen)];
    await pressAt(p, BG); await p.waitForTimeout(300); const cam0 = await cameraInfo(p); const turn0 = await turnText(p); const list0 = await listText(p);
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'Escape']) { await p.keyboard.press(k); await p.waitForTimeout(100); }
    await p.waitForTimeout(500);
    const cam1 = await cameraInfo(p);
    expect(cam1.pos).toEqual(cam0.pos);
    expect(await turnText(p)).toBe(turn0);
    expect(await listText(p)).toBe(list0);
    expect(await sel(p)).toBe(0);
    expect(await moveButton(p).isDisabled()).toBe(true);
    const allowed = new Set(['INPUT#typed-move:', 'BUTTON:Dismiss error', 'BODY']);
    expect(reached.filter((r) => !allowed.has(r))).toEqual([]);
    expect(reached).toContain('INPUT#typed-move:');
    expect(reached).toContain('BUTTON:Dismiss error');
    return `banner "${banner.trim()}"; Tab cycle: ${seen.join(' -> ')}; keys changed nothing`;
  });
  await g7.close();
});
