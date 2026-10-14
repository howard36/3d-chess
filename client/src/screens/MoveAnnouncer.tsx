import React from 'react';
import { announceLastMove, describeTurn } from '../game/announce';
import type { GameHistory, Turn } from '../game/history';

/**
 * Says each move as it lands, for screen readers, whatever the HUD shows:
 * "White bishop Ad2 takes pawn on Dd5. Check. Your move." A polite live
 * region, present from the moment the board is, so its first change is
 * announced too. A record that grows shorter (a move taken back, against
 * the computer) is said as that. data-last-move and data-move-count carry the latest move of
 * the record (as the server holds it) for tests and tools.
 */
const MoveAnnouncer: React.FC<{ history: GameHistory; seat: Turn | null }> = ({
  history,
  seat,
}) => {
  const { moveRecords } = history;
  const last = moveRecords[moveRecords.length - 1];
  // Whether the record last changed by growing shorter
  const [seen, setSeen] = React.useState({ history, back: false });
  if (seen.history !== history) {
    setSeen({ history, back: moveRecords.length < seen.history.moveRecords.length });
  }
  const back = seen.history === history && seen.back;
  // Nothing to say about the opening position; the pill says whose move it is
  const text = React.useMemo(
    () =>
      back
        ? `Move taken back. ${describeTurn(history, seat)}`
        : history.lastMove || history.gameOver
          ? announceLastMove(history, seat)
          : '',
    [history, seat, back],
  );
  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="move-announcer"
      data-move-count={moveRecords.length}
      data-last-move={
        last ? `${last.from}-${last.to}${last.promotion ? `=${last.promotion}` : ''}` : undefined
      }
    >
      {text}
    </div>
  );
};

export default MoveAnnouncer;
