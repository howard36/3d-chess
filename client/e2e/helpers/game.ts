import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { clickSquare, getPlayerColor, waitForBoard, waitForDestination } from './board';
import type { Orientation } from './board';

/**
 * A two-player game with both seats taken, ready to play. `white` and `black`
 * are the pages holding each seat; which of the two browser contexts got
 * which colour is random and already resolved for you.
 */
export interface Game {
  white: Page;
  black: Page;
  /** Whose turn it is, read from the turn indicator (while the game is on). */
  turn(): Promise<Orientation>;
  /**
   * Plays one move for the side to move: selects `from`, waits for `to` to
   * light up as a legal destination, clicks it, then waits until both
   * clients show the turn flipping (or the result, for a move that ends the
   * game) — i.e. the move round-tripped through the server. Throws if `to`
   * never becomes legal (illegal move, wrong piece).
   */
  play(from: string, to: string): Promise<void>;
  /** Plays several moves in order; each is `'Bb1-Cb1'` or `['Bb1', 'Cb1']`. */
  playAll(moves: Array<string | [string, string]>): Promise<void>;
  /** Screenshots the board as seen by `seat` into client/test-results/. */
  screenshot(name: string, seat?: Orientation): Promise<string>;
  close(): Promise<void>;
}

/**
 * Creates a game from one browser context and joins it from a second, then
 * waits for both boards to mount and their openings to play out. Two *contexts* rather than two tabs: the
 * seat is persisted in localStorage per game id, so tabs sharing a context
 * would both rejoin the same seat.
 *
 * The pages ask for reduced motion unless `motion: 'full'`: the lobby and the
 * game's entrance play as short fades and moves land at once. Played in full,
 * on two software-rendered pages, the way in alone takes most of a minute on a
 * busy CI runner, which left the tests that play on after it short of their
 * time. `createGame.spec.ts` walks the way in with full motion.
 */
export async function startGame(
  browser: Browser,
  {
    side = 'White',
    motion = 'reduced',
  }: { side?: 'White' | 'Black' | 'Random'; motion?: 'reduced' | 'full' } = {},
): Promise<Game> {
  const reducedMotion = motion === 'reduced' ? 'reduce' : 'no-preference';
  const contexts: BrowserContext[] = [
    await browser.newContext({ reducedMotion }),
    await browser.newContext({ reducedMotion }),
  ];
  const [pageA, pageB] = await Promise.all(contexts.map((c) => c.newPage()));

  // The creator picks a side (White by default: the fastest pick to play out)
  // and lands on the invitation; the guest opens its link and takes the seat
  await pageA.goto('/');
  await pageA.getByRole('button', { name: 'Play a friend' }).click();
  await pageA.getByRole('button', { name: new RegExp(`^${side}`) }).click();
  await pageA.waitForURL(/\/game\/[A-Z0-9]+/);
  await pageB.goto(pageA.url());
  await pageB.getByRole('button', { name: 'Join game' }).click();

  await waitForBoard(pageA);
  await waitForBoard(pageB);

  const seats = {} as Record<Orientation, Page>;
  for (const page of [pageA, pageB]) {
    seats[await getPlayerColor(page)] = page;
  }
  if (!seats.white || !seats.black) {
    throw new Error(
      'Both pages report the same seat — were two tabs used instead of two contexts?',
    );
  }

  const game: Game = {
    white: seats.white,
    black: seats.black,
    turn: async () => {
      const turn = await seats.white
        .locator('[data-testid="turn-indicator"][data-turn]')
        .getAttribute('data-turn');
      return turn === 'white' ? 'white' : 'black';
    },
    play: async (from, to) => {
      const seat = await game.turn();
      const page = seats[seat];
      await clickSquare(page, from, seat);
      await waitForDestination(page, to);
      await clickSquare(page, to, seat);
      // The turn chip names the other side, or gives the result if this
      // move ended the game
      const next = seat === 'white' ? 'black' : 'white';
      const passed = `[data-testid="turn-indicator"]:is([data-turn="${next}"], [data-result])`;
      await expect(seats.white.locator(passed)).toBeVisible();
      await expect(seats.black.locator(passed)).toBeVisible();
      // ...and both were told of this very move (the screen reader's announcement)
      for (const page of [seats.white, seats.black]) {
        await expect(page.getByTestId('move-announcer')).toHaveAttribute(
          'data-last-move',
          new RegExp(`^${from}-${to}(=[QRBNU])?$`),
        );
      }
    },
    playAll: async (moves) => {
      for (const m of moves) {
        const [from, to] = typeof m === 'string' ? m.split('-') : m;
        await game.play(from, to);
      }
    },
    screenshot: async (name, seat = 'white') => {
      const path = `test-results/${name}.png`;
      await seats[seat].screenshot({ path });
      return path;
    },
    close: async () => {
      await Promise.all(contexts.map((c) => c.close()));
    },
  };
  return game;
}
