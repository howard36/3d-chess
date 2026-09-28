import { useSyncExternalStore } from 'react';
import { useDesign } from './context';
import type { Design } from './types';

// A design's player-adjustable visual settings: the values a design reads
// (useDesignSetting) and the settings panel edits. Each design declares its
// settings (Design.settings) with their defaults; the player's choices are
// kept per design in this browser. Nothing here is game state.

export type SettingValue = boolean | number | string;

interface SettingBase {
  /** Stable id, the key a design reads the value by. */
  key: string;
  label: string;
  /** Heading the panel lists it under. */
  group: string;
  /** One line on what it changes, shown under the control. */
  hint?: string;
}

export type SettingSpec =
  | (SettingBase & { kind: 'toggle'; default: boolean })
  | (SettingBase & {
      kind: 'slider';
      default: number;
      min: number;
      max: number;
      step: number;
      /** How the value reads beside the slider (default: the number). */
      format?: (value: number) => string;
    })
  | (SettingBase & {
      kind: 'choice';
      default: string;
      options: { value: string; label: string }[];
    });

export type SettingValues = Record<string, SettingValue>;

/** A design's settings in the panel's order: groups as they first appear, each group's settings as declared. */
export const settingGroups = (specs: readonly SettingSpec[]) => {
  const groups = new Map<string, SettingSpec[]>();
  for (const spec of specs) {
    const group = groups.get(spec.group);
    if (group) group.push(spec);
    else groups.set(spec.group, [spec]);
  }
  return [...groups].map(([label, settings]) => ({ label, settings }));
};

/** How a slider's value reads beside it: the design's format, else as many decimals as its step. */
export const formatSetting = (
  spec: Extract<SettingSpec, { kind: 'slider' }>,
  value: number,
): string => {
  if (spec.format) return spec.format(value);
  const step = String(spec.step);
  const decimals = step.includes('.') ? Math.min(step.length - step.indexOf('.') - 1, 4) : 0;
  return value.toFixed(decimals);
};

const STORAGE_PREFIX = 'design-settings:';

interface Store {
  /** The player's choices that differ from the defaults. */
  chosen: SettingValues;
  /** Defaults merged with the choices; replaced (never mutated) on change. */
  snapshot: SettingValues;
  listeners: Set<() => void>;
}

const stores = new Map<string, Store>();

/** A stored value that still fits its setting (a renamed option or narrowed range drops out). */
const fits = (spec: SettingSpec, value: unknown): value is SettingValue => {
  switch (spec.kind) {
    case 'toggle':
      return typeof value === 'boolean';
    case 'slider':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= spec.min &&
        value <= spec.max
      );
    case 'choice':
      return typeof value === 'string' && spec.options.some((o) => o.value === value);
  }
};

const defaultsOf = (specs: readonly SettingSpec[]): SettingValues =>
  Object.fromEntries(specs.map((s) => [s.key, s.default]));

const load = (design: Design): SettingValues => {
  const specs = design.settings ?? [];
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + design.id);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const chosen: SettingValues = {};
    for (const spec of specs) {
      const value = (parsed as Record<string, unknown>)[spec.key];
      if (fits(spec, value) && value !== spec.default) chosen[spec.key] = value;
    }
    return chosen;
  } catch {
    return {};
  }
};

const save = (design: Design, chosen: SettingValues) => {
  try {
    if (Object.keys(chosen).length === 0) localStorage.removeItem(STORAGE_PREFIX + design.id);
    else localStorage.setItem(STORAGE_PREFIX + design.id, JSON.stringify(chosen));
  } catch {
    // Storage blocked or full: the choice still holds for this visit
  }
};

const storeFor = (design: Design): Store => {
  let store = stores.get(design.id);
  if (!store) {
    const chosen = load(design);
    store = {
      chosen,
      snapshot: { ...defaultsOf(design.settings ?? []), ...chosen },
      listeners: new Set(),
    };
    stores.set(design.id, store);
  }
  return store;
};

const publish = (design: Design, store: Store) => {
  store.snapshot = { ...defaultsOf(design.settings ?? []), ...store.chosen };
  save(design, store.chosen);
  store.listeners.forEach((listener) => listener());
};

/** The design's settings: its defaults, overridden by the player's choices. */
export const getDesignSettings = (design: Design): SettingValues => storeFor(design).snapshot;

/** Sets one of a design's settings (ignored if the value doesn't fit it). */
export const setDesignSetting = (design: Design, key: string, value: SettingValue) => {
  const spec = design.settings?.find((s) => s.key === key);
  if (!spec || !fits(spec, value)) return;
  const store = storeFor(design);
  const chosen = { ...store.chosen };
  if (value === spec.default) delete chosen[key];
  else chosen[key] = value;
  store.chosen = chosen;
  publish(design, store);
};

/** Puts every one of a design's settings back to its default. */
export const resetDesignSettings = (design: Design) => {
  const store = storeFor(design);
  store.chosen = {};
  publish(design, store);
};

/** The number of a design's settings the player has changed. */
export const changedSettingCount = (design: Design) => Object.keys(storeFor(design).chosen).length;

/** Every setting of `design`, re-rendering the caller when one changes. */
export function useSettingsOf(design: Design): SettingValues {
  const store = storeFor(design);
  return useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => store.snapshot,
  );
}

/** Every setting of the current design (DesignContext). */
export const useDesignSettings = (): SettingValues => useSettingsOf(useDesign());

/**
 * One setting of the current design, by key. Components that only read it
 * inside useFrame should also request a frame when it changes (the canvas
 * renders on demand): `useEffect(() => invalidate(), [value])`.
 */
export function useDesignSetting<T extends SettingValue>(key: string): T {
  return useDesignSettings()[key] as T;
}

/** Forgets every loaded store (tests). */
export const resetSettingStores = () => stores.clear();
