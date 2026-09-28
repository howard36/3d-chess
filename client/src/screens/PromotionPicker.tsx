import React from 'react';
import type { Move } from '../engine';
import type { Turn } from '../game/history';
import { PieceGlyph } from './PieceGlyph';

export interface PromotionPickerProps {
  /** The legal promotion moves for the clicked square, one per piece. */
  choices: Move[];
  /** The player's colour: the pieces are drawn in their army's material. */
  color: Turn;
  onPick: (move: Move) => void;
  onCancel: () => void;
}

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
              {move.promotion && <PieceGlyph type={move.promotion} color={color} size={30} />}
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
