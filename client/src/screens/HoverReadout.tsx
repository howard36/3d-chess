import React from 'react';
import type { HoveredCell } from '../three/Board';
import { readoutParts } from '../three/hover';

// Dressed by the HUD's variables (index.css), like the turn indicator it
// sits under.
const style: React.CSSProperties = {
  margin: '6px auto 0',
  width: 'fit-content',
  padding: '3px 12px',
  background: 'var(--hud-bg)',
  color: 'var(--hud-fg)',
  border: 'var(--hud-border)',
  borderRadius: 'var(--hud-radius)',
  boxShadow: 'var(--hud-shadow)',
  backdropFilter: 'var(--hud-blur)',
  fontFamily: 'var(--hud-font)',
  fontSize: 13,
  lineHeight: '20px',
  letterSpacing: 'var(--hud-tracking)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  transition: 'opacity 150ms ease',
};

/**
 * What the pointer is on: "Cc4 · White Bishop", or "Cc4" on an empty square.
 * Fades out (keeping its last text) when the pointer leaves the board, so it
 * never jumps. Purely visual: screen readers have the move box and move list.
 */
const HoverReadout: React.FC<{ cell: HoveredCell | null }> = ({ cell }) => {
  const [shown, setShown] = React.useState(cell);
  if (cell && cell !== shown) setShown(cell);
  const parts = shown ? readoutParts(shown.zxy, shown.piece) : null;
  return (
    <div aria-hidden data-testid="hover-readout" style={{ ...style, opacity: cell ? 1 : 0 }}>
      {parts ? (
        <>
          <span style={{ fontWeight: 600 }}>{parts.cell}</span>
          {parts.piece && (
            <>
              <span style={{ opacity: 0.55 }}> · </span>
              <span>{parts.piece}</span>
            </>
          )}
        </>
      ) : (
        ' '
      )}
    </div>
  );
};

export default HoverReadout;
