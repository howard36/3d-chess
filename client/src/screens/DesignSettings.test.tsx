import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type React from 'react';
import { DesignContext } from '../three/designs/context';
import testDesign from '../three/designs/testDesign';
import zenith from '../three/designs/zenith';
import type { Design } from '../three/designs/types';
import { getDesignSettings, resetSettingStores, setDesignSetting } from '../three/designs/settings';
import DesignSettings, { SettingsPanel } from './DesignSettings';

// A design with one of every kind of control, its groups interleaved to
// show they are gathered in the order they first appear
const design: Design = {
  ...testDesign,
  id: 'panel-test',
  name: 'Panel Test',
  settings: [
    {
      kind: 'toggle',
      key: 'stars',
      label: 'Stars',
      group: 'Sky',
      default: true,
      hint: 'Constellations of chess pieces overhead.',
    },
    {
      kind: 'choice',
      key: 'capture',
      label: 'Capture mark',
      group: 'Markers',
      default: 'ring',
      options: [
        { value: 'ring', label: 'Ring' },
        { value: 'ember', label: 'Ember' },
        { value: 'none', label: 'None' },
      ],
    },
    {
      kind: 'slider',
      key: 'glow',
      label: 'Glow',
      group: 'Sky',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.1,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'choice',
      key: 'palette',
      label: 'Palette',
      group: 'Markers',
      default: 'dawn',
      options: ['dawn', 'noon', 'dusk', 'night', 'aurora'].map((v) => ({ value: v, label: v })),
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  resetSettingStores();
});
afterEach(() => localStorage.clear());

const panel = () => render(<SettingsPanel design={design} id="settings" onClose={() => {}} />);

/** The gear (and whatever else is given) in a page drawn in `given`. */
const page = (children: React.ReactNode = <DesignSettings />, given: Design = design) =>
  render(<DesignContext.Provider value={given}>{children}</DesignContext.Provider>);

describe('SettingsPanel', () => {
  it('lists every setting under its group, in the order declared', () => {
    panel();
    const groups = screen.getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby'))).toHaveLength(2);
    expect(within(groups[0]).getByRole('heading').textContent).toBe('Sky');
    expect(within(groups[1]).getByRole('heading').textContent).toBe('Markers');
    // Sky: the toggle, then the slider, though the slider was declared after a Markers choice
    expect(within(groups[0]).getByRole('switch', { name: 'Stars' })).toBeInTheDocument();
    expect(within(groups[0]).getByRole('slider', { name: 'Glow' })).toBeInTheDocument();
    expect(within(groups[1]).getByRole('radiogroup', { name: 'Capture mark' })).toBeInTheDocument();
    // More than four options: a drop-down
    expect(within(groups[1]).getByRole('combobox', { name: 'Palette' })).toBeInTheDocument();
    // The hint describes its control
    expect(screen.getByRole('switch', { name: 'Stars' })).toHaveAccessibleDescription(
      'Constellations of chess pieces overhead.',
    );
    expect(screen.getByRole('region', { name: 'Panel Test settings' })).toBeInTheDocument();
  });

  it('applies each change at once, to the store', () => {
    panel();
    const stars = screen.getByRole('switch', { name: 'Stars' });
    expect(stars).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(stars);
    expect(getDesignSettings(design).stars).toBe(false);
    expect(stars).toHaveAttribute('aria-checked', 'false');

    const glow = screen.getByRole('slider', { name: 'Glow' });
    expect(glow).toHaveAttribute('aria-valuetext', '50%');
    fireEvent.change(glow, { target: { value: '0.8' } });
    expect(getDesignSettings(design).glow).toBe(0.8);
    // The formatted value reads beside the slider
    expect(screen.getByText('80%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Ember' }));
    expect(getDesignSettings(design).capture).toBe('ember');
    expect(screen.getByRole('radio', { name: 'Ember' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.change(screen.getByRole('combobox', { name: 'Palette' }), {
      target: { value: 'night' },
    });
    expect(getDesignSettings(design).palette).toBe('night');
    expect(screen.getByTestId('settings-changed').textContent).toBe('4 changed');
  });

  it('resets every setting to the design’s defaults, showing how many were changed', () => {
    panel();
    const reset = screen.getByRole('button', { name: 'Reset to defaults' });
    expect(reset).toBeDisabled();
    expect(screen.getByTestId('settings-changed').textContent).toBe('All at their defaults');
    fireEvent.click(screen.getByRole('switch', { name: 'Stars' }));
    fireEvent.click(screen.getByRole('radio', { name: 'None' }));
    const changed = screen.getByRole('button', { name: 'Reset to defaults (2)' });
    expect(changed).toBeEnabled();
    fireEvent.click(changed);
    expect(getDesignSettings(design)).toEqual({
      stars: true,
      glow: 0.5,
      capture: 'ring',
      palette: 'dawn',
    });
    expect(screen.getByRole('switch', { name: 'Stars' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled();
  });
});

describe('DesignSettings (the gear)', () => {
  it('shows nothing for a design without settings', () => {
    const { container } = page(<DesignSettings />, testDesign);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the panel, and closes it on Escape, the gear, or its close button', () => {
    page();
    const gear = screen.getByTestId('design-settings');
    expect(gear).toHaveAccessibleName('Panel Test settings');
    expect(gear).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(gear);
    expect(gear).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByTestId('design-settings-panel');
    expect(gear).toHaveAttribute('aria-controls', region.id);

    // Escape from inside the panel hands the keyboard back to the gear
    screen.getByRole('switch', { name: 'Stars' }).focus();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(screen.queryByTestId('design-settings-panel')).toBeNull();
    expect(gear).toHaveFocus();

    fireEvent.click(gear);
    fireEvent.click(gear);
    expect(screen.queryByTestId('design-settings-panel')).toBeNull();

    fireEvent.click(gear);
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.queryByTestId('design-settings-panel')).toBeNull();
  });

  it('stays open for the board, and closes for anything else in the page', () => {
    page(
      <>
        <canvas data-testid="board" />
        <button type="button">Elsewhere</button>
        <DesignSettings />
      </>,
    );
    const gear = screen.getByTestId('design-settings');
    fireEvent.click(gear);
    // Controls inside take the pointer without closing it
    fireEvent.pointerDown(screen.getByRole('switch', { name: 'Stars' }));
    fireEvent.pointerDown(screen.getByTestId('board'));
    expect(screen.getByTestId('design-settings-panel')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByTestId('design-settings-panel')).toBeNull();
  });

  it('marks the gear while anything differs from the defaults', () => {
    page();
    const gear = screen.getByTestId('design-settings');
    fireEvent.click(gear);
    fireEvent.click(screen.getByRole('switch', { name: 'Stars' }));
    expect(gear).toHaveAccessibleName('Panel Test settings (1 changed)');
  });

  it('opens under the gear, inside the window, scrolling when it runs long', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 44,
      left: 150,
      right: 190,
      width: 40,
      height: 34,
      x: 150,
      y: 10,
      toJSON: () => ({}),
    });
    const width = window.innerWidth;
    const height = window.innerHeight;
    Object.assign(window, { innerWidth: 360, innerHeight: 640 });
    try {
      page();
      fireEvent.click(screen.getByTestId('design-settings'));
      const style = screen.getByTestId('design-settings-panel').style;
      expect(style.position).toBe('fixed');
      expect(style.top).toBe('50px');
      // 320 wide, pulled in from the gear's right edge so it stays 10 px off the left
      expect(style.width).toBe('320px');
      expect(style.right).toBe('30px');
      expect(parseFloat(style.maxHeight)).toBeLessThanOrEqual(640 - 50 - 12);
      expect(style.overflowY).toBe('auto');
    } finally {
      Object.assign(window, { innerWidth: width, innerHeight: height });
      vi.restoreAllMocks();
    }
  });
});

describe("Zenith's settings", () => {
  it('lists how knights move under Pieces, straight by default, and hands the board the choice', () => {
    render(<SettingsPanel design={zenith} id="zenith" onClose={() => {}} />);
    const pieces = screen.getByRole('group', { name: 'Pieces' });
    const knights = within(pieces).getByRole('radiogroup', { name: 'Knight moves' });
    expect(within(knights).getByRole('radio', { name: 'Straight' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(zenith.knightMoves?.(getDesignSettings(zenith))).toBe('straight');

    fireEvent.click(within(knights).getByRole('radio', { name: 'Arc' }));
    expect(zenith.knightMoves?.(getDesignSettings(zenith))).toBe('arc');
    act(() => setDesignSetting(zenith, 'piece.knightMoves', 'straight'));
    expect(zenith.knightMoves?.(getDesignSettings(zenith))).toBe('straight');
  });
});
