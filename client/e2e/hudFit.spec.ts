import { test, expect } from '@playwright/test';
import type { Page, WebSocketRoute } from '@playwright/test';
import { towerRects } from './helpers/board';
import type { ScreenRect } from './helpers/board';

// The turn pill holds its words in every state, at every window size, from
// both seats: its content never runs past its rim. The pieces each side has
// taken fit under it, and nothing of the HUD ever covers a piece or a label
// of the tower. The game is served by a stand-in for the server (the page's
// socket is routed here), so each position arrives as a snapshot instead of
// being played out.

const CHECK = ['Ab2-De5', 'Ed4-Ba1', 'Ac2-Cc4', 'Dc4-Dc3', 'Ad2-Dd5']; // Black in check
const MATE = ['Ad1-Ac3', 'Ec4-Cc2', 'Ac2-Ad1', 'Cc2-Bb1']; // Black mates
// A long game down to the bare kings and one white rook: every kind of piece
// taken from both sides, most of them twice and all ten pawns, with White 5
// ahead (the widest the captured pieces get). One move before the end, Black
// is in check.
const STRIPPED = `
  Ae2-Db5 Ec4-Bc1 Ac2-Bc1 Ed5-Db5 Ad2-Dd5 Ec5-Dd5 Aa2-Da5 Ee4-Be1 Da5-Ea4 Eb4-Bb1 Bc1-Bb1
  Be1-Bd2 Ea4-Db4 Ed4-Ba1 Aa1-Ba1 Bd2-Ad1 Db4-Eb5 Ea5-Eb5 Ab2-De5 Ee5-De5 Ac1-Ad1 De5-Ae5
  Ae1-Ae5 Da4-Ca4 Be2-Be3 Db5-Cb3 Bb2-Cb3 Ca4-Cb3 Bd1-Bd2 Dd5-Cc5 Ad1-Be2 Dc4-Dc3 Bb1-Cb1
  Cc5-Cb5 Cb1-Cb3 Dc3-Cb3 Ba1-Bc1 Cb3-Bb3 Ab1-Bb3 Cb5-Bb5 Be2-Cd2 De4-Ce4 Be3-Ce4 Dd4-Ce4
  Ae5-Ab5 Bb5-Ac4 Ab5-Eb5 Ac4-Bd5 Cd2-De1 Bd5-Be5 Bb3-Ad3 Be5-Be4 Ad3-Bb3 Be4-Ae5 Bc1-Bb1
  Ae5-Bd5 Bc2-Cc2 Bd5-Ae4 Bb1-Bd1 Ae4-Bd5 Bb3-Cb5 Dc5-Cb5 Eb5-Cb5 Ce4-Ce3 Cb5-Bb5 Bd5-Ac5
  Bb5-Be5 Ac5-Ab4 Bd1-Ad1 Ab4-Ba3 Be5-Be2 Ce3-Be2 De1-Ee1 Ba3-Ba2 Ee1-Dd2 Ba2-Aa2 Dd2-Ee2
  Aa2-Ab3 Ad1-Ed1 Ab3-Ba4 Ee2-De2 Ba4-Aa5 De2-Ed2 Aa5-Ab4 Ed2-Dd1 Ab4-Bb5 Ed1-Eb1 Bb5-Bc4
  Dd1-Cc1 Bc4-Ad4 Cc1-Bb1 Ad4-Ad5 Bb1-Aa1 Be2-Ae2 Eb1-Ab1 Ad5-Ae4 Ab1-Ab2 Ae4-Ad3 Ab2-Ae2
  Ad3-Bd2 Ae2-Be2 Bd2-Cc2`
  .trim()
  .split(/\s+/);
const SIZES = [
  [360, 640],
  [390, 844],
  [700, 900],
  [640, 360],
  [844, 390],
  [932, 430],
  [1280, 720],
  [1920, 1080],
];

const records = (moves: string[]) =>
  moves.map((m, i) => {
    const [from, to] = m.split('-');
    return { by: i % 2 === 0 ? 'white' : 'black', from, to };
  });

/** A page seated as `seat` in a game whose record the test sets, with the Notation panel on or off. */
async function seated(page: Page, seat: 'white' | 'black', notation = false) {
  let socket: WebSocketRoute | null = null;
  let record = CHECK;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.type !== 'rejoin_game') return;
      ws.send(
        JSON.stringify({ type: 'game_state', color: seat, started: true, moves: records(record) }),
      );
      ws.send(
        JSON.stringify({
          type: 'presence',
          color: seat === 'white' ? 'black' : 'white',
          online: true,
        }),
      );
    });
  });
  await page.addInitScript(
    ([s, panel]) => {
      localStorage.setItem('3dchess:role:FITTED', s);
      localStorage.setItem('3dchess:settings', JSON.stringify({ 'play.notation': panel }));
    },
    [seat, notation] as const,
  );
  await page.goto('/game/FITTED');
  await expect(page.getByTestId('turn-indicator')).toBeVisible();
  return {
    /** Serves `moves` as the record, through a fresh snapshot. */
    show: async (moves: string[]) => {
      record = moves;
      await page.reload();
      await expect(page.getByTestId('turn-indicator')).toBeVisible();
    },
    presence: (online: boolean) =>
      socket!.send(
        JSON.stringify({ type: 'presence', color: seat === 'white' ? 'black' : 'white', online }),
      ),
  };
}

