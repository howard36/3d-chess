import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import classic from './classic';
import type { Design } from './types';
import {
  changedSettingCount,
  getDesignSettings,
  resetDesignSettings,
  resetSettingStores,
  setDesignSetting,
  useSettingsOf,
} from './settings';

const design: Design = {
  ...classic,
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
