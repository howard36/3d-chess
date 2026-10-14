import { useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Board as EngineBoard } from '../engine';
import type { LastMoveInfo } from './Board';
import { useIntro } from './intro/clock';
import { introDone, REPLAY_AFTER } from './intro/timeline';
import { prefersReducedMotion } from './motion';

/** Like the entrance's own (IntroDirector): a stalled frame resumes the wait, not skips it. */
const MAX_STEP = 0.25;

/**
 * The position a board opened on a game under way shows while its entrance
 * plays: the one before the last move, so the move can play once the pieces
 * have formed, as it would have landed live. Null when there is nothing to
 * hold back: no entrance (or one already over), no move yet, a player who
 * asked for less motion, or once the move is played (REPLAY_AFTER seconds
 * after the entrance, on r3f's clock). A move landing meanwhile ends it.
 */
export function useEntranceReplay(
  board: EngineBoard,
  lastMove: LastMoveInfo | undefined,
): { board: EngineBoard; ply: number } | null {
  const intro = useIntro();
  const invalidate = useThree((s) => s.invalidate);
  // The move to play, fixed when the board mounts
  const [move] = useState(() =>
    lastMove && !introDone(intro.plan, intro.t) && !prefersReducedMotion()
      ? lastMove.moveCount
      : null,
  );
  const [waiting, setWaiting] = useState(move !== null);
  const after = useRef(0);
  useFrame((_, delta) => {
    // (the entrance asks for its own frames while it plays)
    if (!waiting || !introDone(intro.plan, intro.t)) return;
    after.current += Math.min(delta, MAX_STEP);
    if (after.current >= REPLAY_AFTER) setWaiting(false);
    else invalidate();
  });
  const replaying = waiting && !!lastMove && lastMove.moveCount === move;
  return useMemo(() => {
    const before =
      replaying && lastMove ? board.unapplyMove(lastMove.move, lastMove.capturedPiece) : null;
    return before && { board: before, ply: lastMove!.moveCount - 1 };
  }, [replaying, board, lastMove]);
}