/** How far the pill's content runs past its rim, in CSS px (0 when it fits), at each size. */
async function overflowAtEverySize(page: Page) {
  const out: Record<string, number> = {};
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    out[`${width}x${height}`] = await page.getByTestId('turn-indicator').evaluate((pill) => {
      const r = pill.getBoundingClientRect();
      let worst = pill.scrollWidth - pill.clientWidth;
      for (const el of Array.from(pill.querySelectorAll('.hud-half > *'))) {
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue; // not shown at this size
        worst = Math.max(worst, b.right - r.right, r.left - b.left);
      }
      // Within the window, too
      worst = Math.max(worst, r.right - window.innerWidth, -r.left);
      return Math.max(0, Math.round(worst));
    });
  }
  return out;
}

for (const seat of ['white', 'black'] as const) {
  test(`the turn pill holds its words in every state and size, seated as ${seat}`, async ({
    page,
  }) => {
    const game = await seated(page, seat);
    const fits = (overflow: Record<string, number>) =>
      expect(Object.entries(overflow).filter(([, px]) => px > 0)).toEqual([]);

    // Check: Black's move ("CHECK Your move" for Black, "Their move CHECK" for White)
    await expect(page.getByTestId('turn-indicator')).toHaveAttribute('data-check', 'true');
    fits(await overflowAtEverySize(page));
    // ...with the opponent offline
    game.presence(false);
    await expect(page.getByTestId('turn-indicator')).toContainText('Offline');
    fits(await overflowAtEverySize(page));
    // The opening, both halves at rest
    await game.show([]);
    fits(await overflowAtEverySize(page));
    // The result
    await game.show(MATE);
    await expect(page.getByTestId('turn-indicator')).toHaveAttribute('data-result', 'checkmate');
    fits(await overflowAtEverySize(page));
  });
}

/** The HUD's rects over the board: the pill, each side's captured pieces, the gear, and the move card while shown. */
const hudRects = (page: Page) =>
  page.evaluate(() => {
    const rect = (what: string, el: Element | null) => {
      const b = el?.getBoundingClientRect();
      return b && b.width >= 1 && b.height >= 1
        ? { what, left: b.left, top: b.top, right: b.right, bottom: b.bottom }
        : null;
    };
    const card = document.querySelector('[data-testid="move-card"]:not([data-hidden])');
    return [
      rect('pill', document.querySelector('[data-testid="turn-indicator"]')),
      rect(
        'your captures',
        document.querySelector('[data-testid="captured-pieces"] [data-side="me"]'),
      ),
      rect(
        'their captures',
        document.querySelector('[data-testid="captured-pieces"] [data-side="them"]'),
      ),
      rect('gear', document.querySelector('[data-testid="settings"]')),
      rect('move card', card),
    ].filter((r) => r !== null);
  });

const meet = (a: ScreenRect, b: ScreenRect, gap = 0) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > -gap &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > -gap;

/**
 * What is wrong at this size, in words (nothing when all is well): a HUD rect
 * over a piece or label of the tower, and the captured pieces out of the
 * window, outside the pill's width where they hang under it, too close to each
 * other or on the gear.
 */
async function problemsAt(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  // The canvas takes the new size, the camera refits, the labels settle:
  // measure until two readings agree
  await page.waitForFunction(
    ([w, h]) => {
      const state = (
        window as Window & {
          __r3fState?: { get: () => { size: { width: number; height: number } } };
        }
      ).__r3fState;
      const size = state?.get().size;
      return size?.width === w && size?.height === h;
    },
    [width, height],
  );
  let last = '';
  let tower: ScreenRect[] = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    tower = await towerRects(page);
    const now = JSON.stringify(
      tower.map((r) => [r.left, r.top, r.right, r.bottom].map(Math.round)),
    );
    if (now === last) break;
    last = now;
  }
  const hud = await hudRects(page);
  const problems: string[] = [];
  for (const h of hud) {
    for (const t of tower) if (meet(h, t)) problems.push(`${h.what} covers ${t.what}`);
  }
  const pill = hud.find((r) => r.what === 'pill')!;
  const gear = hud.find((r) => r.what === 'gear')!;
  const hauls = hud.filter((r) => r.what.endsWith('captures'));
  for (const h of hauls) {
    if (h.left < 0 || h.right > width) problems.push(`${h.what} run out of the window`);
    // Under the pill, except in a short window (beside the tower, at the left)
    if (height > 480 && (h.left < pill.left - 0.5 || h.right > pill.right + 0.5)) {
      problems.push(`${h.what} run past the pill`);
    }
    if (meet(h, gear)) problems.push(`${h.what} meet the gear`);
  }
  if (hauls.length === 2 && meet(hauls[0], hauls[1], 3)) problems.push('the captures meet');
  return problems.map((p) => `${width}x${height}: ${p}`);
}

for (const seat of ['white', 'black'] as const) {
  for (const notation of [false, true]) {
    test(`the HUD never covers the tower, captured pieces and all, seated as ${seat}, Notation panel ${notation ? 'on' : 'off'}`, async ({
      page,
    }) => {
      const game = await seated(page, seat, notation);
      const everywhere = async () => {
        const problems: string[] = [];
        for (const [width, height] of SIZES)
          problems.push(...(await problemsAt(page, width, height)));
        return problems;
      };
      // Every kind of piece taken, White ahead
      await game.show(STRIPPED);
      await expect(page.getByTestId('captured-pieces')).toContainText('taken');
      expect(await everywhere()).toEqual([]);
      // ...and Black in check a move before
      await game.show(STRIPPED.slice(0, -1));
      await expect(page.getByTestId('turn-indicator')).toHaveAttribute('data-check', 'true');
      expect(await everywhere()).toEqual([]);
      // The opening: Black's army stands at the top of the tower
      await game.show([]);
      expect(await everywhere()).toEqual([]);
      // The result
      await game.show(MATE);
      await expect(page.getByTestId('turn-indicator')).toHaveAttribute('data-result', 'checkmate');
      expect(await everywhere()).toEqual([]);
    });
  }
}
