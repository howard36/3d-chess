import React from 'react';
import { PieceType } from '../engine/pieces';
import type { Turn } from '../game/history';

// Silhouettes on a 24-unit grid, drawn here because the unicorn has no chess
// glyph in any font. The promotion tiles, the captured pieces and the
// tutorial share them. Every piece stands on y = 21, as tall as its 3D piece
// with the differences softened (king 19.2 > queen > unicorn > bishop >
// knight > rook > pawn 14.4), so a row of them reads like the set; what tells
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
  // The 3D piece's spiralled horn, not a horse: a spire whose twist is two
  // steep grooves, low on the horn where it is wide enough to show them (what
  // tells it from the bishop and the pawn at a glance; any wider and they
  // darken the porcelain horn), on a ring, a flared stem and a broad plinth. Thin at the tip where the bishop
  // is round (so it stands nearly as tall as the queen), and a third heavier
  // than the pawn, as it is worth more. (The knight's silhouette with a horn is the knight at the size
  // the HUD draws it.)
  [PieceType.Unicorn]:
    'M9.65 11.57L10.38 9.31L13.06 7.43L13.49 8.88zM9.68 12.3L13.68 9.5L14.6 12.3zM10.67 8.36L11.17 6.58L11.57 4.95L11.9 3.32L11.98 2.5L12.02 2.5L12.04 2.91L12.25 4.13L12.52 5.36L12.89 6.8zM9.8 12.7H14.2a.7 .7 0 0 1 0 1.4H9.8a.7 .7 0 0 1 0-1.4zM14.4 14.1L17 18.6L7 18.6L9.6 14.1zM6.4 19h11.2v2H6.4z',
  // A small ball on a slim body: the lightest piece in the set
  [PieceType.Pawn]: 'M12 6.6a2 2 0 1 1 0 4a2 2 0 1 1 0-4zM10.4 11.5h3.2L15 18.8H9zM8 19.2h8V21H8z',
};

/**
 * Charcoal, Black's material: a dark slate lit softly from the top left, in
 * the black turn stone's tones (offset, colour), which the start page's
 * computer (BotGlyph) is drawn in too.
 */
export const CHARCOAL = [
  ['0', '#666c7a'],
  ['0.45', '#3e424b'],
  ['1', '#24262c'],
] as const;
/** The pale edge round the computer's head (BotGlyph). */
export const CHARCOAL_EDGE = 'rgba(150,162,184,0.85)';

/**
 * A charcoal piece's edge, along the glyph's diagonal (offset, colour,
 * opacity): the light caught on its top-left edges, falling to a dim rim on
 * the far side that only just holds the outline against the night, so the
 * piece reads as a dark solid rather than pale line work.
 */
const CHARCOAL_RIM = [
  ['0', '#b6c1d4', 0.75],
  ['0.4', '#b6c1d4', 0.38],
  ['1', '#737d90', 0.45],
] as const;

/**
 * A piece's silhouette in its army's material: porcelain or charcoal, lit
 * from the top left like the HUD's stones. Its edge is drawn inside the
 * outline (the stroke clipped to the shape), so it never swells the
 * silhouette or fills in the bishop's cut and the unicorn's grooves (the
 * HUD draws charcoal's a little wider: index.css).
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
        {color === 'black' && (
          <linearGradient
            id={`${id}-rim`}
            gradientUnits="userSpaceOnUse"
            x1="6"
            y1="2"
            x2="17"
            y2="21"
          >
            {CHARCOAL_RIM.map(([offset, stopColor, stopOpacity]) => (
              <stop key={offset} offset={offset} stopColor={stopColor} stopOpacity={stopOpacity} />
            ))}
          </linearGradient>
        )}
        <clipPath id={`${id}-shape`}>
          <path d={d} />
        </clipPath>
      </defs>
      {/* Twice the edge's width, half of it clipped away */}
      <path
        d={d}
        fill={`url(#${id})`}
        stroke={color === 'white' ? 'rgba(20,18,14,0.55)' : `url(#${id}-rim)`}
        strokeWidth={color === 'white' ? 1.3 : 1.2}
        strokeLinejoin="round"
        clipPath={`url(#${id}-shape)`}
      />
    </svg>
  );
};
