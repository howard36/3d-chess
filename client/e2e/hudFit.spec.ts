import { test, expect } from '@playwright/test';
import type { Page, WebSocketRoute } from '@playwright/test';

// The turn pill holds its words in every state, at every window size, from
// both seats: its content never runs past its rim. The game is served by a
// stand-in for the server (the page's socket is routed here), so each
// position arrives as a snapshot instead of being played out.

const CHECK = ['Ab2-De5', 'Ed4-Ba1', 'Ac2-Cc4', 'Dc4-Dc3', 'Ad2-Dd5']; // Black in check
const MATE = ['Ad1-Ac3', 'Ec4-Cc2', 'Ac2-Ad1', 'Cc2-Bb1']; // Black mates
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

/** A page seated as `seat` in a game whose record the test sets. */
async function seated(page: Page, seat: 'white' | 'black') {
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
  await page.addInitScript((s) => localStorage.setItem('3dchess:role:FITTED', s), seat);
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
