import { useSyncExternalStore } from 'react';
import { settingSpecs } from './scene/settings';

// The player's settings for how the board looks: the values the scene reads
// (useSetting) and the settings panel edits. The scene declares them, each
// with its default (scene/settings.ts); the player's choices are kept in
// this browser. Nothing here is game state, and nothing reaches the opponent.

export type SettingValue = boolean | number | string;

interface SettingBase {
  /** Stable id, the key the scene reads the value by and it is stored under. */
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

/** Settings in the panel's order: groups as they first appear, each group's settings as declared. */
export const settingGroups = (specs: readonly SettingSpec[]) => {
  const groups = new Map<string, SettingSpec[]>();
  for (const spec of specs) {
    const group = groups.get(spec.group);
    if (group) group.push(spec);
    else groups.set(spec.group, [spec]);
  }
  return [...groups].map(([label, settings]) => ({ label, settings }));
};

/** How a slider's value reads beside it: its own format, else as many decimals as its step. */
export const formatSetting = (
  spec: Extract<SettingSpec, { kind: 'slider' }>,
  value: number,
): string => {
  if (spec.format) return spec.format(value);
  const step = String(spec.step);
  const decimals = step.includes('.') ? Math.min(step.length - step.indexOf('.') - 1, 4) : 0;
  return value.toFixed(decimals);
};

const STORAGE_KEY = '3dchess:settings';

interface Store {
  /** The player's choices that differ from the defaults. */
  chosen: SettingValues;
  /** Defaults merged with the choices; replaced (never mutated) on change. */
  snapshot: SettingValues;
  listeners: Set<() => void>;
}

let store: Store | null = null;

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

const defaults = (): SettingValues =>
  Object.fromEntries(settingSpecs().map((s) => [s.key, s.default]));

const load = (): SettingValues => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const chosen: SettingValues = {};
    for (const spec of settingSpecs()) {
      const value = (parsed as Record<string, unknown>)[spec.key];
      if (fits(spec, value) && value !== spec.default) chosen[spec.key] = value;
    }
    return chosen;
  } catch {
    return {};
  }
};

const save = (chosen: SettingValues) => {
  try {
    if (Object.keys(chosen).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen));
  } catch {
    // Storage blocked or full: the choice still holds for this visit
  }
};

/** The store, read from this browser on first use. */
const current = (): Store => {
  if (!store) {
    const chosen = load();
    store = { chosen, snapshot: { ...defaults(), ...chosen }, listeners: new Set() };
  }
  return store;
};

const publish = (s: Store) => {
  s.snapshot = { ...defaults(), ...s.chosen };
  save(s.chosen);
  s.listeners.forEach((listener) => listener());
};

/** Every setting: its default, overridden by the player's choice. */
export const getSettings = (): SettingValues => current().snapshot;

/** Sets one setting (ignored if the value doesn't fit it). */
export const setSetting = (key: string, value: SettingValue) => {
  const spec = settingSpecs().find((s) => s.key === key);
  if (!spec || !fits(spec, value)) return;
  const s = current();
  const chosen = { ...s.chosen };
  if (value === spec.default) delete chosen[key];
  else chosen[key] = value;
  s.chosen = chosen;
  publish(s);
};

/** Puts every setting back to its default. */
export const resetSettings = () => {
  const s = current();
  s.chosen = {};
  publish(s);
};

/** The number of settings the player has changed. */
export const changedSettingCount = () => Object.keys(current().chosen).length;

/** Every setting, re-rendering the caller when one changes. */
export function useSettings(): SettingValues {
  const s = current();
  return useSyncExternalStore(
    (listener) => {
      s.listeners.add(listener);
      return () => s.listeners.delete(listener);
    },
    () => s.snapshot,
  );
}

/**
 * One setting, by key. Components that only read it inside useFrame should
 * also request a frame when it changes (the canvas renders on demand):
 * `useEffect(() => invalidate(), [value])`.
 */
export function useSetting<T extends SettingValue>(key: string): T {
  return useSettings()[key] as T;
}

/** Forgets the settings read so far, so the next use reads this browser's again (tests). */
export const forgetSettings = () => {
  store = null;
};
