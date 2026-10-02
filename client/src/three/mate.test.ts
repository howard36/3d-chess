import { describe, expect, it } from 'vitest';
import { fallAway } from './mate';
import { TEETER, TEETER_STRIKE_MS, TOPPLE_MS, TOPPLE_STRIKE, toppleAngle } from './pieceMotion';
import { FRAME, MARGIN } from './scene/palette';

describe('a mated king’s teeter', () => {
  const at = (ms: number) => toppleAngle(ms, true).angle;

  it('tips back, swings forward through upright, then goes over backwards', () => {
    expect(at(0)).toBe(0);
    expect(at(TEETER.backMs)).toBeCloseTo(TEETER.back);
    expect(at(TEETER.backMs + TEETER.forwardMs)).toBeCloseTo(-TEETER.forward);
    expect(at(TEETER_STRIKE_MS - 1)).toBeGreaterThan(1.3);
    // Each beat is a smooth swing, never a jump
    for (let ms = 0; ms < TEETER_STRIKE_MS; ms += 10) {
      expect(Math.abs(at(ms + 10) - at(ms))).toBeLessThan(0.08);
    }
  });

  it('strikes the floor at the end of the fall, then settles', () => {
    expect(toppleAngle(TEETER_STRIKE_MS - 1, true).struck).toBe(false);
    expect(toppleAngle(TEETER_STRIKE_MS, true).struck).toBe(true);
    expect(toppleAngle(TEETER_STRIKE_MS + 2000, true).settled).toBe(true);
  });

  it('is slower and wider than a plain fall, which strikes as before', () => {
    expect(TEETER_STRIKE_MS).toBeGreaterThan(2 * TOPPLE_MS);
    expect(toppleAngle(TOPPLE_MS * TOPPLE_STRIKE, false).struck).toBe(true);
    expect(Math.min(...[0, 100, 200, 300, 400].map((ms) => toppleAngle(ms, false).angle))).toBe(0);
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
