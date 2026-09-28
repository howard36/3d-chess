import React from 'react';
import { useDesignChoice } from '../three/designs/context';
import {
  changedSettingCount,
  formatSetting,
  resetDesignSettings,
  setDesignSetting,
  settingGroups,
  useSettingsOf,
} from '../three/designs/settings';
import type { SettingSpec, SettingValue } from '../three/designs/settings';
import type { Design } from '../three/designs/types';

// The design's settings (Design.settings, see designs/settings.ts): a gear
// beside the style picker, shown only when the design declares some, opening
// a small panel over the top right of the board. Every change applies at
// once and is kept in this browser; nothing here reaches the opponent. The
// panel is not modal: the board stays in play (a click on it leaves the panel
// open, to see a change from another side), Escape or the gear closes it, and
// a click on anything else in the page does too. It lives in the HUD, a DOM
// layer beside the canvas, so no pointer or wheel event on it ever reaches the
// board or its camera.

const hud: React.CSSProperties = {
  background: 'var(--hud-bg, rgba(0,0,0,0.7))',
  color: 'var(--hud-fg, white)',
  border: 'var(--hud-border, none)',
  borderRadius: 'var(--hud-radius, 8px)',
  boxShadow: 'var(--hud-shadow, none)',
  backdropFilter: 'var(--hud-blur, none)',
  fontFamily: 'var(--hud-font, inherit)',
};

const MUTED = 'var(--hud-muted, color-mix(in srgb, currentColor 65%, transparent))';
const ACCENT = 'var(--hud-accent, #5b9dff)';
const ACCENT_FG = 'var(--hud-accent-fg, #0b0d12)';
const LINE = 'rgba(127,127,127,0.35)';

/** More options than this and a choice is a drop-down instead of a row of buttons. */
const SEGMENTS_MAX = 4;

const Hint = ({ id, text }: { id: string; text: string }) => (
  <p id={id} style={{ margin: '3px 0 0', fontSize: 11.5, lineHeight: 1.35, color: MUTED }}>
    {text}
  </p>
);

