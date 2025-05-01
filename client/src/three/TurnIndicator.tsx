import React from 'react';

export interface TurnIndicatorProps {
  turn: 'white' | 'black';
}

const style: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(255,255,255,0.85)',
  color: '#222',
  padding: '6px 18px',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 20,
  zIndex: 10,
  pointerEvents: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
};

export const TurnIndicator: React.FC<TurnIndicatorProps> = ({ turn }) => (
  <div style={style} data-testid="turn-indicator">
    {turn === 'white' ? 'White to move' : 'Black to move'}
  </div>
);

export default TurnIndicator;
