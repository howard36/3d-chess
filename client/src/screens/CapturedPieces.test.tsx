import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../engine';
import { fromZXY } from '../engine/coords';
import CapturedPieces from './CapturedPieces';

const play = (...moves: string[]) =>
  moves.reduce((board, m) => {
    const [from, to] = m.split('-').map(fromZXY);
    return board.applyMove({ from, to });
  }, Board.setupStartingPosition());

describe('CapturedPieces', () => {
  it('shows nothing before the first capture', () => {
    const { container } = render(
      <CapturedPieces board={Board.setupStartingPosition()} color="white" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each side's captures from the player's point of view, with the lead", () => {
    // White's unicorn takes a pawn, Black's unicorn takes one back, then
    // White's bishop takes a pawn with check.
    const board = play('Bb1-Ee4', 'Dd5-Aa2', 'Bc1-Dc3', 'Dc4-Cc4', 'Bd1-Ed4');
    render(<CapturedPieces board={board} color="white" />);
    expect(screen.getByRole('listitem', { name: 'You captured: 2 pawns' })).toHaveTextContent('+1');
    expect(screen.getByRole('listitem', { name: 'You lost: 1 pawn' })).toBeInTheDocument();
  });

  it('flips for Black', () => {
    const board = play('Bb1-Ee4', 'Dd5-Aa2', 'Bc1-Dc3', 'Dc4-Cc4', 'Bd1-Ed4');
    render(<CapturedPieces board={board} color="black" />);
    expect(screen.getByRole('listitem', { name: 'You captured: 1 pawn' })).not.toHaveTextContent(
      '+',
    );
    expect(screen.getByRole('listitem', { name: 'You lost: 2 pawns' })).toHaveTextContent('+1');
  });
});
