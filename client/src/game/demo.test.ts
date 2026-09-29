import { describe, expect, it } from 'vitest';
import { deriveHistory } from './history';
import { DEMO_GAME, DEMO_LOOP_SECONDS, DEMO_PACE, demoFrame, demoLog } from './demo';

describe('the demo game', () => {
  it('is legal from the opening and ends in mate by White', () => {
    const history = deriveHistory(demoLog(DEMO_GAME.length));
    expect(history.replayFailedAt).toBeNull();
    expect(history.appliedMoveCount).toBe(DEMO_GAME.length);
    expect(history.gameOver).toEqual({ result: 'checkmate', winner: 'white' });
  });

  it('is not over before its last move', () => {
    for (let ply = 0; ply < DEMO_GAME.length; ply++) {
      expect(deriveHistory(demoLog(ply)).gameOver).toBeNull();
    }
  });

  it('hands deriveHistory the same messages, so an unchanged ply keeps its history', () => {
    const first = deriveHistory(demoLog(5));
    expect(deriveHistory(demoLog(5), first)).toBe(first);
    expect(deriveHistory(demoLog(6), first)).not.toBe(first);
  });

  it('clamps the ply to the game', () => {
    expect(demoLog(-3)).toEqual([]);
    expect(demoLog(99)).toHaveLength(DEMO_GAME.length);
  });
});

describe('demoFrame', () => {
  const firstMove = DEMO_PACE.fadeIn + DEMO_PACE.open;
  const lastMove = firstMove + (DEMO_GAME.length - 1) * DEMO_PACE.ply;

  it('opens on the starting position without a fade', () => {
    expect(demoFrame(0)).toEqual({ pass: 0, ply: 0, veil: 0 });
    expect(demoFrame(firstMove - 0.01).ply).toBe(0);
  });

  it('plays a move every step and holds the mate', () => {
    expect(demoFrame(firstMove).ply).toBe(1);
    expect(demoFrame(firstMove + DEMO_PACE.ply).ply).toBe(2);
    expect(demoFrame(lastMove).ply).toBe(DEMO_GAME.length);
    expect(demoFrame(lastMove + DEMO_PACE.mate - 0.01)).toEqual({
      pass: 0,
      ply: DEMO_GAME.length,
      veil: 0,
    });
  });

  it('fades out at the end of a pass and back in on a fresh board', () => {
    const end = DEMO_LOOP_SECONDS;
    // Closing eases in, opening eases out: a quarter shut halfway through each
    expect(demoFrame(end - DEMO_PACE.fadeOut - 0.01).veil).toBe(0);
    expect(demoFrame(end - DEMO_PACE.fadeOut / 2).veil).toBeCloseTo(0.25);
    expect(demoFrame(end - 1e-6).veil).toBeCloseTo(1);
    expect(demoFrame(end)).toEqual({ pass: 1, ply: 0, veil: 1 });
    expect(demoFrame(end + DEMO_PACE.fadeIn / 2).veil).toBeCloseTo(0.25);
    expect(demoFrame(end + DEMO_PACE.fadeIn).veil).toBeCloseTo(0);
    expect(demoFrame(end + firstMove + 0.01).ply).toBe(1);
  });

  it('treats a negative time as the start', () => {
    expect(demoFrame(-5)).toEqual({ pass: 0, ply: 0, veil: 0 });
  });
});
