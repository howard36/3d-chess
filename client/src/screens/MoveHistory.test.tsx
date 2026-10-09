import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoveRecord } from '../types/messages';
import MoveHistory from './MoveHistory';
import type { MoveHistoryProps } from './MoveHistory';

const SHUFFLE: MoveRecord[] = [
  { by: 'white', from: 'Ab1', to: 'Aa3' },
  { by: 'black', from: 'Ed5', to: 'Ee3' },
  { by: 'white', from: 'Aa3', to: 'Ab1' },
  { by: 'black', from: 'Ee3', to: 'Ed5' },
];
const record = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...SHUFFLE[i % 4] }) as MoveRecord);

const history = (props: Partial<MoveHistoryProps> & { moves: MoveRecord[] }) => {
  const all: MoveHistoryProps = {
    applied: props.moves.length,
    shown: props.moves.length,
    newer: false,
    onShow: () => {},
    enabled: true,
    ...props,
  };
  return <MoveHistory {...all} />;
};

/** The list's rows as a player's screen reader reads them. */
const rows = () =>
  [...screen.getByTestId('move-list').querySelectorAll('li')].map((li) => li.textContent);

/** A window `narrow` (no wider than 13:9) or not, as matchMedia reports it. */
const windowNarrow = (narrow: boolean) => {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return narrow;
    },
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  };
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) => (q.includes('aspect-ratio') ? query : { matches: false }) as MediaQueryList,
  );
  return (now: boolean) => {
    narrow = now;
    act(() => listeners.forEach((f) => f()));
  };
};

afterEach(() => vi.restoreAllMocks());

