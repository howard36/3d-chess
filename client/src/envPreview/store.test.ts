import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { envPanelOn, envPreviewOn, isPreviewHost } from './gate';
import {
  defineEnvFeature,
  envFeatures,
  restoreEnvFeaturesForTest,
  takeEnvFeaturesForTest,
} from './registry';
import type { EnvFeature } from './registry';
import { createEnvStore, ENV_STORAGE_KEY, parseEnvQuery } from './store';

// ENV PREVIEW (temporary): the settings store: where a value comes from, and
// that nothing the page cannot control (storage, a stray address) breaks it.

let saved: EnvFeature[];
beforeEach(() => {
  saved = takeEnvFeaturesForTest();
  defineEnvFeature({
    id: 'sky',
    label: 'Sky',
    group: 'Sky',
    options: [
      { id: 'off', label: 'Off' },
      { id: 'soft', label: 'Soft' },
      { id: 'bold', label: 'Bold' },
    ],
    default: 'soft',
  });
  defineEnvFeature({
    id: 'mist',
    label: 'Mist',
    group: 'Garden',
    options: [
      { id: 'off', label: 'Off' },
      { id: 'on', label: 'On' },
    ],
    default: 'on',
  });
  defineEnvFeature({
    id: 'meteor',
    label: 'Meteor',
    group: 'Events',
    options: [
      { id: 'off', label: 'Off' },
      { id: 'on', label: 'On' },
    ],
    default: 'on',
    baseline: 'on',
  });
});
afterEach(() => restoreEnvFeaturesForTest(saved));

/** A localStorage stand-in. */
const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

const at = (search: string, host = 'localhost') => ({ host, search });

describe('the gate', () => {
  it('knows a preview deploy by its host, and nothing else', () => {
    expect(isPreviewHost('claude-laughing-cannon-yoyw8q.3d-chess.pages.dev')).toBe(true);
    expect(isPreviewHost('5f2a91c0.3d-chess.pages.dev')).toBe(true);
    expect(isPreviewHost('3d-chess.pages.dev')).toBe(false);
    expect(isPreviewHost('chess.example.com')).toBe(false);
    expect(isPreviewHost('evil3d-chess.pages.dev.example.com')).toBe(false);
    expect(isPreviewHost('localhost')).toBe(false);
  });

  it('turns on for a preview host or ?env / ?envpanel, and the menu stays off with envpanel=0', () => {
    expect(envPreviewOn(null)).toBe(false);
    expect(envPreviewOn(at(''))).toBe(false);
    expect(envPreviewOn(at('?game=1'))).toBe(false);
    expect(envPreviewOn(at('', 'abc.3d-chess.pages.dev'))).toBe(true);
    expect(envPreviewOn(at('?env=sky:bold'))).toBe(true);
    expect(envPreviewOn(at('?envpanel'))).toBe(true);
    expect(envPreviewOn(at('?x=1&env='))).toBe(true);
    expect(envPanelOn(at('?env=sky:bold'))).toBe(true);
    expect(envPanelOn(at('?env=sky:bold&envpanel=0'))).toBe(false);
    expect(envPreviewOn(at('?env=sky:bold&envpanel=0'))).toBe(true);
    expect(envPanelOn(at(''))).toBe(false);
    expect(envPanelOn(at('', 'abc.3d-chess.pages.dev'))).toBe(true);
  });

  it('reads the page it was loaded on (the test page: no preview)', () => {
    expect(envPreviewOn()).toBe(false);
    expect(envPanelOn()).toBe(false);
  });
});

