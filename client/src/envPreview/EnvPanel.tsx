// ENV PREVIEW (temporary): the settings menu of a preview deploy. A small
// pill in the bottom right corner (A/B: today's main for comparison; the
// sliders: the menu), and the menu in its place when open. It takes the
// pointer only inside its own box. B toggles the comparison from anywhere
// but a text field.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { envFeatures, envStore } from './index';
import type { EnvFeature } from './index';
import { envLink } from './link';
import './envPanel.css';

const subscribe = (l: () => void) => envStore.subscribe(l);
const version = () => envStore.version();

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard API (an insecure origin): the old way
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
};

const isToggle = (f: EnvFeature) =>
  f.options.length === 2 &&
  f.options.some((o) => o.id === 'off') &&
  f.options.some((o) => o.id === 'on');

const SlidersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2 4h7M13 4h1M2 12h1M7 12h7M2 8h3M9 8h5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <circle cx="11" cy="4" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="5" cy="12" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="7" cy="8" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const Feature = ({ feature, comparing }: { feature: EnvFeature; comparing: boolean }) => {
  const value = envStore.choice(feature.id);
  const labelId = `env-${feature.id}`;
  const changed = value !== feature.default;
  return (
    <div className="env-feature" data-feature={feature.id}>
      <div className="env-feature-head">
        <span id={labelId} className="env-feature-label">
          {feature.label}
          {changed && <span className="env-dot" title="Not the recommended choice" />}
        </span>
        {feature.note && <span className="env-note">{feature.note}</span>}
      </div>
      {isToggle(feature) ? (
        <button
          type="button"
          role="switch"
          aria-checked={value === 'on'}
          aria-labelledby={labelId}
          className="env-switch"
          data-dim={comparing || undefined}
          onClick={() => envStore.set(feature.id, value === 'on' ? 'off' : 'on')}
        >
          <span className="env-switch-knob" />
        </button>
      ) : (
        <div
          className="env-segments"
          role="group"
          aria-labelledby={labelId}
          data-dim={comparing || undefined}
        >
          {feature.options.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={value === o.id}
              data-option={o.id}
              data-default={o.id === feature.default || undefined}
              title={o.id === feature.default ? 'Recommended' : undefined}
              onClick={() => envStore.set(feature.id, o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const EnvPanel = () => {
  useSyncExternalStore(subscribe, version);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const comparing = envStore.compare();

  // B: today's main and back, from anywhere but a text field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'b' && e.key !== 'B') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || editable(e.target)) return;
      envStore.setCompare(!envStore.compare());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const compareButton = (
    <button
      type="button"
      className="env-ab"
      aria-pressed={comparing}
      title="Today's main, for comparison (B)"
      onClick={() => envStore.setCompare(!comparing)}
    >
      {comparing ? 'Main' : 'A/B'}
    </button>
  );

  if (!open) {
    return (
      <div className="env-root env-pill" data-testid="env-panel" data-open="false">
        {compareButton}
        <button
          ref={opener}
          type="button"
          className="env-open"
          aria-label="Environment settings"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <SlidersIcon />
        </button>
      </div>
    );
  }

  const features = envFeatures();
  const groups = [...new Set(features.map((f) => f.group))];
  const query = envStore.query();
  const close = () => {
    setOpen(false);
    // Back to the button that opened it, once it is there again
    requestAnimationFrame(() => opener.current?.focus());
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  return (
    <section
      className="env-root env-menu"
      data-testid="env-panel"
      data-open="true"
      aria-label="Environment settings"
      onKeyDown={onKeyDown}
    >
      <header className="env-head">
        <h2>Environment</h2>
        <button type="button" className="env-close" aria-label="Close" onClick={close}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      <div className="env-compare">
        <span id="env-compare-label">
          Baseline (main) <kbd>B</kbd>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={comparing}
          aria-labelledby="env-compare-label"
          className="env-switch"
          onClick={() => envStore.setCompare(!comparing)}
        >
          <span className="env-switch-knob" />
        </button>
      </div>
      <div className="env-body">
        {groups.length === 0 && <p className="env-empty">No features yet</p>}
        {groups.map((g) => (
          <section key={g} className="env-group" aria-label={g}>
            <h3>{g}</h3>
            {features
              .filter((f) => f.group === g)
              .map((f) => (
                <Feature key={f.id} feature={f} comparing={comparing} />
              ))}
          </section>
        ))}
      </div>
      <footer className="env-foot">
        <code className="env-query" title="This combination, as ?env= takes it">
          {query || '—'}
        </code>
        <div className="env-actions">
          <button type="button" onClick={() => envStore.reset()}>
            Reset to recommended
          </button>
          <button
            type="button"
            onClick={async () =>
              setCopied((await copyText(envLink(location, query))) ? 'copied' : 'failed')
            }
          >
            {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy link'}
          </button>
        </div>
      </footer>
    </section>
  );
};
