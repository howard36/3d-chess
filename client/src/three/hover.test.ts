import { describe, expect, it } from 'vitest';
import { resolveHover } from './hover';
import type { FloorSquare, HoverRay } from './hover';

// Two levels of three squares in a row along z, one unit apart, the upper
// level 1.5 above the lower: A1 A2 A3 at y = 0, B1 B2 B3 at y = 1.5.
const floors: FloorSquare[] = [0, 1].flatMap((level) =>
  [0, 1, 2].map((i) => ({
    key: `${'AB'[level]}${i + 1}`,
    floor: [0, level * 1.5, -i] as [number, number, number],
  })),
);
const half: [number, number] = [0.5, 0.5];

/** A ray from `from` toward `to`. */
const ray = (from: [number, number, number], to: [number, number, number]): HoverRay => {
  const d = to.map((v, i) => v - from[i]);
  const l = Math.hypot(d[0], d[1], d[2]);
  return { origin: from, direction: d.map((v) => v / l) as [number, number, number] };
};
const camera: [number, number, number] = [0, 4, 6];

const none = new Map<string, number>();
/** Destinations whose marks fill their squares. */
const whole = (...keys: string[]) => new Map(keys.map((k) => [k, 1]));
const keyOf = (hit: ReturnType<typeof resolveHover>) => hit?.key ?? null;

describe('resolveHover', () => {
  it('finds the square whose floor is under the pointer, not the one in front of it', () => {
    // Aimed at the middle of A2: a tall box on A1 would catch this ray first
    expect(resolveHover(ray(camera, [0, 0, -1]), floors, half, null, none)).toEqual({
      key: 'A2',
      on: 'floor',
    });
    expect(keyOf(resolveHover(ray(camera, [0, 0, -2]), floors, half, null, none))).toBe('A3');
  });

  it('takes the first platform the ray crosses when two levels overlap on screen', () => {
    // Toward A3 through B's platform: B's square is nearer
    const r = ray([0, 8, 6], [0, 0, -2]);
    expect(keyOf(resolveHover(r, floors, half, null, none))).toMatch(/^B/);
  });

  it('prefers a piece under the pointer to the floor, even a nearer floor', () => {
    const r = ray([0, 8, 6], [0, 0, -2]);
    expect(resolveHover(r, floors, half, { key: 'A3', distance: 12 }, none)).toEqual({
      key: 'A3',
      on: 'piece',
    });
  });

  it('but lets a nearer legal destination win over a piece, as a click would', () => {
    const r = ray([0, 8, 6], [0, 0, -2]);
    const onB = keyOf(resolveHover(r, floors, half, null, none))!;
    expect(resolveHover(r, floors, half, { key: 'A3', distance: 12 }, whole(onB))).toEqual({
      key: onB,
      on: 'mark',
    });
    // A destination behind the piece does not
    expect(keyOf(resolveHover(r, floors, half, { key: 'B2', distance: 1 }, whole('A3')))).toBe(
      'B2',
    );
  });

  it("takes a destination only on its mark: its square's corners reach a mark beneath", () => {
    // Straight down through B1's corner onto A1's middle
    const down: [number, number, number] = [0.4, 5, -0.4];
    const r = { origin: down, direction: [0, -1, 0] as [number, number, number] };
    const marks = new Map([
      ['B1', 0.22],
      ['A1', 0.6],
    ]);
    expect(resolveHover(r, floors, half, null, marks)).toEqual({ key: 'A1', on: 'mark' });
    // With no mark beneath, the pointer is on B1's floor, not its mark
    expect(resolveHover(r, floors, half, null, new Map([['B1', 0.22]]))).toEqual({
      key: 'B1',
      on: 'floor',
    });
    // Through B1's mark itself, B1's mark
    const mid = { origin: [0, 5, 0] as [number, number, number], direction: r.direction };
    expect(resolveHover(mid, floors, half, null, marks)).toEqual({ key: 'B1', on: 'mark' });
  });

  it('is nothing off the board, or for a ray running level', () => {
    expect(resolveHover(ray(camera, [5, 0, 0]), floors, half, null, none)).toBeNull();
    expect(
      resolveHover({ origin: [0, 0.5, 5], direction: [0, 0, -1] }, floors, half, null, none),
    ).toBeNull();
    // Looking up and away from every floor
    expect(resolveHover(ray(camera, [0, 9, 0]), floors, half, null, none)).toBeNull();
  });
});
