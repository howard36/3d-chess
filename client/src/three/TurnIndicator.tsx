import React from 'react';

export interface TurnIndicatorProps {
  turn: 'white' | 'black';
  /** The side to move is in check; said in words, not only by the King's glow. */
  inCheck?: boolean;
}

// Dressed by the board design's HUD variables; the fallbacks are the classic look.
const style: React.CSSProperties = {
  background: 'var(--turn-bg, rgba(255,255,255,0.85))',
  color: 'var(--turn-fg, #222)',
  border: 'var(--turn-border, none)',
  padding: '6px 18px',
  borderRadius: 'var(--hud-radius, 8px)',
  fontWeight: 600,
  fontSize: 'var(--turn-size, 20px)',
  fontFamily: 'var(--hud-font, inherit)',
  textTransform: 'var(--hud-case, none)' as React.CSSProperties['textTransform'],
  letterSpacing: 'var(--hud-tracking, normal)',
  textAlign: 'center',
  pointerEvents: 'none',
  boxShadow: 'var(--turn-shadow, 0 2px 8px rgba(0,0,0,0.08))',
  backdropFilter: 'var(--hud-blur, none)',
};

// A polite live region: screen readers announce each change of turn (and
// check) without interrupting. Placement is the game screen's HUD's business.
export const TurnIndicator: React.FC<TurnIndicatorProps> = ({ turn, inCheck = false }) => (
  <div style={style} data-testid="turn-indicator" role="status" aria-live="polite">
    {turn === 'white' ? 'White to move' : 'Black to move'}
    {inCheck && ' — in check'}
  </div>
);

export default TurnIndicator;
