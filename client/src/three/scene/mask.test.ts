import { describe, expect, it } from 'vitest';
import { shadeAt, shadeBelowFor } from './mask';

// The tower's shade reaches less far below the tower than round its top and
// sides from a low camera, and the same all round from high up.

const square: [number, number][] = [
  [-0.3, -0.3],
  [0.3, -0.3],
  [0.3, 0.3],
  [-0.3, 0.3],
];

describe("the tower's shade", () => {
  it('reaches as far below as above from a high camera', () => {
    const below = shadeBelowFor(Math.sin((60 * Math.PI) / 180));
    expect(below).toBe(1);
    expect(shadeAt(square, [0, -0.5], below)).toBeCloseTo(shadeAt(square, [0, 0.5], below), 6);
  });

  it('reaches less far below than above or beside from a low camera', () => {
    const below = shadeBelowFor(0);
    expect(below).toBeGreaterThan(2);
    const under = shadeAt(square, [0, -0.5], below);
    expect(under).toBeLessThan(shadeAt(square, [0, 0.5], below));
    expect(under).toBeLessThan(shadeAt(square, [0.5, 0], below));
    // Still smooth and full over the tower itself
    expect(shadeAt(square, [0, 0], below)).toBe(1);
  });

  it('shortens smoothly as the camera sinks', () => {
    let last = 1;
    for (let deg = 60; deg >= -15; deg -= 1) {
      const b = shadeBelowFor(Math.sin((deg * Math.PI) / 180));
      expect(b).toBeGreaterThanOrEqual(last - 1e-9);
      expect(b - last).toBeLessThan(0.2);
      last = b;
    }
  });
});
