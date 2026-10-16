import React from 'react';
import type { PieceType } from '../engine/pieces';
import type { Turn } from '../game/history';
import { CHARCOAL } from './charcoal';
import { GLYPHS } from './glyphs';

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
