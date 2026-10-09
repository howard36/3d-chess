import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../engine';
import type { MoveRecord } from '../types/messages';
import MoveCard from './MoveCard';

const SHUFFLE: MoveRecord[] = [
  { by: 'white', from: 'Ab1', to: 'Aa3' },
  { by: 'black', from: 'Ed5', to: 'Ee3' },
  { by: 'white', from: 'Aa3', to: 'Ab1' },
  { by: 'black', from: 'Ee3', to: 'Ed5' },
];
const record = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...SHUFFLE[i % 4] }) as MoveRecord);

const card = (moves: MoveRecord[]) => (
  <MoveCard
    board={Board.setupStartingPosition()}
    color="white"
    moves={moves}
    canMove
    yourTurn
    onMove={() => {}}
  />
);

/** The list's rows as a player's screen reader reads them. */
const rows = () =>
  [...screen.getByTestId('move-list').querySelectorAll('li')].map((li) => li.textContent);

describe('MoveCard’s move list', () => {
  it.each([0, 1, 63, 64, 65, 128, 129, 301])('lists %i moves, a row per two', (n) => {
    const moves = record(n);
    render(card(moves));
    const expected = [];
    for (let i = 0; i < n; i += 2) {
      const [w, b] = [moves[i], moves[i + 1]];
      expected.push(`${i / 2 + 1}. ${w.from}–${w.to} ${b ? `${b.from}–${b.to}` : ''}`);
    }
    expect(rows()).toEqual(expected);
  });

  it('keeps each row as a move lands, and redraws only the last block', () => {
    const moves = record(129);
    const { rerender } = render(card(moves));
    const before = [...screen.getByTestId('move-list').querySelectorAll('li')];
    const firstText = before[0].firstChild;
    // A landing move: a new record, the same records before it plus one
    rerender(card([...moves, { by: 'black', from: 'Ed5', to: 'Ee3' }]));
    const after = [...screen.getByTestId('move-list').querySelectorAll('li')];
    expect(after).toHaveLength(65);
    expect(after.slice(0, 65)).toEqual(before);
    expect(after[64].textContent).toBe('65. Ab1–Aa3 Ed5–Ee3');
    // An earlier block's text nodes were not touched
    expect(after[0].firstChild).toBe(firstText);
    // A record replaced (a reconnect's snapshot) lists anew
    rerender(card(record(129).map((m) => ({ ...m, promotion: undefined }))));
    expect(rows()).toHaveLength(65);
  });
});

describe('MoveCard’s field', () => {
  it('is out of sight until it has focus, unless there is no board to play on', () => {
    const { rerender } = render(card([]));
    expect(screen.getByTestId('move-card')).toHaveAttribute('data-hidden', '');
    rerender(
      <MoveCard
        board={Board.setupStartingPosition()}
        color="white"
        moves={[]}
        canMove
        yourTurn
        onMove={() => {}}
        shown
      />,
    );
    expect(screen.getByTestId('move-card')).not.toHaveAttribute('data-hidden');
  });
});
