import React from 'react';

export interface TurnIndicatorProps {
  turn: 'white' | 'black';
  /** The side to move is in check; said in words, not only by the King's glow. */
  inCheck?: boolean;
}

const style: React.CSSProperties = {
  background: 'rgba(255,255,255,0.85)',
  color: '#222',
  padding: '6px 18px',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 20,
  textAlign: 'center',
  pointerEvents: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
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
