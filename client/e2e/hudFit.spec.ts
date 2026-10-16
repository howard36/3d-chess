import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { towerRects, waitForIntro } from './helpers/board';
import { closeResult } from './helpers/game';
import type { ScreenRect } from './helpers/board';
import { openStandInGame } from './helpers/standIn';

// The turn pill holds its words in every state, at every window size, from
// both seats: its content never runs past its rim. The pieces each side has
// taken fit under it, and nothing of the HUD ever covers a piece or a label
// of the tower. The game is served by a stand-in for the server (the page's
// socket is routed here), so each position arrives as a snapshot instead of
// being played out.

const CHECK = ['Ab2-De5', 'Ed4-Ba1', 'Ac2-Cc4', 'Dc4-Dc3', 'Ad2-Dd5']; // Black in check
const MATE = ['Ad1-Ac3', 'Ec4-Cc2', 'Ac2-Ad1', 'Cc2-Bb1']; // Black mates
// A long game down to the bare kings and one white rook: every kind of piece
// taken from both sides, most of them twice and all ten pawns, with White 2.5
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
// The HUD's layout, not the game's entrance: each position is a reload, and
// in full motion every reload plays the short entrance, which in software on
// a busy runner took the test past its time. The HUD settles the same.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

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

/** A page seated as `seat` in a game whose record the test sets. */
async function seated(page: Page, seat: 'white' | 'black') {
  const game = await openStandInGame(page, seat, 'FITTED', CHECK);
  await expect(page.getByTestId('turn-indicator')).toBeVisible();
  await waitForIntro(page);
  return {
    /** Serves `moves` as the record, through a fresh snapshot. */
    show: async (moves: string[]) => {
      game.setMoves(moves);
      await page.reload();
      await expect(page.getByTestId('turn-indicator')).toBeVisible();
      await waitForIntro(page);
    },
    presence: game.presence,
    offerDraw: game.offerDraw,
    requestTakeback: game.requestTakeback,
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

/**
 * The HUD's rects over the board: the pill, each side's captured pieces, the
 * way to the tutorial, the flag for resigning and draws and the arrow for
 * taking a move back, with the opponent's draw offer and take-back request
 * under them when they stand, and the move history. In the review (the
 * result card put away) the pill and the captured pieces are only in the
 * page for a screen reader, and the way to the tutorial is gone.
 */
const hudRects = (page: Page) =>
  page.evaluate(() => {
    const rect = (what: string, el: Element | null) => {
      if (el?.closest('.sr-only')) return null;
      const b = el?.getBoundingClientRect();
      return b && b.width >= 1 && b.height >= 1
        ? { what, left: b.left, top: b.top, right: b.right, bottom: b.bottom }
        : null;
    };
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
      rect('how to play', document.querySelector('.hud-learn')),
      rect('home', document.querySelector('.hud-home')),
      // In sight once the game is over (while it is on, only in the page for a screen reader)
      rect(
        'move history',
        document.querySelector('[data-testid="move-history"]:not([data-hidden])'),
      ),
      rect('game menu', document.querySelector('.hud-game-menu')),
      rect('take back', document.querySelector('[data-testid="take-back"]')),
      rect('draw offer', document.querySelector('[data-testid="draw-offer"]')),
      rect('take-back request', document.querySelector('[data-testid="takeback-offer"]')),
    ].filter((r) => r !== null);
  });

const meet = (a: ScreenRect, b: ScreenRect, gap = 0) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > -gap &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > -gap;

/**
 * What is wrong at this size, in words (nothing when all is well): a HUD rect
 * over a piece or label of the tower, the captured pieces out of the window,
 * outside the pill's width where they hang under it, or too close to each
 * other, and the way home or to the tutorial missing, out of the window or
 * meeting the rest of the HUD.
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
  // Measured at all: a tower drawn where towerRects cannot see it (no piece's
  // meshes in its group, no label sprites) would pass with nothing to cover
  if (!tower.some((t) => t.what !== 'label')) problems.push('no piece measured');
  if (!tower.some((t) => t.what === 'label')) problems.push('no label measured');
  for (const h of hud) {
    for (const t of tower) if (meet(h, t)) problems.push(`${h.what} covers ${t.what}`);
  }
  const review = await page.locator('[data-testid="move-history"][data-ended]').count();
  // Measured at all while the game is on (a pill hidden from sight would
  // pass with nothing to cover); a finished game's steps may take its place
  const pill = hud.find((r) => r.what === 'pill');
  if (!pill && !review) problems.push('no pill measured');
  const hauls = hud.filter((r) => r.what.endsWith('captures'));
  for (const h of hauls) {
    if (h.left < 0 || h.right > width) problems.push(`${h.what} run out of the window`);
    // Under the pill, except in a short window (beside the tower, at the left)
    if (pill && height > 480 && (h.left < pill.left - 0.5 || h.right > pill.right + 0.5)) {
      problems.push(`${h.what} run past the pill`);
    }
  }
  if (hauls.length === 2 && meet(hauls[0], hauls[1], 3)) problems.push('the captures meet');
  // The ways home and to the tutorial (but in the review) stand clear of the
  // rest of the HUD, and in the window
  const corners = (review ? ['home'] : ['home', 'how to play']).map((what) => {
    const corner = hud.find((r) => r.what === what);
    if (!corner) problems.push(`no ${what}`);
    else {
      if (corner.left < 0 || corner.right > width) problems.push(`${what} runs out of the window`);
      for (const h of hud)
        if (h !== corner && meet(corner, h, 4)) problems.push(`${what} meets the ${h.what}`);
    }
    return corner;
  });
  // The move history (once a move is played), in the window and clear of the rest of the HUD
  const moves = hud.find((r) => r.what === 'move history');
  if (moves) {
    if (moves.left < 0 || moves.right > width || moves.top < 0 || moves.bottom > height) {
      problems.push('the move history runs out of the window');
    }
    for (const h of hud)
      if (h !== moves && !corners.includes(h) && meet(moves, h, 4)) {
        problems.push(`the move history meets the ${h.what}`);
      }
  }
  // Every move in the record whole: a long one takes the room it needs
  // (Black's under it), never cut off at its column's edge
  const { open, shown, cut } = await page.evaluate(() => {
    const seen = (el: Element) => el.getClientRects().length > 0;
    const all = [...document.querySelectorAll('.hud-moves:not(.sr-only)')];
    const words = [...document.querySelectorAll('.hud-moves:not(.sr-only) .hud-ply-word')].filter(
      seen,
    );
    return {
      open: all.filter(seen).length,
      shown: words.length,
      cut: words
        .filter((word) => word.scrollWidth > word.clientWidth + 0.5)
        .map((word) => word.textContent),
    };
  });
  // Measured at all: a record on screen whose moves this cannot see (a
  // renamed class, another wrapper) would pass with nothing to cut
  if (open && !shown) problems.push('no move measured in the record');
  for (const move of cut) problems.push(`the record cuts off ${move}`);
  return problems.map((p) => `${width}x${height}: ${p}`);
}

for (const seat of ['white', 'black'] as const) {
  test(`the HUD never covers the tower, captured pieces and all, seated as ${seat}`, async ({
    page,
  }) => {
    const game = await seated(page, seat);
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
    // The opening: Black's army stands at the top of the tower; the
    // opponent offers a draw, which hangs under the flag
    await game.show([]);
    game.offerDraw();
    await expect(page.getByTestId('draw-offer')).toBeVisible();
    expect(await everywhere()).toEqual([]);
    // A game under way, the opponent's offer hanging under the flag
    await game.show(CHECK);
    game.offerDraw();
    await expect(page.getByTestId('draw-offer')).toBeVisible();
    expect(await everywhere()).toEqual([]);
    // ...and their request to take a move back too: one at a time, the
    // take-back first (the window has room for one under the flag)
    game.requestTakeback();
    await expect(page.getByTestId('takeback-offer')).toBeVisible();
    await expect(page.getByTestId('draw-offer')).toHaveCount(0);
    expect(await everywhere()).toEqual([]);
    // The result, the move history in sight behind its card
    await game.show(MATE);
    await expect(page.getByTestId('turn-indicator')).toHaveAttribute('data-result', 'checkmate');
    await expect(page.getByTestId('move-history')).not.toHaveAttribute('data-hidden');
    expect(await everywhere()).toEqual([]);
    // ...and the card put away, the player looking back at the opening (the
    // steps in the pill's place in a narrow window)
    await closeResult(page);
    await page.keyboard.press('Home');
    await expect(page.getByTestId('move-history')).toHaveAttribute('data-viewing-ply', '0');
    expect(await everywhere()).toEqual([]);
    // ...and the game reviewed (the step back began it), the player on a
    // marked move: each side's marks at the top of the list, the better move
    // under it (beside the tower), the mark beside the move shown (under it)
    await expect(page.getByTestId('move-history')).toHaveAttribute('data-analysis', 'done', {
      timeout: 30_000,
    });
    await page.locator('[data-ply="3"]').click();
    await expect(page.getByTestId('move-history')).toHaveAttribute('data-best', /-/);
    expect(await everywhere()).toEqual([]);
  });
}

// A touch screen (pointer: coarse) makes the steps through the history (in
// sight once the game is over) a fingertip wide: they stay inside their panel
// and the window at every size, looking back too
test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('the steps through the history stay inside their panel and the window', async ({ page }) => {
    const game = await seated(page, 'white');
    await game.show(MATE);
    await closeResult(page);
    const outside = async () => {
      const out: string[] = [];
      for (const [width, height] of SIZES) {
        await page.setViewportSize({ width, height });
        out.push(
          ...(await page.getByTestId('move-history').evaluate((nav, size) => {
            const panel = nav.getBoundingClientRect();
            return Array.from(nav.querySelectorAll<HTMLElement>('.hud-steps button'))
              .map((b) => [b.dataset.step ?? 'now', b.getBoundingClientRect()] as const)
              .filter(([, r]) => r.width > 0)
              .filter(
                ([, r]) =>
                  r.left < Math.max(0, panel.left) - 0.5 ||
                  r.right > Math.min(window.innerWidth, panel.right) + 0.5,
              )
              .map(([step]) => `${size}: ${step}`);
          }, `${width}x${height}`)),
        );
      }
      return out;
    };
    expect(await outside()).toEqual([]);
    await page.keyboard.press('Home');
    await expect(page.getByTestId('move-history')).toHaveAttribute('data-viewing-ply', '0');
    expect(await outside()).toEqual([]);
  });
});
