import React from 'react';
import { useDesignChoice } from '../three/designs/context';
import { DESIGNS } from '../three/designs/registry';
import type { DesignEntry } from '../three/designs/types';

const Swatch = ({ colors }: { colors: DesignEntry['swatch'] }) => (
  <span
    aria-hidden
    style={{
      display: 'inline-grid',
      gridTemplateColumns: '1fr 1fr',
      width: 18,
      height: 18,
      flex: 'none',
      borderRadius: 5,
      overflow: 'hidden',
      boxShadow: '0 0 0 1px rgba(127,127,127,0.5)',
    }}
  >
    {colors.map((c, i) => (
      <span key={i} style={{ background: c }} />
    ))}
  </span>
);

const panel: React.CSSProperties = {
  background: 'var(--hud-bg, rgba(0,0,0,0.7))',
  color: 'var(--hud-fg, white)',
  border: 'var(--hud-border, none)',
  borderRadius: 'var(--hud-radius, 8px)',
  boxShadow: 'var(--hud-shadow, none)',
  backdropFilter: 'var(--hud-blur, none)',
  fontFamily: 'var(--hud-font, inherit)',
};

/**
 * Chooses the look of the board. The choice applies at once and is
 * remembered in this browser; it is purely cosmetic and never sent to the
 * opponent, who keeps their own.
 */
const DesignPicker: React.FC = () => {
  const { id, choose } = useDesignChoice();
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement | null>(null);
  const current = DESIGNS.find((d) => d.id === id) ?? DESIGNS[0];

  // Close on a click anywhere else, or on Escape.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} style={{ position: 'relative', pointerEvents: 'auto' }}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Board style: ${current.name}`}
        data-testid="design-picker"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...panel,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          fontSize: 14,
          cursor: 'pointer',
          textTransform: 'var(--hud-case, none)' as React.CSSProperties['textTransform'],
          letterSpacing: 'var(--hud-tracking, normal)',
        }}
      >
        <Swatch colors={current.swatch} />
        {current.name}
        <span aria-hidden style={{ opacity: 0.6, fontSize: 11 }}>
          ▼
        </span>
      </button>
      {open && (
        <ul
          aria-label="Board styles"
          style={{
            ...panel,
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            width: 300,
            maxHeight: '70vh',
            overflowY: 'auto',
            margin: 0,
            padding: 6,
            listStyle: 'none',
            zIndex: 1003,
          }}
        >
          {DESIGNS.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                aria-current={d.id === id}
                onClick={() => {
                  choose(d.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  alignItems: 'flex-start',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  font: 'inherit',
                  background: d.id === id ? 'rgba(127,127,127,0.25)' : 'transparent',
                }}
              >
                <Swatch colors={d.swatch} />
                <span>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{d.name}</span>
                  <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>{d.blurb}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DesignPicker;
