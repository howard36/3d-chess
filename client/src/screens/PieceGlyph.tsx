import React from 'react';
import { PieceType } from '../engine/pieces';
import type { Turn } from '../game/history';

// Silhouettes on a 24-unit grid, drawn here because the unicorn has no chess
// glyph in any font. The promotion tiles and the captured pieces share them.
const GLYPHS: Record<PieceType, string> = {
  [PieceType.King]:
    'M11 1.8h2v2h2v2h-2v2h-2v-2H9v-2h2zM7.6 9c2-1.3 6.8-1.3 8.8 0l-1.2 7.2H8.8zM7.6 16.8h8.8l1 2.4H6.6zM6 19.6h12V21H6z',
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
  [PieceType.Pawn]:
    'M12 3.6a3.3 3.3 0 1 1 0 6.6a3.3 3.3 0 1 1 0-6.6zM9 11.4h6l1.6 7.1H7.4zM6 18.9h12V21H6z',
};

/**
 * A piece's silhouette in its army's material: porcelain or charcoal, lit
 * from the top left like the HUD's stones. Decorative (aria-hidden): what it
 * shows is said in words beside it.
 */
export const PieceGlyph = ({
  type,
  color,
  size,
}: {
  type: PieceType;
  color: Turn;
  /** Its height in CSS px; the box is square. */
  size: number;
}) => {
  // Each glyph its own gradient: a shared id would draw nothing wherever the
  // first glyph to declare it is out of the page's rendering. (Only letters
  // and digits, so the reference needs no escaping.)
  const id = `glyph-${React.useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      data-piece={type}
      data-color={color}
      aria-hidden
    >
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
