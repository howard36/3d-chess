import { describe, expect, it } from 'vitest';
import { deriveHistory } from './history';
import {
  DEMO_GAMES,
  DEMO_LOOP_SECONDS,
  DEMO_PACE,
  demoFrame,
  demoLog,
  demoOrder,
  passSeconds,
} from './demo';

describe('the demo games', () => {
  it('are legal from the opening and each ends in mate', () => {
    const winners = DEMO_GAMES.map((moves, game) => {
      const history = deriveHistory(demoLog(game, moves.length));
      expect(history.replayFailedAt).toBeNull();
      expect(history.appliedMoveCount).toBe(moves.length);
      expect(history.gameOver?.result).toBe('checkmate');
      return history.gameOver?.winner;
    });
    // Both sides win
    expect(new Set(winners)).toEqual(new Set(['white', 'black']));
  });

  it('are not over before their last move', () => {
    DEMO_GAMES.forEach((moves, game) => {
      for (let ply = 0; ply < moves.length; ply++) {
        expect(deriveHistory(demoLog(game, ply)).gameOver).toBeNull();
      }
    });
  });

  it('promote as the record says', () => {
    // The fourth game's black pawn becomes a queen on ply 110
    const history = deriveHistory(demoLog(3, 110));
    expect(history.lastMove?.move.promotion).toBe('Queen');
  });

  it('hand deriveHistory the same messages, so an unchanged ply keeps its history', () => {
    const first = deriveHistory(demoLog(1, 5));
    expect(deriveHistory(demoLog(1, 5), first)).toBe(first);
    expect(deriveHistory(demoLog(1, 6), first)).not.toBe(first);
  });

  it('clamp the ply to the game', () => {
    expect(demoLog(0, -3)).toEqual([]);
    expect(demoLog(0, 999)).toHaveLength(DEMO_GAMES[0].length);
  });
});

describe('demoOrder', () => {
  it('plays every game once, in an order of its own each time', () => {
    const sorted = (o: number[]) => [...o].sort((a, b) => a - b);
    const all = DEMO_GAMES.map((_, i) => i);
    expect(sorted(demoOrder())).toEqual(all);
    // The random draw picks the order: always the last, the games unturned
    expect(demoOrder(() => 0.999)).toEqual(all);
    // Always the first: each game swapped down in turn
    expect(demoOrder(() => 0)).toEqual([1, 2, 3, 4, 5, 0]);
  });

  it('can open on any game', () => {
    const firsts = new Set<number>();
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 200; i++) firsts.add(demoOrder(random)[0]);
    expect(firsts.size).toBe(DEMO_GAMES.length);
  });
});

describe('demoFrame', () => {
  const order = [2, 0, 4, 1, 5, 3];
  const firstMove = DEMO_PACE.fadeIn + DEMO_PACE.open;
  const lastMove = (game: number) => firstMove + (DEMO_GAMES[game].length - 1) * DEMO_PACE.ply;

  it('opens on the first game of the order, on the starting position, without a fade', () => {
    expect(demoFrame(0, order)).toEqual({ pass: 0, game: 2, ply: 0, veil: 0 });
    expect(demoFrame(firstMove - 0.01, order).ply).toBe(0);
  });

  it('plays a move every step and holds the mate', () => {
    expect(DEMO_PACE.ply).toBe(1.8);
    expect(demoFrame(firstMove + 0.01, order).ply).toBe(1);
    expect(demoFrame(firstMove + DEMO_PACE.ply + 0.01, order).ply).toBe(2);
    expect(demoFrame(lastMove(2) + 0.01, order).ply).toBe(DEMO_GAMES[2].length);
    expect(demoFrame(lastMove(2) + DEMO_PACE.mate - 0.01, order)).toEqual({
      pass: 0,
      game: 2,
      ply: DEMO_GAMES[2].length,
      veil: 0,
    });
  });

  it('fades out at the end of a pass and back in on the next game, on a fresh board', () => {
    const end = passSeconds(2);
    // Closing eases in, opening eases out: a quarter shut halfway through each
    expect(demoFrame(end - DEMO_PACE.fadeOut - 0.01, order).veil).toBe(0);
    expect(demoFrame(end - DEMO_PACE.fadeOut / 2, order).veil).toBeCloseTo(0.25);
    expect(demoFrame(end - 1e-6, order).veil).toBeCloseTo(1);
    expect(demoFrame(end, order)).toEqual({ pass: 1, game: 0, ply: 0, veil: 1 });
    expect(demoFrame(end + DEMO_PACE.fadeIn / 2, order).veil).toBeCloseTo(0.25);
    expect(demoFrame(end + DEMO_PACE.fadeIn, order).veil).toBeCloseTo(0);
    expect(demoFrame(end + firstMove + 0.01, order).ply).toBe(1);
  });

  it('plays the games in order, then round again in the same order', () => {
    let t = 0;
    for (const [i, game] of [...order, ...order].entries()) {
      expect(demoFrame(t + 1, order)).toMatchObject({ pass: i, game });
      t += passSeconds(game);
    }
    expect(t).toBeCloseTo(2 * DEMO_LOOP_SECONDS);
    // About twenty-four minutes before the games come round again
    expect(DEMO_LOOP_SECONDS / 60).toBeGreaterThan(23);
    expect(DEMO_LOOP_SECONDS / 60).toBeLessThan(25);
  });

  it('treats a negative time as the start', () => {
    expect(demoFrame(-5, order)).toEqual({ pass: 0, game: 2, ply: 0, veil: 0 });
  });
});
