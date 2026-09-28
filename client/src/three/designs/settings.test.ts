import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import testDesign from './testDesign';
import type { Design } from './types';
import {
  changedSettingCount,
  formatSetting,
  getDesignSettings,
  resetDesignSettings,
  resetSettingStores,
  setDesignSetting,
  settingGroups,
  useSettingsOf,
} from './settings';

const design: Design = {
  ...testDesign,
  id: 'settings-test',
  settings: [
    { kind: 'toggle', key: 'stars', label: 'Stars', group: 'World', default: true },
    {
      kind: 'slider',
      key: 'glow',
      label: 'Glow',
      group: 'World',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.1,
    },
    {
      kind: 'choice',
      key: 'capture',
      label: 'Capture',
      group: 'Markers',
      default: 'arcs',
      options: [
        { value: 'arcs', label: 'Arcs' },
        { value: 'ember', label: 'Ember' },
      ],
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  resetSettingStores();
});
afterEach(() => localStorage.clear());

describe('design settings', () => {
  it('starts from the design’s defaults', () => {
    expect(getDesignSettings(design)).toEqual({ stars: true, glow: 0.5, capture: 'arcs' });
    expect(changedSettingCount(design)).toBe(0);
  });

  it('keeps a choice for the design in this browser, and forgets one set back to its default', () => {
    setDesignSetting(design, 'glow', 0.8);
    setDesignSetting(design, 'capture', 'ember');
    expect(changedSettingCount(design)).toBe(2);
    resetSettingStores();
    expect(getDesignSettings(design)).toMatchObject({ glow: 0.8, capture: 'ember' });
    setDesignSetting(design, 'glow', 0.5);
    expect(JSON.parse(localStorage.getItem('design-settings:settings-test')!)).toEqual({
      capture: 'ember',
    });
  });

  it('ignores values that do not fit the setting, stored or set', () => {
    localStorage.setItem(
      'design-settings:settings-test',
      JSON.stringify({ stars: 'yes', glow: 7, capture: 'gone', stale: 1 }),
    );
    expect(getDesignSettings(design)).toEqual({ stars: true, glow: 0.5, capture: 'arcs' });
    setDesignSetting(design, 'glow', -1);
    setDesignSetting(design, 'nope', true);
    expect(getDesignSettings(design)).toEqual({ stars: true, glow: 0.5, capture: 'arcs' });
  });

  it('resets every setting, and re-renders its readers on each change', () => {
    const { result } = renderHook(() => useSettingsOf(design));
    act(() => setDesignSetting(design, 'stars', false));
    expect(result.current.stars).toBe(false);
    act(() => resetDesignSettings(design));
    expect(result.current).toEqual({ stars: true, glow: 0.5, capture: 'arcs' });
    expect(localStorage.getItem('design-settings:settings-test')).toBeNull();
  });
});

describe('the settings panel’s order and readouts', () => {
  it('gathers groups as they first appear, each group’s settings as declared', () => {
    const [stars, glow, capture] = design.settings!;
    const specs = [stars, capture, { ...glow, key: 'haze' }, glow];
    expect(settingGroups(specs).map((g) => [g.label, g.settings.map((s) => s.key)])).toEqual([
      ['World', ['stars', 'haze', 'glow']],
      ['Markers', ['capture']],
    ]);
  });

  it('reads a slider with its design’s format, else to its step’s decimals', () => {
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
