import { describe, expect, it } from 'vitest';
import { GROUND_RADIUS, groundFan } from './horizonGround';
import { VEIL } from './horizon';

// The plain's footprint: a disc nearly as wide as the sky, rim the same
// distance off on every side, and the veil thick before any rim is reached.

const rim = (fan: Float32Array) => {
  const out: [number, number][] = [];
  for (let i = 3; i < fan.length; i += 3) out.push([fan[i], fan[i + 2]]);
  return out;
};

describe('the plain', () => {
  it('is a disc inside the sky, centred on the tower', () => {
    const fan = groundFan();
    expect([fan[0], fan[1], fan[2]]).toEqual([0, 0, 0]);
    for (const [x, z] of rim(fan)) expect(Math.hypot(x, z)).toBeCloseTo(GROUND_RADIUS, 3);
    expect(GROUND_RADIUS).toBeLessThan(400);
  });

  it('faces up', () => {
    const fan = groundFan();
    const [a, b] = [rim(fan)[0], rim(fan)[1]];
    // (centre, a, b) counterclockwise seen from above: the cross product points up
    const up = a[1] * b[0] - a[0] * b[1];
    expect(up).toBeGreaterThan(0);
  });

  it('is main’s square with the fix off, its corners kept', () => {
    const pts = rim(groundFan(true));
    for (const [x, z] of pts) expect(Math.max(Math.abs(x), Math.abs(z))).toBeCloseTo(130, 3);
    const corners = pts.filter(
      ([x, z]) => Math.abs(Math.abs(x) - 130) < 1e-3 && Math.abs(Math.abs(z) - 130) < 1e-3,
    );
    expect(corners.length).toBeGreaterThanOrEqual(4);
  });

  it('is the night’s own colour before its rim, from wherever the camera stands', () => {
    // The camera stands at most about 45 from the axis (zoomed out on a phone)
    expect(VEIL[1]).toBeLessThanOrEqual(GROUND_RADIUS - 50);
    // and the colossal board (±32) and its sculptures stay clear of it
    expect(VEIL[0]).toBeGreaterThan(32 + 30);
  });
});
