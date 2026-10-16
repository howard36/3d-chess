import { Profiler } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as review from '../game/review';
import type { MoveRecord } from '../types/messages';
import MoveHistory from './MoveHistory';

// Spied on, to count the moves a render lists
vi.mock('../game/review', async (actual) => {
  const real = await actual<typeof import('../game/review')>();
  return { ...real, formatMove: vi.fn(real.formatMove) };
});
const formatted = vi.mocked(review.formatMove);
import type { HistoryAnalysis, MoveHistoryProps } from './MoveHistory';
import type { Grade } from '../game/analysis';
import { deriveHistory } from '../game/history';
import { PieceType } from '../engine/pieces';

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
    // No notation: each move as the wire writes it (as for a record past the replay)
    notation: [],
    shown: props.moves.length,
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
  // jsdom has no matchMedia: lend the window one
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => (q.includes('aspect-ratio') ? query : { matches: false })),
  );
  return (now: boolean) => {
    narrow = now;
    act(() => listeners.forEach((f) => f()));
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the move list', () => {
  it.each([1, 63, 64, 65, 128, 129, 301])('lists %i moves, a row per two', (n) => {
    const moves = record(n);
    render(history({ moves }));
    const expected = [];
    for (let i = 0; i < n; i += 2) {
      const [w, b] = [moves[i], moves[i + 1]];
      expected.push(`${i / 2 + 1}. ${w.from}–${w.to}${b ? ` ${b.from}–${b.to}` : ''}`);
    }
    expect(rows()).toEqual(expected);
  });

  it('keeps a row to three nodes, each move its words in one span', () => {
    // A reopened long game mounts every row of its record: the number,
    // then each move a button round its words (Black's after the space
    // between the two), and nothing else
    render(history({ moves: record(3) }));
    const [full, half] = screen.getByTestId('move-list').querySelectorAll('li');
    const shape = (node: Node): string =>
      node.nodeType === Node.TEXT_NODE
        ? 'text'
        : `${node.nodeName.toLowerCase()}(${[...node.childNodes].map(shape).join()})`;
    const row = (li: Element) => [...li.childNodes].map(shape);
    expect(row(full)).toEqual(['span(text)', 'button(span(text))', 'button(text,span(text))']);
    expect(row(half)).toEqual(['span(text)', 'button(span(text))']);
    // Read as written; the space before Black's move is not in its name
    const [w, b] = record(2);
    expect(full.textContent).toBe(`1. ${w.from}–${w.to} ${b.from}–${b.to}`);
    expect(full.querySelectorAll('button')[1]).toHaveAccessibleName(`${b.from}–${b.to}`);
  });

  it('shows nothing before the first move', () => {
    const { container } = render(history({ moves: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a long record first in the block in view, the whole of it a render later', () => {
    // A reopened game of 2,000 moves: its record comes up without waiting on 2,000 buttons
    const moves = record(2000);
    const commits: number[] = [];
    formatted.mockClear();
    render(
      <Profiler id="history" onRender={() => commits.push(formatted.mock.calls.length)}>
        {history({ moves })}
      </Profiler>,
    );
    expect(commits[0]).toBeLessThanOrEqual(128);
    expect(rows()).toHaveLength(1000);
    expect(rows()[999]).toBe('1000. Aa3–Ab1 Ee3–Ed5');
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
    // ...nor rendered again: the landing listed the last block's moves only
    // (and the move shown's words, between the steps)
    formatted.mockClear();
    rerender(history({ moves: [...moves, ...record(2)] }));
    expect(formatted.mock.calls.length).toBeLessThanOrEqual(4);
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

  it('takes the focus to the move shown without scrolling the page', async () => {
    const { rerender } = render(history({ moves: record(6), shown: 1 }));
    await userEvent.click(document.querySelector<HTMLElement>('[data-ply="1"]')!);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    rerender(history({ moves: record(6), shown: 5 }));
    expect(document.querySelector('[data-ply="5"]')).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
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

  it('light the way back away from the live position', () => {
    const { rerender } = render(history({ moves: record(6) }));
    const nav = screen.getByTestId('move-history');
    expect(nav).toHaveAttribute('data-viewing-ply', '6');
    expect(nav).not.toHaveAttribute('data-review');
    rerender(history({ moves: record(6), shown: 2 }));
    expect(nav).toHaveAttribute('data-viewing-ply', '2');
    expect(nav).toHaveAttribute('data-review', 'true');
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

describe('while the game is on', () => {
  it('keeps the record out of sight, as words in the page, and takes no step', async () => {
    const onShow = vi.fn();
    const { rerender } = render(history({ moves: record(5), onShow, hidden: true }));
    const nav = screen.getByTestId('move-history');
    expect(nav).toHaveClass('sr-only');
    expect(nav).toHaveAttribute('data-hidden');
    expect(nav).toHaveAttribute('data-viewing-ply', '5');
    // A screen reader still reads the record, but finds nothing to press
    expect(rows()).toEqual(['1. Ab1–Aa3, Ed5–Ee3', '2. Aa3–Ab1, Ee3–Ed5', '3. Ab1–Aa3']);
    expect(screen.queryAllByRole('button')).toEqual([]);
    for (const key of ['ArrowLeft', 'Home', 'End']) fireEvent.keyDown(window, { key });
    expect(onShow).not.toHaveBeenCalled();
    // The game over, it comes into sight and steps
    rerender(history({ moves: record(5), onShow }));
    expect(screen.getByTestId('move-history')).not.toHaveAttribute('data-hidden');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onShow).toHaveBeenCalledWith(4);
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

  it('are named on the steps they take, as their titles say them', () => {
    render(history({ moves: record(6), shown: 3 }));
    const step = (name: string) => screen.getByRole('button', { name });
    expect([
      ['Start', 'Home', 'Start (Home)'],
      ['Back', 'ArrowLeft', 'Back (←)'],
      ['Forward', 'ArrowRight', 'Forward (→)'],
      ['Latest', 'End', 'Latest (End)'],
    ]).toEqual(
      ['Start', 'Back', 'Forward', 'Latest'].map((n) => [
        n,
        step(n).getAttribute('aria-keyshortcuts'),
        step(n).getAttribute('title'),
      ]),
    );
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

  it('opens on the ask for the review, the focus on the move shown', () => {
    windowNarrow(true);
    const { rerender } = render(history({ moves: record(6) }));
    expect(screen.getByTestId('move-list')).toHaveClass('sr-only');
    rerender(history({ moves: record(6), reviewAsked: 1 }));
    expect(screen.getByTestId('move-list')).not.toHaveClass('sr-only');
    expect(document.querySelector('[data-ply="6"]')).toHaveFocus();
  });

  it('puts the open list away with a press elsewhere, or Escape', async () => {
    windowNarrow(true);
    render(
      <>
        {history({ moves: record(6) })}
        <canvas data-testid="elsewhere" />
      </>,
    );
    const list = screen.getByTestId('move-list');
    const toggle = screen.getByRole('button', { name: /Move list/ });
    await userEvent.click(toggle);
    // A press inside it (a move) leaves it open
    fireEvent.pointerDown(document.querySelector('[data-ply="5"]')!);
    expect(list).not.toHaveClass('sr-only');
    fireEvent.pointerDown(screen.getByTestId('elsewhere'));
    expect(list).toHaveClass('sr-only');
    await userEvent.click(toggle);
    act(() => (document.querySelector('[data-ply="6"]') as HTMLElement).focus());
    await userEvent.keyboard('{Escape}');
    expect(list).toHaveClass('sr-only');
    expect(toggle).toHaveFocus();
  });

  it('follows the window as it turns', () => {
    const turn = windowNarrow(false);
    render(history({ moves: record(6) }));
    expect(screen.getByTestId('move-list')).not.toHaveClass('sr-only');
    turn(true);
    expect(screen.getByTestId('move-list')).toHaveClass('sr-only');
  });
});

describe('the review', () => {
  const counts = (white: number[], black: number[]) => ({
    white: { inaccuracy: white[0], mistake: white[1], blunder: white[2] },
    black: { inaccuracy: black[0], mistake: black[1], blunder: black[2] },
  });
  const analysis = (over: Partial<HistoryAnalysis> = {}): HistoryAnalysis => ({
    state: 'idle',
    done: 0,
    total: 7,
    grades: [],
    counts: counts([0, 0, 0], [0, 0, 0]),
    best: null,
    bestNotation: null,
    onRetry: () => {},
    ...over,
  });

  it('says so when it stops short, and goes on with "Retry"', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      history({ moves: record(6), analysis: analysis({ state: 'running', onRetry }) }),
    );
    // Said in a status that was there before it stopped, so a screen reader hears it
    const said = screen.getByTestId('review-said');
    expect(said).toHaveTextContent('');
    rerender(history({ moves: record(6), analysis: analysis({ state: 'stopped', onRetry }) }));
    expect(document.querySelector('.hud-stopped')).toHaveTextContent('Review stopped');
    expect(screen.getByTestId('review-said')).toBe(said);
    expect(said).toHaveTextContent('Review stopped.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows nothing of itself before it begins: no button to ask for it', () => {
    render(history({ moves: record(6), analysis: analysis() }));
    expect(screen.queryByTestId('analysis-counts')).toBeNull();
    expect(screen.queryByRole('button', { name: /Analyse|Review/ })).toBeNull();
    expect(screen.getByTestId('move-history')).not.toHaveAttribute('data-analysis');
  });

  it('fills a bar as it goes, and marks each move after it, its grade in words', () => {
    render(
      history({
        moves: record(6),
        analysis: analysis({
          state: 'running',
          done: 4,
          grades: [null, 'blunder', 'inaccuracy'],
          counts: counts([1, 0, 0], [0, 0, 1]),
        }),
      }),
    );
    expect(screen.getByTestId('move-history')).toHaveAttribute('data-analysis', 'running');
    const bar = screen.getByRole('progressbar', { name: 'Reviewing' });
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(bar).toHaveAttribute('aria-valuemax', '7');
    expect(document.querySelector('[data-ply="1"]')).not.toHaveAttribute('data-grade');
    const blunder = document.querySelector('[data-ply="2"]')!;
    expect(blunder).toHaveAttribute('data-grade', 'blunder');
    expect(blunder.querySelector('.hud-mark')).toHaveTextContent('??');
    expect(screen.getByRole('button', { name: 'Ed5–Ee3, blunder' })).toBe(blunder);
    expect(document.querySelector('[data-ply="3"] .hud-mark')).toHaveTextContent('?!');
    expect(rows()[0]).toBe('1. Ab1–Aa3 Ed5–Ee3??, blunder');
  });

  it('counts each side’s marks, said as a sentence', () => {
    render(
      history({
        moves: record(6),
        analysis: analysis({ state: 'done', counts: counts([2, 1, 0], [0, 0, 1]) }),
      }),
    );
    expect(screen.getByTestId('review-said')).toHaveTextContent('Review done.');
    expect(screen.getByTestId('move-history')).toHaveAttribute('data-analysis', 'done');
    expect(screen.queryByRole('progressbar')).toBeNull();
    const white = document.querySelector('.hud-counts[data-side="white"]')!;
    expect(white).toHaveTextContent(/^White: 2 inaccuracies, 1 mistake, no blunders\?!/);
    expect(white.querySelector('.hud-count[data-grade="inaccuracy"]')).toHaveAttribute(
      'data-count',
      '2',
    );
    const black = document.querySelector('.hud-counts[data-side="black"]')!;
    expect(black).toHaveTextContent(/^Black: no inaccuracies, no mistakes, 1 blunder\?!/);
  });

  it('says the better move where the move shown is marked', () => {
    const best = { from: 'Ed5', to: 'Ec3' };
    const { rerender } = render(
      history({
        moves: record(6),
        shown: 2,
        analysis: analysis({ state: 'done', grades: [null, 'mistake'], best }),
      }),
    );
    expect(screen.getByTestId('best-move')).toHaveTextContent('Best Ed5–Ec3');
    expect(screen.getByTestId('move-history')).toHaveAttribute('data-best', 'Ed5-Ec3');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'Move 2 of 6: Ed5–Ee3, mistake. Best Ed5–Ec3.',
    );
    rerender(
      history({ moves: record(6), shown: 1, analysis: analysis({ state: 'done', best: null }) }),
    );
    expect(screen.queryByTestId('best-move')).toBeNull();
    expect(screen.getByTestId('move-history')).not.toHaveAttribute('data-best');
    rerender(
      history({
        moves: record(6),
        shown: 6,
        analysis: analysis({ state: 'done', best: { ...best, promotion: 'Q' } }),
      }),
    );
    expect(screen.getByTestId('move-history')).toHaveAttribute('data-best', 'Ed5-Ec3=Q');
  });

  it('lists again only the block whose marks change', () => {
    const moves = record(200);
    const view = (grades: (Grade | null)[]) =>
      history({ moves, analysis: analysis({ state: 'running', grades }) });
    const { rerender } = render(view([]));
    formatted.mockClear();
    rerender(view([null, 'blunder']));
    // The first block's 64 moves, and the move shown (the toggle's words)
    expect(formatted.mock.calls.length).toBeLessThanOrEqual(66);
    expect(formatted.mock.calls.length).toBeGreaterThanOrEqual(64);
  });

  it('carries the mark beside the move shown in a narrow window, the counts in the list', async () => {
    windowNarrow(true);
    const best = { from: 'Ed5', to: 'Ec3' };
    render(
      history({
        moves: record(6),
        shown: 2,
        analysis: analysis({ state: 'done', grades: [null, 'blunder'], best }),
      }),
    );
    const toggle = screen.getByRole('button', { name: /Move list/ });
    expect(toggle).toHaveTextContent('1… Ed5–Ee3??');
    // The counts and the better move's words wait for the list to open
    expect(screen.queryByTestId('analysis-counts')).toBeNull();
    expect(screen.queryByTestId('best-move')).toBeNull();
    expect(screen.getByTestId('move-history')).toHaveAttribute('data-best', 'Ed5-Ec3');
    await userEvent.click(toggle);
    expect(screen.getByTestId('analysis-counts')).toBeInTheDocument();
    expect(screen.getByTestId('best-move')).toBeInTheDocument();
  });

  it('shows nothing of itself while the game is on', () => {
    render(
      history({
        moves: record(6),
        hidden: true,
        analysis: analysis({ state: 'done', grades: ['blunder'] }),
      }),
    );
    expect(screen.queryByTestId('analysis-counts')).toBeNull();
    expect(document.querySelector('.hud-mark')).toBeNull();
  });
});

describe('the notation', () => {
  // Black's knight could go to Cc5 from Eb5 too: its starting square is written
  const MOVES: MoveRecord[] = [
    { by: 'white', from: 'Bb1', to: 'Cb1' },
    { by: 'black', from: 'Ed5', to: 'Cc5' },
  ];
  const notation = deriveHistory([
    { type: 'game_state', color: 'white', started: true, moves: MOVES },
  ]).notation;

  it('draws each move with its piece’s icon and names it in words', () => {
    render(history({ moves: MOVES, notation }));
    const [pawn, knight] = screen.getAllByRole('button', { name: /to/ });
    expect(pawn).toHaveAccessibleName('Pawn to Cb1');
    expect(pawn.querySelector('svg')).toHaveAttribute('data-piece', 'Pawn');
    expect(pawn).toHaveTextContent(/^Cb1$/);
    expect(knight).toHaveAccessibleName('Knight Ed5 to Cc5');
    expect(knight.querySelector('svg')).toHaveAttribute('data-piece', 'Knight');
    expect(rows()).toEqual(['1. Cb1 Ed5–Cc5']);
  });

  it('sets what a pawn became among the signs, with none of the moving piece’s gap', () => {
    const promoted = [{ by: 'white' as const, from: 'Ed4', to: 'Ed5', promotion: 'Q' as const }];
    const note = {
      piece: PieceType.Pawn,
      from: null,
      capture: false,
      to: 'Ed5',
      promotion: PieceType.Queen,
      check: '+' as const,
    };
    render(history({ moves: promoted, notation: [note] }));
    const move = document.querySelector('[data-ply="1"]')!;
    expect(move).toHaveAccessibleName('Pawn to Ed5, promotes to queen, check');
    const [piece, became] = move.querySelectorAll('svg');
    expect(piece).not.toHaveAttribute('data-promotion');
    expect(became).toHaveAttribute('data-piece', 'Queen');
    expect(became).toHaveAttribute('data-promotion');
    expect(move).toHaveTextContent(/^Ed5=\+$/);
  });

  it('writes the move shown between the steps the same way', () => {
    windowNarrow(true);
    render(history({ moves: MOVES, notation, shown: 1 }));
    const toggle = screen.getByRole('button', { name: /Move list/ });
    expect(toggle).toHaveAccessibleName('Move list, at 1. Pawn to Cb1');
    expect(toggle.querySelector('svg')).toHaveAttribute('data-piece', 'Pawn');
  });

  it('keeps the record as words while the game is on', () => {
    render(history({ moves: MOVES, notation, hidden: true }));
    expect(rows()).toEqual(['1. Pawn to Cb1, Knight Ed5 to Cc5']);
  });
});
