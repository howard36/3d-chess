import React from 'react';
import type { GameOver } from '../game/history';
import { MATE_HOLD_MS } from '../lib/mate';
import { onToppled } from '../three/toppled';

/** If the scene never says the king has fallen (frames stopped), the card shows anyway. */
const MATE_FALLBACK_MS = 12000;
/**
 * At a draw nothing plays out: the card follows the last move as soon as it
 * has landed and a moment more.
 */
const DRAW_WAIT_MS = 600;

/**
 * Whether the result card is up. A game that ended while the page was open
 * (`endedLive`) plays its end first: at mate, until the scene says the king
 * has struck the floor (on its own clock, so a slow device never covers the
 * fall early) and then a hold on the final board (lib/mate.ts), with a generous fallback in case frames stop; at
 * a draw, a moment. A finished game reopened shows the card at once.
 * Timed on animation frames, the clock the scene runs on.
 */
export const useEndCard = (gameOver: GameOver | null, endedLive: boolean) => {
  // The game end whose wait is over (the replay keeps the same object while
  // the record is unchanged)
  const [endShown, setEndShown] = React.useState<GameOver | null>(null);
  React.useEffect(() => {
    if (!gameOver || !endedLive) return;
    const mate = gameOver.result === 'checkmate';
    const start = performance.now();
    let fellAt: number | null = null;
    const unsubscribe = mate
      ? onToppled(() => {
          fellAt ??= performance.now();
        })
      : () => {};
    let frame = requestAnimationFrame(function tick() {
      const now = performance.now();
      const waited = mate
        ? (fellAt !== null && now - fellAt >= MATE_HOLD_MS) || now - start >= MATE_FALLBACK_MS
        : now - start >= DRAW_WAIT_MS;
      if (waited) setEndShown(gameOver);
      else frame = requestAnimationFrame(tick);
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [gameOver, endedLive]);
  return !!gameOver && (!endedLive || endShown === gameOver);
};