const SettingControl = ({
  spec,
  value,
  onChange,
  id,
}: {
  spec: SettingSpec;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  id: string;
}) => {
  const hintId = spec.hint ? `${id}-hint` : undefined;
  const labelId = `${id}-label`;
  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  };
  const label = (
    <label id={labelId} htmlFor={id} style={{ fontWeight: 600, fontSize: 13 }}>
      {spec.label}
    </label>
  );

  let control: React.ReactNode;
  if (spec.kind === 'toggle') {
    const on = value === true;
    control = (
      <div style={row}>
        {label}
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={on}
          aria-describedby={hintId}
          onClick={() => onChange(!on)}
          style={{
            position: 'relative',
            flex: 'none',
            width: 36,
            height: 20,
            padding: 0,
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            background: on ? ACCENT : 'rgba(127,127,127,0.45)',
            transition: 'background 150ms',
          }}
        >
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 2,
              left: on ? 18 : 2,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: on ? ACCENT_FG : 'var(--hud-fg, white)',
              transition: 'left 150ms',
            }}
          />
        </button>
      </div>
    );
  } else if (spec.kind === 'slider') {
    const n = typeof value === 'number' ? value : spec.default;
    const text = formatSetting(spec, n);
    control = (
      <>
        <div style={row}>
          {label}
          {/* aria-hidden: the slider itself says its value (aria-valuetext), and an
              output is a live region that would say it again with every step */}
          <output
            htmlFor={id}
            aria-hidden
            style={{
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--hud-mono, inherit)',
              color: MUTED,
            }}
          >
            {text}
          </output>
        </div>
        <input
          id={id}
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={n}
          aria-valuetext={text}
          aria-describedby={hintId}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ display: 'block', width: '100%', margin: '4px 0 0', accentColor: ACCENT }}
        />
      </>
    );
  } else if (spec.options.length > SEGMENTS_MAX) {
    control = (
      <div style={row}>
        {label}
        <select
          id={id}
          value={String(value)}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          style={{
            maxWidth: '60%',
            padding: '3px 6px',
            font: 'inherit',
            fontSize: 12.5,
            color: 'inherit',
            background: 'rgba(127,127,127,0.18)',
            border: `1px solid ${LINE}`,
            borderRadius: 6,
          }}
        >
          {spec.options.map((o) => (
            // The open list is the browser's own: dark on light everywhere
            <option key={o.value} value={o.value} style={{ color: '#111', background: '#fff' }}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  } else {
    control = (
      <>
        <div style={row}>
          <span id={labelId} style={{ fontWeight: 600, fontSize: 13 }}>
            {spec.label}
          </span>
        </div>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={hintId}
          style={{
            display: 'flex',
            marginTop: 5,
            borderRadius: 6,
            overflow: 'hidden',
            boxShadow: `0 0 0 1px ${LINE}`,
          }}
        >
          {spec.options.map((o) => {
            const chosen = value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => onChange(o.value)}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  padding: '5px 6px',
                  border: 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 12,
                  color: chosen ? ACCENT_FG : 'inherit',
                  background: chosen ? ACCENT : 'transparent',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </>
    );
  }
  return (
    <div style={{ padding: '7px 0' }}>
      {control}
      {spec.hint && hintId && <Hint id={hintId} text={spec.hint} />}
    </div>
  );
};

export interface SettingsPanelProps {
  design: Design;
  /** The panel's id (the gear's aria-controls). */
  id: string;
  onClose: () => void;
  style?: React.CSSProperties;
}

/** Every setting of `design`, under its group, with a reset to the design's defaults. */
export const SettingsPanel = ({ design, id, onClose, style }: SettingsPanelProps) => {
  const values = useSettingsOf(design);
  const changed = changedSettingCount(design);
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      data-testid="design-settings-panel"
      style={{
        ...hud,
        boxSizing: 'border-box',
        padding: '10px 14px 12px',
        fontSize: 13,
        overflowY: 'auto',
        // Scrolls on its own on a phone, never the page, never the board
        overscrollBehavior: 'contain',
        touchAction: 'pan-y',
        WebkitOverflowScrolling: 'touch',
        pointerEvents: 'auto',
        zIndex: 1003,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          {design.name} settings
        </h2>
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          style={{
            width: 26,
            height: 26,
            padding: 0,
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 16,
            lineHeight: 1,
            color: 'inherit',
            background: 'transparent',
          }}
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
      {settingGroups(design.settings ?? []).map((group, i) => (
        <div
          key={group.label}
          role="group"
          aria-labelledby={`${id}-group-${i}`}
          style={{ marginTop: 8, paddingTop: 6, borderTop: i === 0 ? 'none' : `1px solid ${LINE}` }}
        >
          <h3
            id={`${id}-group-${i}`}
            style={{
              margin: '2px 0 0',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              opacity: 0.6,
            }}
          >
            {group.label}
          </h3>
          {group.settings.map((spec) => (
            <SettingControl
              key={spec.key}
              id={`${id}-${spec.key}`}
              spec={spec}
              value={values[spec.key]}
              onChange={(value) => setDesignSetting(design, spec.key, value)}
            />
          ))}
        </div>
      ))}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginTop: 8,
          paddingTop: 10,
          borderTop: `1px solid ${LINE}`,
        }}
      >
        <span role="status" data-testid="settings-changed" style={{ fontSize: 12, color: MUTED }}>
          {changed === 0 ? 'All at their defaults' : `${changed} changed`}
        </span>
        <button
          type="button"
          disabled={changed === 0}
          onClick={() => resetDesignSettings(design)}
          style={{
            padding: '5px 10px',
            font: 'inherit',
            fontSize: 12.5,
            cursor: changed === 0 ? 'default' : 'pointer',
            opacity: changed === 0 ? 0.45 : 1,
            background: 'var(--button-bg, rgba(127,127,127,0.22))',
            color: 'var(--button-fg, inherit)',
            border: `var(--button-border, 1px solid ${LINE})`,
            borderRadius: 'var(--button-radius, 6px)',
          }}
        >
          Reset to defaults{changed > 0 ? ` (${changed})` : ''}
        </button>
      </div>
    </section>
  );
};

const Gear = () => (
  <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path
      strokeWidth="1.8"
      strokeLinejoin="round"
      d="M10.3 2.8h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9-2.6-.5v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8z"
    />
    <circle cx="12" cy="12" r="3.2" strokeWidth="1.8" />
  </svg>
);

/** Where the panel opens: under the gear, right-aligned to it, inside the window. */
const placeUnder = (button: HTMLElement): React.CSSProperties => {
  const r = button.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(320, vw - 20);
  const right = Math.min(Math.max(vw - r.right, 10), vw - 10 - width);
  const top = r.bottom + 6;
  // No taller than it needs, and never the whole board on a short screen
  const maxHeight = Math.max(160, Math.min(vh - top - 12, Math.max(280, vh * 0.62)));
  return { position: 'fixed', top, right, width, maxHeight };
};

const SettingsGear = ({ design }: { design: Design }) => {
  const [open, setOpen] = React.useState(false);
  const [place, setPlace] = React.useState<React.CSSProperties>({ position: 'fixed' });
  const button = React.useRef<HTMLButtonElement | null>(null);
  const panelId = React.useId();
  // Subscribed, so the gear's mark follows the panel's changes
  useSettingsOf(design);
  const changed = changedSettingCount(design);

  // Measured as it opens, with the gear where it stands (the panel, fixed,
  // never moves it), and again whenever the window changes size
  const toggle = () => {
    if (!open && button.current) setPlace(placeUnder(button.current));
    setOpen((o) => !o);
  };
  React.useEffect(() => {
    if (!open) return;
    const measure = () => button.current && setPlace(placeUnder(button.current));
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const inPanel = (node: Node | null) =>
      !!node && !!document.getElementById(panelId)?.contains(node);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Back to the gear from inside the panel, so the keyboard isn't left nowhere
      if (inPanel(document.activeElement)) button.current?.focus();
      setOpen(false);
    };
    // A press on anything else in the page closes it, but not one on the
    // board: the player may turn the view to see what a setting changed
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || inPanel(target) || button.current?.contains(target)) return;
      if (target instanceof HTMLCanvasElement) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, panelId]);

  return (
    <div style={{ position: 'relative', pointerEvents: 'auto' }}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${design.name} settings${changed > 0 ? ` (${changed} changed)` : ''}`}
        title="Board settings"
        data-testid="design-settings"
        onClick={toggle}
        style={{
          ...hud,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
          lineHeight: 0,
          cursor: 'pointer',
        }}
      >
        <Gear />
        {changed > 0 && (
          // Something is changed from the design's defaults
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: ACCENT,
              boxShadow: '0 0 0 1.5px var(--hud-fg, white)',
            }}
          />
        )}
      </button>
      {open && (
        <SettingsPanel
          design={design}
          id={panelId}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
          style={place}
        />
      )}
    </div>
  );
};

/**
 * The gear that opens the current design's settings panel, or nothing for a
 * design without settings. `design` overrides the chosen design (tests).
 */
const DesignSettings = ({ design: given }: { design?: Design }) => {
  const { design: chosen } = useDesignChoice();
  const design = given ?? chosen;
  if (!design.settings?.length) return null;
  // A new design starts with its panel closed
  return <SettingsGear key={design.id} design={design} />;
};

export default DesignSettings;
