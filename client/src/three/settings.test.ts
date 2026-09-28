import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { settingSpecs } from './scene/settings';
import {
  changedSettingCount,
  forgetSettings,
  formatSetting,
  getSettings,
  resetSettings,
  setSetting,
  settingGroups,
  useSettings,
} from './settings';
import type { SettingSpec } from './settings';

// Three of the board's settings, one of each kind
const TOGGLE = 'piece.particles';
const SLIDER = 'piece.darkTone';
const CHOICE = 'piece.levelCue';
const spec = (key: string) => settingSpecs().find((s) => s.key === key)!;
const STORAGE_KEY = '3dchess:settings';

beforeEach(() => {
  localStorage.clear();
  forgetSettings();
});
afterEach(() => localStorage.clear());

describe('the board’s settings', () => {
  it('declares every setting once, and starts from their defaults', () => {
    const keys = settingSpecs().map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(getSettings()).toEqual(
      Object.fromEntries(settingSpecs().map((s) => [s.key, s.default])),
    );
    expect([spec(TOGGLE).kind, spec(SLIDER).kind, spec(CHOICE).kind]).toEqual([
      'toggle',
      'slider',
      'choice',
    ]);
    expect(changedSettingCount()).toBe(0);
  });

  it('keeps a choice in this browser, and forgets one set back to its default', () => {
    setSetting(SLIDER, 1.2);
    setSetting(CHOICE, 'ring');
    expect(changedSettingCount()).toBe(2);
    forgetSettings();
    expect(getSettings()).toMatchObject({ [SLIDER]: 1.2, [CHOICE]: 'ring' });
    setSetting(SLIDER, spec(SLIDER).default);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ [CHOICE]: 'ring' });
  });

  it('ignores values that do not fit the setting, stored or set', () => {
    const defaults = getSettings();
    forgetSettings();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ [TOGGLE]: 'yes', [SLIDER]: 7, [CHOICE]: 'gone', stale: 1 }),
    );
    expect(getSettings()).toEqual(defaults);
    setSetting(SLIDER, -1);
    setSetting(CHOICE, 'gone');
    setSetting('nope', true);
    expect(getSettings()).toEqual(defaults);
  });

  it('resets every setting, and re-renders its readers on each change', () => {
    const defaults = getSettings();
    const { result } = renderHook(() => useSettings());
    act(() => setSetting(TOGGLE, !spec(TOGGLE).default));
    expect(result.current[TOGGLE]).toBe(!spec(TOGGLE).default);
    act(() => resetSettings());
    expect(result.current).toEqual(defaults);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('the settings panel’s order and readouts', () => {
  it('gathers groups as they first appear, each group’s settings as declared', () => {
    const toggle: SettingSpec = {
      kind: 'toggle',
      key: 'a',
      label: 'A',
      group: 'World',
      default: true,
    };
    const choice: SettingSpec = {
      kind: 'choice',
      key: 'b',
      label: 'B',
      group: 'Markers',
      default: 'x',
      options: [{ value: 'x', label: 'X' }],
    };
    const specs = [toggle, choice, { ...toggle, key: 'c' }];
    expect(settingGroups(specs).map((g) => [g.label, g.settings.map((s) => s.key)])).toEqual([
      ['World', ['a', 'c']],
      ['Markers', ['b']],
    ]);
  });

  it('lists the board’s groups board and world first, check last', () => {
    expect(settingGroups(settingSpecs()).map((g) => g.label)).toEqual([
      'Board',
      'World',
      'Pieces',
      'Selection',
      'Markers',
      'Check',
    ]);
  });

  it('reads a slider with its own format, else to its step’s decimals', () => {
    const slider = {
      kind: 'slider' as const,
      key: 'k',
      label: 'K',
      group: 'G',
      default: 0,
      min: 0,
      max: 2,
    };
    expect(formatSetting({ ...slider, step: 0.05 }, 0.5)).toBe('0.50');
    expect(formatSetting({ ...slider, step: 1 }, 2)).toBe('2');
    expect(formatSetting({ ...slider, step: 0.1, format: (v) => `${v}x` }, 1.5)).toBe('1.5x');
  });
});
