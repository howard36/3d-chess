import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { forgetSettings, getSettings, setSetting } from '../three/settings';
import SettingsGear, { SettingsPanel } from './SettingsPanel';

// The panel lists the board's own settings (three/scene/settings.ts); these
// tests use a few of them, one of every kind of control.

beforeEach(() => {
  localStorage.clear();
  forgetSettings();
});
afterEach(() => localStorage.clear());

/** The panel, with every group unfolded (only Play and Board start open). */
const panel = () => {
  const view = render(<SettingsPanel id="settings" onClose={() => {}} />);
  for (const heading of screen.queryAllByRole('button', { expanded: false })) {
    fireEvent.click(heading);
  }
  return view;
};
const group = (name: string) => screen.getByRole('group', { name });

describe('SettingsPanel', () => {
  it('lists every setting under its group, in the order declared', () => {
    panel();
    expect(
      screen.getAllByRole('group').map((g) => within(g).getByRole('heading').textContent),
    ).toEqual(['Play', 'Board', 'World', 'Pieces', 'Selection', 'Markers', 'Check']);
    expect(
      within(group('Selection')).getByRole('switch', { name: 'Glimmering motes' }),
    ).toBeInTheDocument();
    expect(
      within(group('Pieces')).getByRole('slider', { name: 'Dark army tone' }),
    ).toBeInTheDocument();
    expect(
      within(group('Pieces')).getByRole('radiogroup', { name: 'Level cue' }),
    ).toBeInTheDocument();
    // More than four options: a drop-down
    expect(
      within(group('Markers')).getByRole('combobox', { name: 'Capture marker' }),
    ).toBeInTheDocument();
    // The hint describes its control
    expect(screen.getByRole('switch', { name: 'Glimmering motes' })).toHaveAccessibleDescription(
      'Faint motes of light drifting up round a held piece.',
    );
    expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument();
  });

  it('opens with Play and Board unfolded and the rest folded away', () => {
    render(<SettingsPanel id="settings" onClose={() => {}} />);
    const heading = (name: string) => screen.getByRole('button', { name });
    expect(heading('Play')).toHaveAttribute('aria-expanded', 'true');
    expect(heading('Board')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('switch', { name: 'Notation panel' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(heading('Pieces')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('slider', { name: 'Dark army tone' })).not.toBeInTheDocument();
    fireEvent.click(heading('Pieces'));
    expect(screen.getByRole('slider', { name: 'Dark army tone' })).toBeInTheDocument();
    fireEvent.click(heading('Board'));
    expect(heading('Board')).toHaveAttribute('aria-expanded', 'false');
  });

  it('applies each change at once, to the store', () => {
    panel();
    const motes = screen.getByRole('switch', { name: 'Glimmering motes' });
    expect(motes).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(motes);
    expect(getSettings()['piece.particles']).toBe(false);
    expect(motes).toHaveAttribute('aria-checked', 'false');

    const tone = screen.getByRole('slider', { name: 'Dark army tone' });
    expect(tone).toHaveAttribute('aria-valuetext', '0.8×');
    fireEvent.change(tone, { target: { value: '1.2' } });
    expect(getSettings()['piece.darkTone']).toBe(1.2);
    // The formatted value reads beside the slider
    expect(tone).toHaveAttribute('aria-valuetext', '1.2×');
    expect(within(tone.parentElement!).getByText('1.2×')).toBeInTheDocument();

    const cue = screen.getByRole('radiogroup', { name: 'Level cue' });
    fireEvent.click(within(cue).getByRole('radio', { name: 'Ring' }));
    expect(getSettings()['piece.levelCue']).toBe('ring');
    expect(within(cue).getByRole('radio', { name: 'Ring' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Capture marker' }), {
      target: { value: 'ember' },
    });
    expect(getSettings()['mark.captureStyle']).toBe('ember');
    expect(screen.getByTestId('settings-changed').textContent).toBe('4 changed');
  });

  it('resets every setting to its default, showing how many were changed', () => {
    const defaults = getSettings();
    panel();
    const reset = screen.getByRole('button', { name: 'Reset to defaults' });
    expect(reset).toBeDisabled();
    expect(screen.getByTestId('settings-changed').textContent).toBe('All at their defaults');
    fireEvent.click(screen.getByRole('switch', { name: 'Glimmering motes' }));
    const cue = screen.getByRole('radiogroup', { name: 'Level cue' });
    fireEvent.click(within(cue).getByRole('radio', { name: 'Both' }));
    const changed = screen.getByRole('button', { name: 'Reset to defaults (2)' });
    expect(changed).toBeEnabled();
    fireEvent.click(changed);
    expect(getSettings()).toEqual(defaults);
    expect(screen.getByRole('switch', { name: 'Glimmering motes' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled();
  });

  it('lists how knights move under Pieces, straight by default, for the board to read', () => {
    panel();
    const knights = within(group('Pieces')).getByRole('radiogroup', { name: 'Knight moves' });
    expect(within(knights).getByRole('radio', { name: 'Straight' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(getSettings()['piece.knightMoves']).toBe('straight');
    fireEvent.click(within(knights).getByRole('radio', { name: 'Arc' }));
    expect(getSettings()['piece.knightMoves']).toBe('arc');
    act(() => setSetting('piece.knightMoves', 'straight'));
    expect(within(knights).getByRole('radio', { name: 'Straight' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('the settings gear', () => {
  it('opens the panel, and closes it on Escape, the gear, or its close button', () => {
    render(<SettingsGear />);
    const gear = screen.getByTestId('settings');
    expect(gear).toHaveAccessibleName('Settings');
    expect(gear).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(gear);
    expect(gear).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByTestId('settings-panel');
    expect(gear).toHaveAttribute('aria-controls', region.id);

    // Escape from inside the panel hands the keyboard back to the gear
    screen.getByRole('switch', { name: 'Notation panel' }).focus();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(screen.queryByTestId('settings-panel')).toBeNull();
    expect(gear).toHaveFocus();

    fireEvent.click(gear);
    fireEvent.click(gear);
    expect(screen.queryByTestId('settings-panel')).toBeNull();

    fireEvent.click(gear);
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.queryByTestId('settings-panel')).toBeNull();
  });

  it('stays open for the board, and closes for anything else in the page', () => {
    render(
      <>
        <canvas data-testid="board" />
        <button type="button">Elsewhere</button>
        <SettingsGear />
      </>,
    );
    fireEvent.click(screen.getByTestId('settings'));
    // Controls inside take the pointer without closing it
    fireEvent.pointerDown(screen.getByRole('switch', { name: 'Notation panel' }));
    fireEvent.pointerDown(screen.getByTestId('board'));
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByTestId('settings-panel')).toBeNull();
  });

  it('marks the gear while anything differs from the defaults', () => {
    render(<SettingsGear />);
    const gear = screen.getByTestId('settings');
    fireEvent.click(gear);
    fireEvent.click(screen.getByRole('switch', { name: 'Notation panel' }));
    expect(gear).toHaveAccessibleName('Settings (1 changed)');
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
    Object.assign(window, { innerWidth: 600, innerHeight: 400 });
    try {
      render(<SettingsGear />);
      fireEvent.click(screen.getByTestId('settings'));
      const style = screen.getByTestId('settings-panel').style;
      expect(style.position).toBe('fixed');
      expect(style.top).toBe('50px');
      // 320 wide, pulled in from the gear's right edge so it stays 10 px off the left
      expect(style.width).toBe('320px');
      expect(style.right).toBe('270px');
      expect(parseFloat(style.maxHeight)).toBeLessThanOrEqual(400 - 50 - 12);
      expect(style.overflowY).toBe('auto');
    } finally {
      Object.assign(window, { innerWidth: width, innerHeight: height });
      vi.restoreAllMocks();
    }
  });

  it('opens as a sheet across the bottom of a phone held upright', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    Object.assign(window, { innerWidth: 390, innerHeight: 844 });
    try {
      render(<SettingsGear />);
      fireEvent.click(screen.getByTestId('settings'));
      const style = screen.getByTestId('settings-panel').style;
      expect(style.position).toBe('fixed');
      expect(style.bottom).toBe('0px');
      expect(style.left).toBe('0px');
      expect(style.width).toBe('100%');
      expect(parseFloat(style.maxHeight)).toBeLessThanOrEqual(844 * 0.5);
      expect(style.overflowY).toBe('auto');
    } finally {
      Object.assign(window, { innerWidth: width, innerHeight: height });
    }
  });
});
