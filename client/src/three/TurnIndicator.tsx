import React from 'react';
import type { GameOver, Turn } from '../game/history';

export interface TurnIndicatorProps {
  turn: Turn;
  /** The side to move is in check; said in words, not only by the King's glow. */
  inCheck?: boolean;
  /** Once the game is over the chip gives the result instead of whose move it is. */
  gameOver?: GameOver | null;
}

// Dressed by the board design's HUD variables; the fallbacks are the classic look.
const style: React.CSSProperties = {
  background: 'var(--turn-bg, rgba(255,255,255,0.85))',
  color: 'var(--turn-fg, #222)',
  border: 'var(--turn-border, none)',
  padding: '6px 18px',
  borderRadius: 'var(--hud-radius, 8px)',
  fontWeight: 'var(--turn-weight, 600)' as React.CSSProperties['fontWeight'],
  fontSize: 'var(--turn-size, 20px)',
  fontFamily: 'var(--turn-font, var(--hud-font, inherit))',
  textTransform: 'var(--hud-case, none)' as React.CSSProperties['textTransform'],
  letterSpacing: 'var(--hud-tracking, normal)',
  textAlign: 'center',
  pointerEvents: 'none',
  boxShadow: 'var(--turn-shadow, 0 2px 8px rgba(0,0,0,0.08))',
  backdropFilter: 'var(--hud-blur, none)',
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
// take its place, for tests, tools and designs' stylesheets.
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
