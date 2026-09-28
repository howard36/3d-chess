import React from 'react';
import type { Move } from '../engine';
import { PieceType } from '../engine/pieces';
import type { Turn } from '../game/history';

export interface PromotionPickerProps {
  /** The legal promotion moves for the clicked square, one per piece. */
  choices: Move[];
  /** The player's colour: the pieces are drawn in their army's material. */
  color: Turn;
  onPick: (move: Move) => void;
  onCancel: () => void;
}

// Silhouettes on a 24-unit grid; the unicorn has no chess glyph in any font
const GLYPHS: Partial<Record<PieceType, string>> = {
  [PieceType.Queen]:
    'M4.5 7.5l3 8h9l3-8-3.8 3.4L12 4.6l-3.7 6.3zM7.4 16.6h9.2l1 2.4H6.4zM6 19.6h12V21H6z',
  [PieceType.Rook]:
    'M6 4h2.6v2.1h2.1V4h2.6v2.1h2.1V4H18v4.2l-2 1.6v6l2 2.5V21H6v-2.7l2-2.5v-6L6 8.2z',
  [PieceType.Bishop]:
    'M12 2.6a1.4 1.4 0 1 1 0 2.8a1.4 1.4 0 1 1 0-2.8zM12 5.9c3.4 2.4 4.4 5.1 2.8 7.8H9.2C7.6 11 8.6 8.3 12 5.9zM9 14.6h6l1.6 4H7.4zM6 19h12v2H6z',
  [PieceType.Knight]:
    'M7.5 21H19v-2.3l-1.1-1.2c.4-4.2-.6-9-5.6-11.8l-1-2.2-1.4 2.4C7.5 7.4 6 9.9 6.1 12.5l1.8 1.3 3-1.5c.3 1.7-.8 3.1-2.2 4.3l-1.2 2.1z',
  [PieceType.Unicorn]:
    'M7.5 21H19v-2.3l-1.1-1.2c.4-4.2-.6-9-5.6-11.8l-.4-.9L6.6 1.6l3.3 4.6C7.3 7.7 6 10 6.1 12.5l1.8 1.3 3-1.5c.3 1.7-.8 3.1-2.2 4.3l-1.2 2.1z',
};

/** A piece's silhouette in porcelain or charcoal. */
const Glyph = ({ type, color }: { type: PieceType; color: Turn }) => {
  const id = `promotion-${color}`;
  return (
    <svg viewBox="0 0 24 24" width={30} height={30} aria-hidden>
      <defs>
        <radialGradient id={id} cx="0.34" cy="0.28" r="0.9">
          {color === 'white' ? (
            <>
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.45" stopColor="#f1ede6" />
              <stop offset="1" stopColor="#bfb8ac" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#8a92a1" />
              <stop offset="0.45" stopColor="#555a66" />
              <stop offset="1" stopColor="#25272d" />
            </>
          )}
        </radialGradient>
      </defs>
      <path
        d={GLYPHS[type]}
        fill={`url(#${id})`}
        stroke={color === 'white' ? 'rgba(20,18,14,0.55)' : 'rgba(150,162,184,0.85)'}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  );
};

/**
 * Asks which piece a pawn becomes. Shown over the board when a pawn is moved
 * onto a promotion square; the move is only sent once a piece is picked.
 * Escape, Cancel or a press on the veil around the card cancels.
 */
const PromotionPicker: React.FC<PromotionPickerProps> = ({ choices, color, onPick, onCancel }) => {
  const firstButton = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    firstButton.current?.focus();
  }, []);

  return (
    <div
      className="hud-veil"
      style={{ zIndex: 1001 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      // Clicking the veil cancels, like Escape
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="hud-dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
        <h2 id="promotion-title" className="hud-eyebrow">
          Promote to
        </h2>
        <div className="hud-tiles">
          {choices.map((move, i) => (
            <button
              key={move.promotion}
              ref={i === 0 ? firstButton : undefined}
              className="hud-tile"
              onClick={() => onPick(move)}
            >
              {move.promotion && <Glyph type={move.promotion} color={color} />}
              <span>{move.promotion}</span>
            </button>
          ))}
        </div>
        <button className="hud-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default PromotionPicker;