describe('parseEnvQuery', () => {
  it('reads pairs, the whole-list words, and ignores the rest', () => {
    expect(parseEnvQuery('')).toEqual({ all: null, pairs: new Map() });
    expect(parseEnvQuery('?env=sky:bold,mist:off')).toEqual({
      all: null,
      pairs: new Map([
        ['sky', 'bold'],
        ['mist', 'off'],
      ]),
    });
    expect(parseEnvQuery('?env=sky:bold,baseline,mist:on')).toEqual({
      all: 'baseline',
      pairs: new Map([['mist', 'on']]),
    });
    expect(parseEnvQuery('?env=recommended')).toEqual({ all: 'recommended', pairs: new Map() });
    expect(parseEnvQuery('?env=nonsense,:x,,sky:')).toEqual({
      all: null,
      pairs: new Map([['sky', '']]),
    });
    // As a browser leaves it after encoding
    expect(parseEnvQuery('?env=sky%3Abold%2Cmist%3Aoff').pairs.get('mist')).toBe('off');
  });
});

describe('the store', () => {
  it('gives every feature its default while the preview is off, whatever the address or storage say', () => {
    const storage = memory({ [ENV_STORAGE_KEY]: JSON.stringify({ sky: 'bold' }) });
    const store = createEnvStore({ start: at('?game=1'), storage });
    expect(store.enabled).toBe(false);
    expect(store.get('sky')).toBe('soft');
    expect(store.get('mist')).toBe('on');
  });

  it('takes the address over the remembered choice over the default', () => {
    const storage = memory({ [ENV_STORAGE_KEY]: JSON.stringify({ sky: 'bold', mist: 'off' }) });
    const store = createEnvStore({ start: at('?env=sky:off'), storage });
    expect(store.get('sky')).toBe('off');
    expect(store.get('mist')).toBe('off');
    expect(store.get('meteor')).toBe('on');
  });

  it('sets every feature to its baseline with ?env=baseline, pairs after it winning', () => {
    const storage = memory({ [ENV_STORAGE_KEY]: JSON.stringify({ mist: 'off' }) });
    const store = createEnvStore({ start: at('?env=baseline'), storage });
    expect([store.get('sky'), store.get('mist'), store.get('meteor')]).toEqual([
      'off',
      'off',
      'on',
    ]);
    const mixed = createEnvStore({ start: at('?env=baseline,sky:bold'), storage: null });
    expect(mixed.get('sky')).toBe('bold');
    expect(mixed.get('mist')).toBe('off');
    const recommended = createEnvStore({ start: at('?env=recommended'), storage });
    expect(recommended.get('mist')).toBe('on');
  });

  it('ignores an option or a feature it does not know', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createEnvStore({ start: at('?env=sky:neon,ghost:on'), storage: null });
    expect(store.get('sky')).toBe('soft');
    expect(store.get('ghost')).toBe('off');
    expect(store.get('ghost')).toBe('off');
    // Said once
    expect(errors).toHaveBeenCalledTimes(1);
    store.set('sky', 'neon');
    store.set('ghost', 'on');
    expect(store.get('sky')).toBe('soft');
    errors.mockRestore();
  });

  it('remembers a choice, which replaces the address for that feature', () => {
    const storage = memory();
    const store = createEnvStore({ start: at('?env=baseline,mist:off'), storage });
    const heard = vi.fn();
    store.subscribe(heard);
    const v = store.version();
    store.set('mist', 'on');
    store.set('sky', 'bold');
    expect(store.get('mist')).toBe('on');
    expect(store.get('sky')).toBe('bold');
    // The rest still as the address said
    expect(store.get('meteor')).toBe('on');
    expect(heard).toHaveBeenCalledTimes(2);
    expect(store.version()).toBe(v + 2);
    // Only what differs from the default is kept
    expect(JSON.parse(storage.data.get(ENV_STORAGE_KEY)!)).toEqual({ sky: 'bold' });
    // A new page on a plain address finds it
    const later = createEnvStore({ start: at('?envpanel'), storage });
    expect(later.get('sky')).toBe('bold');
  });

  it('compares with main: every feature at its baseline, the choices kept', () => {
    const store = createEnvStore({ start: at('?env=sky:bold'), storage: null });
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    store.setCompare(true);
    store.setCompare(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.compare()).toBe(true);
    expect([store.get('sky'), store.get('mist'), store.get('meteor')]).toEqual([
      'off',
      'off',
      'on',
    ]);
    expect(store.choice('sky')).toBe('bold');
    expect(store.choice('ghost')).toBe('off');
    expect(store.query()).toBe('baseline');
    store.setCompare(false);
    expect(store.get('sky')).toBe('bold');
    stop();
    store.setCompare(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('writes every value as ?env= takes it, which reads back the same', () => {
    const store = createEnvStore({ start: at('?env=sky:bold,mist:off'), storage: null });
    const query = store.query();
    expect(query).toBe('sky:bold,mist:off,meteor:on');
    const again = createEnvStore({ start: at(`?env=${query}`), storage: null });
    for (const f of envFeatures()) expect(again.get(f.id)).toBe(store.get(f.id));
  });

  it('resets to the recommended choices, forgetting the address and storage', () => {
    const storage = memory({ [ENV_STORAGE_KEY]: JSON.stringify({ mist: 'off' }) });
    const store = createEnvStore({ start: at('?env=baseline'), storage });
    store.setCompare(true);
    store.reset();
    expect(store.compare()).toBe(false);
    expect([store.get('sky'), store.get('mist'), store.get('meteor')]).toEqual([
      'soft',
      'on',
      'on',
    ]);
    expect(storage.data.has(ENV_STORAGE_KEY)).toBe(false);
  });

  it('goes on without storage: reads that throw, junk, writes that throw', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const store = createEnvStore({ start: at('?envpanel'), storage: throwing });
    expect(store.get('sky')).toBe('soft');
    store.set('sky', 'bold');
    expect(store.get('sky')).toBe('bold');
    store.reset();
    expect(store.get('sky')).toBe('soft');
    for (const junk of [
      '{nope',
      '[1,2]',
      'null',
      '"sky"',
      JSON.stringify({ sky: 3, mist: 'off' }),
    ]) {
      const s = createEnvStore({
        start: at('?envpanel'),
        storage: memory({ [ENV_STORAGE_KEY]: junk }),
      });
      expect(s.get('sky')).toBe('soft');
    }
    const partly = createEnvStore({
      start: at('?envpanel'),
      storage: memory({ [ENV_STORAGE_KEY]: JSON.stringify({ sky: 3, mist: 'off' }) }),
    });
    expect(partly.get('mist')).toBe('off');
  });
});

describe('defineEnvFeature', () => {
  const base = {
    id: 'x',
    label: 'X',
    group: 'Sky',
    options: [
      { id: 'off', label: 'Off' },
      { id: 'on', label: 'On' },
    ],
    default: 'on',
  };

  it('refuses a feature the menu or the address could not carry', () => {
    expect(() => defineEnvFeature({ ...base, id: 'has space' })).toThrow(/id/);
    expect(() => defineEnvFeature({ ...base, options: [] })).toThrow(/no options/);
    expect(() =>
      defineEnvFeature({ ...base, options: [...base.options, { id: 'a:b', label: '?' }] }),
    ).toThrow(/option/);
    expect(() =>
      defineEnvFeature({ ...base, options: [...base.options, { id: 'on', label: 'Again' }] }),
    ).toThrow(/share/);
    expect(() => defineEnvFeature({ ...base, default: 'loud' })).toThrow(/default/);
    expect(() =>
      defineEnvFeature({ ...base, options: [{ id: 'a', label: 'A' }], default: 'a' }),
    ).toThrow(/baseline/);
  });

  it('replaces a feature declared again, and lists them by group, order and label', () => {
    defineEnvFeature({ ...base, id: 'zeta', label: 'Zeta', group: 'Weather' });
    defineEnvFeature({ ...base, id: 'alpha', label: 'Alpha', group: 'Weather' });
    defineEnvFeature({ ...base, id: 'aaa', label: 'Z', group: 'Sky', order: -1 });
    defineEnvFeature({ ...base, id: 'sky', label: 'Sky again', group: 'Sky' });
    expect(envFeatures().map((f) => f.id)).toEqual([
      'aaa',
      'sky',
      'mist',
      'meteor',
      'alpha',
      'zeta',
    ]);
    expect(envFeatures().find((f) => f.id === 'sky')!.label).toBe('Sky again');
  });
});
