import { describe, expect, it } from 'vitest';
import {
  betterMove,
  countGrades,
  endedAnalysis,
  gradeMove,
  gradeMoves,
  winningChances,
} from './analysis';
import type { PositionAnalysis } from './analysis';

const BEST = { from: 'Bb1', to: 'Cb1' };
const PLAYED = { from: 'Ad1', to: 'Ac3' };
const REPLY = { from: 'Ec4', to: 'Cc2' };

/** A position the engine scores at `score` for the side to move, its best move `best`. */
const at = (score: number, best = BEST): PositionAnalysis => ({ best, score });
/** A forced mate in `plies`: positive for the side to move, negative against it. */
const mate = (plies: number, best = BEST): PositionAnalysis => ({
  best,
  score: plies > 0 ? 31000 - plies : -31000 - plies,
  mate: plies,
});

describe('winning chances', () => {
  it('run from -1 to 1 with the score, even at 0, all or nothing for a mate', () => {
    expect(winningChances(at(0))).toBe(0);
    expect(winningChances(at(300))).toBeCloseTo(0.5, 1);
    expect(winningChances(at(-300))).toBeCloseTo(-winningChances(at(300)));
    expect(winningChances(at(5000))).toBeGreaterThan(0.99);
    expect(winningChances(mate(3))).toBe(1);
    expect(winningChances(mate(-2))).toBe(-1);
    expect(winningChances({ best: null, score: 0, mate: 0 })).toBe(-1);
  });
});

describe('a position the game ended in', () => {
  it('needs no search: the side to move mated, or a draw', () => {
    expect(endedAnalysis({ result: 'checkmate', winner: 'black' })).toEqual({
      best: null,
      score: 0,
      mate: 0,
    });
    for (const result of [
      'stalemate',
      'insufficient-material',
      'repetition',
      'fifty-moves',
    ] as const) {
      expect(endedAnalysis({ result })).toEqual({ best: null, score: 0 });
    }
  });

  it('is searched when the players ended it', () => {
    expect(endedAnalysis({ result: 'resignation', winner: 'white' })).toBeNull();
    expect(endedAnalysis({ result: 'agreement' })).toBeNull();
  });
});

describe('a move graded', () => {
  it('by the winning chances it gave away', () => {
    // Level, then the opponent ahead by: a little, a pawn and a half, more
    expect(gradeMove(at(0), PLAYED, at(40))).toBeNull();
    expect(gradeMove(at(0), PLAYED, at(70))).toBe('inaccuracy');
    expect(gradeMove(at(0), PLAYED, at(150))).toBe('mistake');
    expect(gradeMove(at(0), PLAYED, at(300))).toBe('blunder');
  });

  it('for little while far ahead or far behind', () => {
    // A rook thrown away a queen and more ahead, or a queen and more behind
    expect(gradeMove(at(1500), PLAYED, at(-1250))).toBeNull();
    expect(gradeMove(at(-1500), PLAYED, at(1750))).toBeNull();
    // ...but a lead thrown away is a blunder
    expect(gradeMove(at(500), PLAYED, at(0))).toBe('blunder');
  });

  it('never when it is the best move, however the scores fall', () => {
    expect(gradeMove(at(0), BEST, at(900))).toBeNull();
    expect(gradeMove(at(0), { ...BEST, promotion: 'Q' }, at(900))).toBe('blunder');
    expect(gradeMove(at(0, { ...BEST, promotion: 'Q' } as never), BEST, at(900))).toBe('blunder');
  });

  it('nor for a move better than the engine saw', () => {
    expect(gradeMove(at(0), PLAYED, at(-200))).toBeNull();
    expect(gradeMove(at(0), PLAYED, mate(-3))).toBeNull();
  });

  it('a blunder to walk into a forced mate, unless already lost', () => {
    expect(gradeMove(at(0), PLAYED, mate(1))).toBe('blunder');
    expect(gradeMove(at(400), PLAYED, mate(5))).toBe('blunder');
    expect(gradeMove(mate(3), PLAYED, mate(2))).toBe('blunder');
    // Far behind, the result hardly changes: a mistake past 7 pawns, an inaccuracy past 10
    expect(gradeMove(at(-800), PLAYED, mate(4))).toBe('mistake');
    expect(gradeMove(at(-1100), PLAYED, mate(4))).toBe('inaccuracy');
    // Mated either way, a quicker mate is no mark
    expect(gradeMove(mate(-6), PLAYED, mate(1))).toBeNull();
  });

  it('a blunder to let a forced mate go, unless still far ahead', () => {
    expect(gradeMove(mate(3), PLAYED, at(-200))).toBe('blunder');
    expect(gradeMove(mate(3), PLAYED, at(-800))).toBe('mistake');
    expect(gradeMove(mate(3), PLAYED, at(-1200))).toBe('inaccuracy');
    // A longer mate is still a mate: no mark
    expect(gradeMove(mate(3), PLAYED, mate(-6))).toBeNull();
    // Mating at once
    expect(gradeMove(mate(1), PLAYED, { best: null, score: 0, mate: 0 })).toBeNull();
  });
});

