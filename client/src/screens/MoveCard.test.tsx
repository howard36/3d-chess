import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../engine';
import MoveCard from './MoveCard';

const card = (shown?: boolean) => (
  <MoveCard
    board={Board.setupStartingPosition()}
    color="white"
    canMove
    yourTurn
    onMove={() => {}}
    shown={shown}
  />
);

describe('MoveCard’s field', () => {
  it('is out of sight until it has focus, unless there is no board to play on', () => {
    const { rerender } = render(card());
    expect(screen.getByTestId('move-card')).toHaveAttribute('data-hidden', '');
    rerender(card(true));
    expect(screen.getByTestId('move-card')).not.toHaveAttribute('data-hidden');
  });
});
