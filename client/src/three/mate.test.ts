import { describe, expect, it } from 'vitest';
import { fallAway } from './mate';
import {
  KNOCK_FALL,
  KNOCK_STRIKE_MS,
  TIPPING_MS,
  TOPPLE_MS,
  TOPPLE_STRIKE,
  toppleAngle,
} from './pieceMotion';
import { FRAME, MARGIN } from './scene/palette';

describe('a knocked king’s fall', () => {
  const at = (ms: number) => toppleAngle(ms, true).angle;
  const speed = (ms: number) => at(ms + 10) - at(ms);

  it('tips back fast, slows to a near stop at the edge of his balance, then goes over', () => {
    expect(at(0)).toBe(0);
    // Fast off the knock
    expect(speed(0)).toBeGreaterThan(5 * speed(TIPPING_MS - 20));
    // Hanging at the edge, a fraction of a second
    const near = Array.from({ length: KNOCK_STRIKE_MS }, (_, ms) => at(ms)).filter(
      (a) => Math.abs(a - KNOCK_FALL.tipAt) < 0.08,
    ).length;
    expect(near).toBeGreaterThan(300);
    expect(near).toBeLessThan(700);
    // Never back toward standing: the knock carries him over
    for (let ms = 0; ms < KNOCK_STRIKE_MS; ms += 5) expect(at(ms + 5)).toBeGreaterThan(at(ms));
    // Gravity takes the rest, gathering speed to the floor
    expect(speed(KNOCK_STRIKE_MS - 20)).toBeGreaterThan(speed(TIPPING_MS + 50));
  });

  it('strikes the floor at the end of the fall, then settles', () => {
    expect(KNOCK_STRIKE_MS).toBeGreaterThan(800);
    expect(KNOCK_STRIKE_MS).toBeLessThan(1500);
    expect(toppleAngle(KNOCK_STRIKE_MS - 1, true).struck).toBe(false);
    expect(toppleAngle(KNOCK_STRIKE_MS, true).struck).toBe(true);
    expect(toppleAngle(KNOCK_STRIKE_MS + 2000, true).settled).toBe(true);
  });

  it('leaves a plain fall as before', () => {
    expect(toppleAngle(TOPPLE_MS * TOPPLE_STRIKE, false).struck).toBe(true);
  });
});

describe('which way a mated king falls', () => {
  const edge = FRAME.half + MARGIN;

  it('falls straight away from the piece that mated him, with room to', () => {
    const [x, z] = fallAway([0, 0, 0], [-1, 0, 0])!;
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
  });

  it('turns aside rather than fall off the edge of his platform', () => {
    // On the edge, mated from inside: straight away is over the edge
    const king: [number, number, number] = [2, 0, 0];
    const [x, z] = fallAway(king, [1, 0, 0])!;
    expect(king[0] + x * 0.9).toBeLessThanOrEqual(edge);
    expect(Math.abs(z)).toBeGreaterThan(0.3);
    // Still away from the attacker, as far as it can be
    expect(x).toBeGreaterThanOrEqual(-0.01);
  });

  it('has no say when mated from straight above or below', () => {
    expect(fallAway([0, 0, 0], [0, 2.7, 0])).toBeNull();
  });
});
