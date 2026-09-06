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
  /** The page seated as `seat`. */
  page(seat: Orientation): Page;
  /** Whose turn it is, read from the turn indicator. */
  turn(): Promise<Orientation>;
  /**
   * Plays one move for the side to move: selects `from`, waits for `to` to
   * light up as a legal destination, clicks it, then waits until both
   * clients show the turn flipping — i.e. the move round-tripped through the
   * server. Throws if `to` never becomes legal (illegal move, wrong piece).
   */
  play(from: string, to: string): Promise<void>;
  /** Plays several moves in order; each is `'Ab2-Ab3'` or `['Ab2', 'Ab3']`. */
  playAll(moves: Array<string | [string, string]>): Promise<void>;
  /** Screenshots the board as seen by `seat` into client/test-results/. */
  screenshot(name: string, seat?: Orientation): Promise<string>;
  close(): Promise<void>;
}

/**
 * Creates a game from one browser context and joins it from a second, then
 * waits for both boards to mount. Two *contexts* rather than two tabs: the
 * seat is persisted in localStorage per game id, so tabs sharing a context
 * would both rejoin the same seat.
 */
export async function startGame(browser: Browser): Promise<Game> {
  const contexts: BrowserContext[] = [await browser.newContext(), await browser.newContext()];
  const [pageA, pageB] = await Promise.all(contexts.map((c) => c.newPage()));

  await pageA.goto('/');
  await pageA.getByRole('button', { name: 'Start New Game' }).click();
  await pageA.waitForURL(/\/game\/[A-Z0-9]+/);
  await pageB.goto(pageA.url());
  await pageB.getByRole('button', { name: 'Join Game' }).click();

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
    page: (seat) => seats[seat],
    turn: async () => {
      const text = await seats.white.locator('text=/(White|Black) to move/').textContent();
      return text?.startsWith('White') ? 'white' : 'black';
    },
    play: async (from, to) => {
      const seat = await game.turn();
      const page = seats[seat];
      await clickSquare(page, from, seat);
      await waitForDestination(page, to, seat);
      await clickSquare(page, to, seat);
      const next = seat === 'white' ? 'Black to move' : 'White to move';
      await expect(seats.white.getByText(next)).toBeVisible();
      await expect(seats.black.getByText(next)).toBeVisible();
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