describe('the grades’ edges', () => {
  // From a level position, a move that leaves the opponent `s` centipawns up
  // gives away winningChances(s): 0.1 at 54.5, 0.2 at 110.1, 0.3 at 168.1
  const lost = (s: number) => gradeMove(at(0), PLAYED, at(s));
  it('mark a move by the winning chances it gives away, from a tenth on', () => {
    expect([54, 55, 110, 111, 168, 169].map(lost)).toEqual([
      null,
      'inaccuracy',
      'inaccuracy',
      'mistake',
      'mistake',
      'blunder',
    ]);
  });
  it('soften a mate walked into only past seven pawns behind, and past ten', () => {
    const into = (behind: number) => gradeMove(at(-behind), PLAYED, mate(1));
    expect([700, 701, 999, 1000].map(into)).toEqual([
      'blunder',
      'mistake',
      'mistake',
      'inaccuracy',
    ]);
  });
});

describe('the moves of a game', () => {
  const records = [PLAYED, REPLY, BEST];

  it('are graded as far as the positions reach, each from the one before and after', () => {
    expect(gradeMoves(records, [])).toEqual([undefined, undefined, undefined]);
    expect(gradeMoves(records, [at(0), at(300, REPLY)])).toEqual(['blunder', undefined, undefined]);
    expect(gradeMoves(records, [at(0), at(300, REPLY), at(300, PLAYED), at(300)])).toEqual([
      'blunder',
      null,
      'blunder',
    ]);
  });

  it('count each side’s marks, White’s on the odd moves', () => {
    expect(countGrades(['blunder', null, 'inaccuracy', 'mistake', undefined, 'blunder'])).toEqual({
      white: { brilliant: 0, inaccuracy: 1, mistake: 0, blunder: 1 },
      black: { brilliant: 0, inaccuracy: 0, mistake: 1, blunder: 1 },
    });
  });

  it('show the better move only where a marked move was played', () => {
    const analyses = [at(0, BEST), at(300, REPLY), at(300, PLAYED), at(300)];
    const grades = gradeMoves(records, analyses);
    expect(betterMove(grades, analyses, 0)).toBeNull();
    expect(betterMove(grades, analyses, 1)).toEqual(BEST);
    expect(betterMove(grades, analyses, 2)).toBeNull();
    expect(betterMove(grades, analyses, 3)).toEqual(PLAYED);
    expect(betterMove(grades, [], 1)).toBeNull();
  });
});

describe('a brilliant move', () => {
  /** After a move hard to see (`hardness`), a sacrifice or not, the opponent's position at `score`. */
  const after = (score: number, hardness: number, sacrifice = true): PositionAnalysis => ({
    ...at(score, REPLY),
    played: { hardness, sacrifice },
  });

  it('is a sacrifice hard to see that gives nothing away', () => {
    expect(gradeMove(at(0, PLAYED), PLAYED, after(0, 0.7))).toBe('brilliant');
    // As good as the best by the engine's lights
    expect(gradeMove(at(0), PLAYED, after(0, 0.7))).toBe('brilliant');
  });

  it('is not a move easy to see, nor one risking nothing', () => {
    expect(gradeMove(at(0, PLAYED), PLAYED, after(0, 0.3))).toBeNull();
    expect(gradeMove(at(0, PLAYED), PLAYED, after(0, 0.9, false))).toBeNull();
  });

  it('is not one played already winning, nor one that loses', () => {
    expect(gradeMove(at(500, PLAYED), PLAYED, after(-500, 0.7))).toBeNull();
    expect(gradeMove(at(-200, PLAYED), PLAYED, after(200, 0.7))).toBeNull();
    // Nor a sacrifice that gave something away: that is a fault
    expect(gradeMove(at(0), PLAYED, after(80, 0.7))).toBe('inaccuracy');
  });

  it('is counted, with no better move shown', () => {
    const grades = ['brilliant' as const, null];
    expect(countGrades(grades).white.brilliant).toBe(1);
    expect(betterMove(grades, [at(0), at(0)], 1)).toBeNull();
  });
});
