import React from 'react';
import type { GameHistory } from '../game/history';
import { reviewLine } from '../game/review';
import type { Position, ReviewLine } from '../game/review';

export interface Review {
  /** The position the board shows: the live one, or the earlier one stepped back to. */
  position: Position;
  /** The board shows an earlier position than the live one. */
  reviewing: boolean;
  /** Shows the position after `ply` moves; the live ply (or past it) is the live position. */
  show: (ply: number) => void;
}

/**
 * Where the player stands in the game's record: at the live position, which
 * follows every move as it lands, or at an earlier one they stepped back to
 * (only once the game is over: the history takes no step before). The
 * positions are replayed (game/review.ts) only while the player looks back,
 * so a move landing at the live position costs nothing here.
 */
export function useReview(history: GameHistory): Review {
  const live = history.appliedMoveCount;
  // The ply looked at (null: the live position)
  const [view, setView] = React.useState<number | null>(null);
  const reviewing = view !== null && view < live;
  const liveRef = React.useRef(live);
  liveRef.current = live;
  // A record replaced by a shorter one (never in play) leaves nothing to look back to
  React.useEffect(() => {
    if (view !== null && view >= live) setView(null);
  }, [view, live]);

  const lineRef = React.useRef<ReviewLine | null>(null);
  const line = React.useMemo(() => {
    if (!reviewing) return null;
    lineRef.current = reviewLine(history, lineRef.current);
    return lineRef.current;
  }, [reviewing, history]);

  const livePosition = React.useMemo<Position>(
    () => ({
      ply: live,
      board: history.board,
      currentTurn: history.currentTurn,
      lastMove: history.lastMove,
      captured: history.captured,
    }),
    [live, history.board, history.currentTurn, history.lastMove, history.captured],
  );

  const show = React.useCallback((ply: number) => {
    setView(ply >= liveRef.current ? null : Math.max(0, ply));
  }, []);

  return {
    position: line && view !== null ? line.positions[view] : livePosition,
    reviewing,
    show,
  };
}
