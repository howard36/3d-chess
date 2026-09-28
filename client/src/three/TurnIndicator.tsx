import React from 'react';
import type { GameOver, Turn } from '../game/history';

export interface TurnIndicatorProps {
  turn: Turn;
  /** The side to move is in check; said in words, not only by the King's glow. */
  inCheck?: boolean;
  /** Once the game is over the chip gives the result instead of whose move it is. */
  gameOver?: GameOver | null;
}

// Dressed by the HUD's variables (index.css).
const style: React.CSSProperties = {
  background: 'var(--turn-bg)',
  color: 'var(--turn-fg)',
  border: 'var(--turn-border)',
  padding: '6px 18px',
  borderRadius: 'var(--hud-radius)',
  fontWeight: 600,
  fontSize: 'var(--turn-size)',
  fontFamily: 'var(--hud-font)',
  letterSpacing: 'var(--hud-tracking)',
  textAlign: 'center',
  pointerEvents: 'none',
  boxShadow: 'var(--turn-shadow)',
  backdropFilter: 'var(--hud-blur)',
};

const named = (side: Turn) => (side === 'white' ? 'White' : 'Black');

/** What the chip says: whose move it is (and check), or how the game ended. */
const turnLabel = (turn: Turn, inCheck: boolean, gameOver: GameOver | null): string => {
  if (gameOver?.result === 'checkmate') {
    return gameOver.winner ? `Checkmate · ${named(gameOver.winner)} wins` : 'Checkmate';
  }
  if (gameOver?.result === 'stalemate') return 'Stalemate · Draw';
  return `${named(turn)} to move${inCheck ? ' — in check' : ''}`;
};

// A polite live region: screen readers announce each change of turn (and
// check, and the result) without interrupting. Placement is the game
// screen's HUD's business. While the game is on, data-turn names the side to
// move; once it is over, data-result (checkmate, stalemate) and data-winner
// take its place, for tests, tools and stylesheets.
export const TurnIndicator: React.FC<TurnIndicatorProps> = ({
  turn,
  inCheck = false,
  gameOver = null,
}) => (
  <div
    style={style}
    data-testid="turn-indicator"
    data-turn={gameOver ? undefined : turn}
    data-result={gameOver?.result}
    data-winner={gameOver?.winner}
    role="status"
    aria-live="polite"
  >
    {turnLabel(turn, inCheck, gameOver)}
  </div>
);

export default TurnIndicator;