describe('the move list', () => {
  it.each([1, 63, 64, 65, 128, 129, 301])('lists %i moves, a row per two', (n) => {
    const moves = record(n);
    render(history({ moves }));
    const expected = [];
    for (let i = 0; i < n; i += 2) {
      const [w, b] = [moves[i], moves[i + 1]];
      expected.push(`${i / 2 + 1}. ${w.from}–${w.to} ${b ? `${b.from}–${b.to}` : ''}`);
    }
    expect(rows()).toEqual(expected);
  });

  it('shows nothing before the first move', () => {
    const { container } = render(history({ moves: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps each row as a move lands, and redraws only the last block', () => {
    const moves = record(129);
    const { rerender } = render(history({ moves }));
    const before = [...screen.getByTestId('move-list').querySelectorAll('li')];
    const firstText = before[0].querySelector('button')!.firstChild;
    // A landing move: a new record, the same records before it plus one
    rerender(history({ moves: [...moves, { by: 'black', from: 'Ed5', to: 'Ee3' }] }));
    const after = [...screen.getByTestId('move-list').querySelectorAll('li')];
    expect(after).toHaveLength(65);
    expect(after.slice(0, 65)).toEqual(before);
    expect(after[64].textContent).toBe('65. Ab1–Aa3 Ed5–Ee3');
    // An earlier block's text nodes were not touched
    expect(after[0].querySelector('button')!.firstChild).toBe(firstText);
    // A record replaced (a reconnect's snapshot) lists anew
    rerender(history({ moves: record(129).map((m) => ({ ...m, promotion: undefined })) }));
    expect(rows()).toHaveLength(65);
  });

  it('marks the move shown, the one way into the list for Tab', () => {
    render(history({ moves: record(6), shown: 3 }));
    const shown = screen.getByRole('button', { current: 'step' });
    expect(shown).toHaveAttribute('data-ply', '3');
    expect(shown).toHaveAttribute('tabindex', '0');
    const others = [...document.querySelectorAll('[data-ply]')].filter((b) => b !== shown);
    expect(others.every((b) => b.getAttribute('tabindex') === '-1')).toBe(true);
  });

  it('shows the board after a move clicked', async () => {
    const onShow = vi.fn();
    render(history({ moves: record(6), onShow }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Ab1–Aa3' })[0]);
    expect(onShow).toHaveBeenLastCalledWith(1);
    await userEvent.click(screen.getAllByRole('button', { name: 'Ab1–Aa3' })[1]);
    expect(onShow).toHaveBeenLastCalledWith(5);
    // The move already shown: nothing to do
    onShow.mockClear();
    await userEvent.click(screen.getAllByRole('button', { name: 'Ed5–Ee3' })[1]);
    expect(onShow).not.toHaveBeenCalled();
  });

  it('cannot show a move past one the replay could not play', () => {
    render(history({ moves: record(4), applied: 2, shown: 2 }));
    expect(document.querySelector('[data-ply="3"]')).toBeDisabled();
    expect(document.querySelector('[data-ply="2"]')).toBeEnabled();
  });
});

describe('the steps', () => {
  it('lead to the start, back, on and to the latest', async () => {
    const onShow = vi.fn();
    render(history({ moves: record(6), shown: 3, onShow }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onShow).toHaveBeenLastCalledWith(0);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onShow).toHaveBeenLastCalledWith(2);
    await userEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(onShow).toHaveBeenLastCalledWith(4);
    await userEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(onShow).toHaveBeenLastCalledWith(6);
  });

  it('go nowhere past either end', async () => {
    const onShow = vi.fn();
    const { rerender } = render(history({ moves: record(6), onShow }));
    // At the live position: on and the latest lead nowhere
    for (const name of ['Forward', 'Latest']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(button);
    }
    expect(onShow).not.toHaveBeenCalled();
    rerender(history({ moves: record(6), shown: 0, onShow }));
    for (const name of ['Start', 'Back']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(screen.getByRole('button', { name }));
    }
    expect(onShow).not.toHaveBeenCalled();
  });

  it('light the way back away from the live position, and mark a move landed since', () => {
    const { rerender } = render(history({ moves: record(6) }));
    const nav = screen.getByTestId('move-history');
    expect(nav).toHaveAttribute('data-viewing-ply', '6');
    expect(nav).not.toHaveAttribute('data-review');
    rerender(history({ moves: record(6), shown: 2 }));
    expect(nav).toHaveAttribute('data-viewing-ply', '2');
    expect(nav).toHaveAttribute('data-review', 'true');
    expect(document.querySelector('.hud-latest')).not.toHaveAttribute('data-newer');
    rerender(history({ moves: record(7), shown: 2, newer: true }));
    expect(document.querySelector('.hud-latest')).toHaveAttribute('data-newer', 'true');
  });

  it('take nothing while the history is out of reach', async () => {
    const onShow = vi.fn();
    render(history({ moves: record(6), shown: 3, onShow, enabled: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(document.querySelector<HTMLElement>('[data-ply="1"]')!);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onShow).not.toHaveBeenCalled();
  });

  it('say where the board stands to a screen reader', () => {
    const { rerender } = render(history({ moves: record(6) }));
    const status = () => screen.getByTestId('move-history').querySelector('[role="status"]');
    expect(status()).toHaveTextContent(/^$/);
    rerender(history({ moves: record(6), shown: 2 }));
    expect(status()).toHaveTextContent('Move 2 of 6: Ed5–Ee3.');
    rerender(history({ moves: record(6), shown: 0 }));
    expect(status()).toHaveTextContent('Starting position.');
  });

  it('say the way back to the game once the player has stepped', async () => {
    const onShow = vi.fn();
    const { rerender } = render(history({ moves: record(6), shown: 5, onShow }));
    await userEvent.click(screen.getByRole('button', { name: 'Forward' }));
    rerender(history({ moves: record(6), onShow }));
    expect(screen.getByTestId('move-history').querySelector('[role="status"]')).toHaveTextContent(
      'Latest move.',
    );
  });
});

describe('the keys', () => {
  it('step with ← → Home End wherever focus is but in a field', () => {
    const onShow = vi.fn();
    render(
      <>
        <input aria-label="field" />
        {history({ moves: record(6), shown: 3, onShow })}
      </>,
    );
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onShow).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(onShow).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(document.body, { key: 'Home' });
    expect(onShow).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(document.body, { key: 'End' });
    expect(onShow).toHaveBeenLastCalledWith(6);
    onShow.mockClear();
    // Typing a move, the arrows move the caret
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'field' }), { key: 'ArrowLeft' });
    // With a modifier, or another key, nothing
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(onShow).not.toHaveBeenCalled();
  });

  it('take nothing already taken, and go nowhere past the ends', () => {
    const onShow = vi.fn();
    render(history({ moves: record(6), onShow }));
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'End' });
    const taken = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    });
    taken.preventDefault();
    document.body.dispatchEvent(taken);
    expect(onShow).not.toHaveBeenCalled();
  });

  it('keep focus on the move shown while it is in the list', () => {
    const { rerender } = render(history({ moves: record(6), shown: 3 }));
    const three = document.querySelector<HTMLElement>('[data-ply="3"]')!;
    three.focus();
    rerender(history({ moves: record(6), shown: 4 }));
    expect(document.activeElement).toBe(document.querySelector('[data-ply="4"]'));
    // Focus elsewhere stays where it is
    screen.getByRole('button', { name: 'Back' }).focus();
    rerender(history({ moves: record(6), shown: 2 }));
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
  });
});

describe('in a narrow window', () => {
  it('keeps the list closed but in the page until the move shown opens it', async () => {
    windowNarrow(true);
    render(history({ moves: record(6), shown: 3 }));
    const list = screen.getByTestId('move-list');
    // Closed: out of sight but read, its moves out of the tab order
    expect(list).toHaveClass('sr-only');
    expect(rows()).toHaveLength(3);
    expect(document.querySelector('[data-ply="3"]')).toHaveAttribute('tabindex', '-1');
    const toggle = screen.getByRole('button', { name: /Move list/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('2. Aa3–Ab1');
    await userEvent.click(toggle);
    expect(list).not.toHaveClass('sr-only');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('[data-ply="3"]')).toHaveAttribute('tabindex', '0');
    await userEvent.click(toggle);
    expect(list).toHaveClass('sr-only');
  });

  it('follows the window as it turns', () => {
    const turn = windowNarrow(false);
    render(history({ moves: record(6) }));
    expect(screen.getByTestId('move-list')).not.toHaveClass('sr-only');
    turn(true);
    expect(screen.getByTestId('move-list')).toHaveClass('sr-only');
  });
});
