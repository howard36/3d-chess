import React from 'react';
import type { Move } from '../engine';
import { PieceType } from '../engine';

export interface PromotionPickerProps {
  /** The legal promotion moves for the clicked square, one per piece. */
  choices: Move[];
  onPick: (move: Move) => void;
  onCancel: () => void;
}

/**
 * Asks which piece a pawn becomes. Shown over the board when a pawn is moved
 * onto a promotion square; the move is only sent once a piece is picked.
 */
const PromotionPicker: React.FC<PromotionPickerProps> = ({ choices, onPick, onCancel }) => {
  const firstButton = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    firstButton.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-labelledby="promotion-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1001,
      }}
    >
      <div
        style={{
          background: 'white',
          color: '#222',
          padding: '1.5rem 2rem',
          borderRadius: 16,
          boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
          textAlign: 'center',
        }}
      >
        <h2 id="promotion-title" style={{ marginTop: 0, marginBottom: 12 }}>
          Promote to
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {choices.map((move, i) => (
            <button
              key={move.promotion}
              ref={i === 0 ? firstButton : undefined}
              onClick={() => onPick(move)}
              style={{ fontSize: 16, padding: '0.6em 1.2em' }}
            >
              {move.promotion ?? PieceType.Queen}
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          style={{ marginTop: 14, background: 'none', border: 'none', color: '#555' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default PromotionPicker;
