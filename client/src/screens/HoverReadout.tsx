import React from 'react';
import type { HoveredCell } from '../three/Board';
import { readoutParts } from '../three/hover';

// Dressed by the board design's HUD variables, like the turn indicator it
// sits under. The cell keeps its case whatever the design's --hud-case: "Cc4"
// and "CC4" are different cells.
const style: React.CSSProperties = {
  margin: '6px auto 0',
  width: 'fit-content',
  padding: '3px 12px',
  background: 'var(--hud-bg, rgba(0,0,0,0.7))',
  color: 'var(--hud-fg, white)',
  border: 'var(--hud-border, none)',
  borderRadius: 'var(--hud-radius, 6px)',
  boxShadow: 'var(--hud-shadow, none)',
  backdropFilter: 'var(--hud-blur, none)',
  fontFamily: 'var(--hud-font, inherit)',
  fontSize: 13,
  lineHeight: '20px',
  letterSpacing: 'var(--hud-tracking, normal)',
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
          <span
            style={{ fontFamily: 'var(--hud-mono, var(--hud-font, inherit))', fontWeight: 600 }}
          >
            {parts.cell}
          </span>
          {parts.piece && (
            <>
              <span style={{ opacity: 0.55 }}> · </span>
              <span
                style={{
                  textTransform: 'var(--hud-case, none)' as React.CSSProperties['textTransform'],
                }}
              >
                {parts.piece}
              </span>
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
