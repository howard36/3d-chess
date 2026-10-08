// ENV PREVIEW (temporary): the settings store. No three.js here: the scene,
// the menu and tests all read it.
//
// A feature's value is, first to last:
//   - its baseline, while "Baseline (main)" is on in the menu (compare);
//   - the address the page was opened at, `?env=feature:option,…` (the words
//     `baseline` or `recommended` in the list set every feature to its
//     baseline or default, and the pairs after them win);
//   - what was last chosen on the menu (localStorage);
//   - the feature's default (its recommended choice).
// Choosing on the menu replaces the address's value for that feature. With
// the preview off (production, e2e on localhost) every feature is its
// default and neither the address nor localStorage is read.

import { envPreviewOn, envStart } from './gate';
import type { EnvStart } from './gate';
import { baselineOf, envFeature, envFeatures } from './registry';
import type { EnvFeature } from './registry';

export const ENV_STORAGE_KEY = '3dchess:env-preview';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** `?env=…` as written: the whole-list words and the feature:option pairs, in order. */
export interface EnvQuery {
  all: 'baseline' | 'recommended' | null;
  pairs: Map<string, string>;
}

/** Reads `env` from a query string (`?env=baseline,sky:aurora`). Unknown words are ignored. */
export const parseEnvQuery = (search: string): EnvQuery => {
  const query: EnvQuery = { all: null, pairs: new Map() };
  const raw = new URLSearchParams(search).get('env');
  if (!raw) return query;
  for (const part of raw.split(/[,;\s]+/)) {
    const word = part.trim();
    if (!word) continue;
    if (word === 'baseline' || word === 'recommended') {
      // Pairs before the word are overruled by it
      query.all = word;
      query.pairs.clear();
      continue;
    }
    const at = word.indexOf(':');
    if (at > 0) query.pairs.set(word.slice(0, at), word.slice(at + 1));
  }
  return query;
};

export interface EnvStore {
  /** A feature's value now (its default for an unknown option; 'off' for an unknown feature). */
  get(id: string): string;
  /** As get, but what is chosen even while comparing (the menu shows it). */
  choice(id: string): string;
  /** Chooses an option for a feature (remembered on this device). */
  set(id: string, option: string): void;
  /** Every feature back to its default; forgets the menu's choices and the address's. */
  reset(): void;
  /** Shows every feature at its baseline (today's main) while on. */
  setCompare(on: boolean): void;
  compare(): boolean;
  /** Changes with every change of any value: a snapshot for "something changed". */
  version(): number;
  subscribe(listener: () => void): () => void;
  /** Every feature's value as `?env=` takes it: `a:x,b:y` (or `baseline` while comparing). */
  query(): string;
  /** The preview is on: the address and the menu count. */
  readonly enabled: boolean;
}

export interface EnvStoreInit {
  /** Where the page was opened (the query is read once). */
  start: EnvStart | null;
  /** Remembers the menu's choices; any failure (private mode, quota) is ignored. */
  storage: Storage | null;
  /** Overrides the gate (tests). */
  enabled?: boolean;
}

const valid = (f: EnvFeature, option: string | undefined): option is string =>
  option !== undefined && f.options.some((o) => o.id === option);

export function createEnvStore({ start, storage, enabled: on }: EnvStoreInit): EnvStore {
  const enabled = on ?? envPreviewOn(start);
  const read = (): Record<string, string> => {
    if (!enabled || !storage) return {};
    try {
      const value: unknown = JSON.parse(storage.getItem(ENV_STORAGE_KEY) ?? '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'),
      );
    } catch {
      return {};
    }
  };
  const write = () => {
    if (!storage) return;
    try {
      if (Object.keys(chosen).length) storage.setItem(ENV_STORAGE_KEY, JSON.stringify(chosen));
      else storage.removeItem(ENV_STORAGE_KEY);
    } catch {
      // Not remembered: the choice still holds for this page
    }
  };
  let chosen = read();
  const url = enabled && start ? parseEnvQuery(start.search) : parseEnvQuery('');
  /** Features chosen on the menu since: the address's whole-list word no longer applies. */
  const overruled = new Set<string>();
  let comparing = false;
  let version = 0;
  const listeners = new Set<() => void>();
  const warned = new Set<string>();
  const emit = () => {
    version++;
    for (const l of [...listeners]) l();
  };

  const value = (f: EnvFeature, compared = comparing): string => {
    if (!enabled) return f.default;
    if (compared) return baselineOf(f);
    const fromUrl = url.pairs.get(f.id);
    if (valid(f, fromUrl)) return fromUrl;
    if (url.all && !overruled.has(f.id)) return url.all === 'baseline' ? baselineOf(f) : f.default;
    const mine = chosen[f.id];
    return valid(f, mine) ? mine : f.default;
  };

  return {
    enabled,
    get(id) {
      const f = envFeature(id);
      if (f) return value(f);
      if (!warned.has(id)) {
        warned.add(id);
        console.error(`env preview: no feature "${id}" (declare it in src/envPreview/features)`);
      }
      return 'off';
    },
    choice(id) {
      const f = envFeature(id);
      return f ? value(f, false) : 'off';
    },
    set(id, option) {
      const f = envFeature(id);
      if (!f || !valid(f, option)) return;
      url.pairs.delete(id);
      overruled.add(id);
      if (option === f.default) delete chosen[id];
      else chosen[id] = option;
      write();
      emit();
    },
    reset() {
      chosen = {};
      url.pairs.clear();
      url.all = null;
      overruled.clear();
      comparing = false;
      write();
      emit();
    },
    setCompare(next) {
      if (next === comparing) return;
      comparing = next;
      emit();
    },
    compare: () => comparing,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    query: () =>
      comparing
        ? 'baseline'
        : envFeatures()
            .map((f) => `${f.id}:${value(f)}`)
            .join(','),
  };
}

const localStore = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The page's store. */
export let envStore: EnvStore = createEnvStore({ start: envStart, storage: localStore() });

/** For tests: the page's store replaced (returns the one it replaced). */
export const replaceEnvStoreForTest = (next: EnvStore) => {
  const before = envStore;
  envStore = next;
  return before;
};
