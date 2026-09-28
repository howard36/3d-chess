import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { deriveHistory } from '../game/history';
import type { Turn } from '../game/history';
import CapturedPieces from './CapturedPieces';

// The showcase game's opening: White's unicorn and bishop take pawns, Black's
// unicorn takes a pawn and its queen the bishop, White's rook the unicorn.
const OPENING = ['Ab2-De5', 'Ed4-Ba1', 'Ac2-Cc4', 'Dc4-Dc3', 'Ad2-Dd5', 'Ec4-Dd5', 'Aa1-Ba1'];

const seatedAs = (seat: Turn, moves: string[]) => {
  const history = deriveHistory([
    {
      type: 'game_state',
      color: seat,
      started: true,
      moves: moves.map((m, i) => {
        const [from, to] = m.split('-');
        return { by: i % 2 === 0 ? 'white' : 'black', from, to };
      }),
    },
  ]);
  return render(<CapturedPieces seat={seat} captured={history.captured} board={history.board} />);
};

const haul = (side: 'me' | 'them') =>
  screen.getByTestId('captured-pieces').querySelector<HTMLElement>(`[data-side="${side}"]`)!;
const glyphs = (el: HTMLElement) =>
  [...el.querySelectorAll('svg')].map((g) => `${g.dataset.color} ${g.dataset.piece}`);

describe('CapturedPieces', () => {
  it('shows nothing before the first capture', () => {
    seatedAs('white', ['Ab2-Ab3']);
    expect(screen.queryByTestId('captured-pieces')).not.toBeInTheDocument();
  });

  it('hangs your haul under your half and theirs under theirs, in the taken army’s material', () => {
    seatedAs('white', OPENING);
    // You (White) took a unicorn and two pawns: Black's pieces
    expect(glyphs(haul('me'))).toEqual(['black Unicorn', 'black Pawn']);
    expect(haul('me')).toHaveTextContent('You have taken a unicorn and 2 pawns; you are 1 ahead.');
    // The count only where there is more than one, and the lead on your side
    expect([...haul('me').querySelectorAll('.hud-count')].map((c) => c.textContent)).toEqual(['2']);
    expect(haul('me').querySelector('.hud-lead')).toHaveTextContent('+1');
    // They took a bishop and a pawn: yours, in porcelain, with no lead
    expect(glyphs(haul('them'))).toEqual(['white Bishop', 'white Pawn']);
    expect(haul('them')).toHaveTextContent('Your opponent has taken a bishop and a pawn.');
    expect(haul('them').querySelector('.hud-lead')).toBeNull();
  });

  it('is told from Black’s side the other way round', () => {
    seatedAs('black', OPENING);
    expect(glyphs(haul('me'))).toEqual(['white Bishop', 'white Pawn']);
    expect(haul('me')).toHaveTextContent('You have taken a bishop and a pawn.');
    expect(glyphs(haul('them'))).toEqual(['black Unicorn', 'black Pawn']);
    expect(haul('them')).toHaveTextContent(
      'Your opponent has taken a unicorn and 2 pawns; they are 1 ahead.',
    );
    expect(haul('them').querySelector('.hud-lead')).toHaveTextContent('+1');
  });

  it('is said once in words, quietly: the pictures are hidden and nothing is live', () => {
    seatedAs('white', OPENING);
    const all = screen.getByTestId('captured-pieces');
    // Each haul reads as its sentence alone
    for (const side of ['me', 'them'] as const) {
      const shown = haul(side).querySelectorAll('.hud-taken, .hud-lead');
      shown.forEach((el) => expect(el).toHaveAttribute('aria-hidden', 'true'));
    }
    expect(all.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(within(all).getByText(/^You have taken/)).toHaveClass('sr-only');
  });

  it('marks a side with nothing to show as empty', () => {
    // White's unicorn takes a pawn: Black has taken nothing
    seatedAs('black', ['Ab2-De5']);
    expect(haul('me')).toHaveAttribute('data-empty');
    expect(haul('me')).toHaveTextContent('');
    expect(haul('them')).toHaveTextContent('Your opponent has taken a pawn; they are 1 ahead.');
  });
});
