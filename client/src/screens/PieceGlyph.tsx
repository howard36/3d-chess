import React from 'react';
import { PieceType } from '../engine/pieces';
import type { Turn } from '../game/history';

// Silhouettes on a 24-unit grid, drawn here because the unicorn has no chess
// glyph in any font. The promotion tiles, the captured pieces and the
// tutorial share them. Every piece stands on y = 21, as tall as its 3D piece
// with the differences softened (king 19.2 > queen > unicorn > bishop >
// knight > rook > pawn 14.6), so a row of them reads like the set; what tells
// them apart at 20 px is the outline of each one's head.
const GLYPHS: Record<PieceType, string> = {
  [PieceType.King]:
    'M11 1.8h2v2h2v2h-2v2h-2v-2H9v-2h2zM7.6 9c2-1.3 6.8-1.3 8.8 0l-1.2 7.2H8.8zM7.6 16.8h8.8l1 2.4H6.6zM6 19.6h12V21H6z',
  // The king's body under a coronet of points and a pearl
  [PieceType.Queen]:
    'M12 2.4a1.05 1.05 0 1 1 0 2.1a1.05 1.05 0 1 1 0-2.1zM6.4 5.3L9.1 7.9L12 5.1L14.9 7.9L17.6 5.3L15.2 16.1H8.8zM7.6 16.8h8.8l1 2.4H6.6zM6 19.6h12V21H6z',
  [PieceType.Rook]:
    'M6.4 5.4h2.5v2h2v-2h2.2v2h2v-2h2.5v3.8l-1.9 1.5v5.3l1.9 2.3V21H6.4v-2.7l1.9-2.3v-5.3l-1.9-1.5z',
  // A full, round mitre with the 3D piece's slanted cut taken out of its
  // outline, a ball, and a collar disc: round where the unicorn is thin
  [PieceType.Bishop]:
    'M12 3.5a1.4 1.4 0 1 1 0 2.8a1.4 1.4 0 1 1 0-2.8zM8.65 10.55L8.73 9.95L8.95 9.34L9.3 8.73L9.53 8.43L10.11 7.82L10.87 7.21L11.34 6.9L12 6.6L12.66 6.9L13.13 7.21L13.89 7.82L14.5 8.46L11.15 11.15L11.7 11.75L15.09 9.44L15.27 9.95L15.32 10.25L15.34 10.86L15.25 11.47L15.16 11.77L14.92 12.38L14.59 12.99L13.97 13.9L10.03 13.9L9.41 12.99L8.95 12.07L8.75 11.47L8.69 11.16zM9.15 14.3H14.85a.55 .55 0 0 1 0 1.1H9.15a.55 .55 0 0 1 0-1.1zM9.6 15.9L14.4 15.9L16.2 18.7L7.8 18.7zM6.4 19.1h11.2V21H6.4z',
  [PieceType.Knight]:
    'M7.5 21H19v-2.3l-1.1-1.2c.4-4.2-.6-9-5.6-11.8l-.9-1.9-1.5 2.1C7.5 7.4 6 9.9 6.1 12.5l1.8 1.3 3-1.5c.3 1.7-.8 3.1-2.2 4.3l-1.2 2.1z',
  // The 3D piece's spiralled horn, not a horse: a slim spire whose twist is
  // three slanted grooves, on a ring and a flared stem. Thin at the head where
  // the bishop is round, with more ink than the pawn below it, as it is worth
  // more. (The knight's silhouette with a horn is the knight at the size the
  // HUD draws it.)
  [PieceType.Unicorn]:
    'M9.6 12.3L10.07 10.84L13.42 9.17L14.4 12.3zM10.28 10.19L10.85 8.25L12.88 7.24L13.28 8.69zM11.02 7.61L11.5 5.73L12.4 5.27L12.75 6.75zM11.63 5.11L11.91 3.68L11.98 2.9L12.02 2.9L12.09 3.68L12.3 4.78zM9.85 12.7H14.15a.55 .55 0 0 1 0 1.1H9.85a.55 .55 0 0 1 0-1.1zM14 14.1L14.14 14.55L14.33 15L14.82 15.9L15.7 17.25L16.7 18.6L7.3 18.6L8.3 17.25L9.18 15.9L9.67 15L9.86 14.55L10 14.1zM6.6 19h10.8v2H6.6z',
  [PieceType.Pawn]:
    'M12 6.4a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 1 1 0-4.4zM10.2 11.7h3.6L15.2 18.8H8.8zM7.6 19.2h8.8V21H7.6z',
};

/**
 * Charcoal, Black's material: a grey lit softly from the top left, its far
 * side a darker grey rather than black (offset, colour), which the start
 * page's computer (StartScreen, Bot) is drawn in too.
 */
export const CHARCOAL = [
  ['0', '#7b8392'],
  ['0.45', '#5a606c'],
  ['1', '#3b3f48'],
] as const;
/** The pale edge round a charcoal glyph. */
export const CHARCOAL_EDGE = 'rgba(150,162,184,0.85)';

/**
 * A piece's silhouette in its army's material: porcelain or charcoal, lit
 * from the top left like the HUD's stones. Its edge is drawn inside the
 * outline (the stroke clipped to the shape), so it never swells the
 * silhouette or fills in the bishop's cut and the unicorn's grooves; the
 * HUD's brighter charcoal rim (index.css) is clipped the same way.
 * Decorative (aria-hidden): what it shows is said in words beside it.
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
  // Each glyph its own gradient and clip: a shared id would draw nothing
  // wherever the first glyph to declare it is out of the page's rendering.
  // (Only letters and digits, so the reference needs no escaping.)
  const id = `glyph-${React.useId().replace(/[^\w-]/g, '')}`;
  const d = GLYPHS[type];
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
            CHARCOAL.map(([offset, stopColor]) => (
              <stop key={offset} offset={offset} stopColor={stopColor} />
            ))
          )}
        </radialGradient>
        <clipPath id={`${id}-shape`}>
          <path d={d} />
        </clipPath>
      </defs>
      {/* Twice the edge's width, half of it clipped away */}
      <path
        d={d}
        fill={`url(#${id})`}
        stroke={color === 'white' ? 'rgba(20,18,14,0.55)' : CHARCOAL_EDGE}
        strokeWidth={color === 'white' ? 1.3 : 1.5}
        strokeLinejoin="round"
        clipPath={`url(#${id}-shape)`}
      />
    </svg>
  );
};
