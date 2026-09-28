import { describe, expect, it } from 'vitest';
import { PieceType } from '../engine';
import { readoutParts, resolveHover } from './hover';
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

describe('resolveHover', () => {
  it('finds the square whose floor is under the pointer, not the one in front of it', () => {
    // Aimed at the middle of A2: a tall box on A1 would catch this ray first
    expect(resolveHover(ray(camera, [0, 0, -1]), floors, half, null, new Set())).toBe('A2');
    expect(resolveHover(ray(camera, [0, 0, -2]), floors, half, null, new Set())).toBe('A3');
  });

  it('takes the first platform the ray crosses when two levels overlap on screen', () => {
    // Toward A3 through B's platform: B's square is nearer
    const r = ray([0, 8, 6], [0, 0, -2]);
    expect(resolveHover(r, floors, half, null, new Set())).toMatch(/^B/);
  });

  it('prefers a piece under the pointer to the floor, even a nearer floor', () => {
    const r = ray([0, 8, 6], [0, 0, -2]);
    expect(resolveHover(r, floors, half, { key: 'A3', distance: 12 }, new Set())).toBe('A3');
  });

  it('but lets a nearer legal destination win over a piece, as a click would', () => {
    const r = ray([0, 8, 6], [0, 0, -2]);
    const onB = resolveHover(r, floors, half, null, new Set())!;
    expect(resolveHover(r, floors, half, { key: 'A3', distance: 12 }, new Set([onB]))).toBe(onB);
    // A destination behind the piece does not
    expect(resolveHover(r, floors, half, { key: 'B2', distance: 1 }, new Set(['A3']))).toBe('B2');
  });

  it('is nothing off the board, or for a ray running level', () => {
    expect(resolveHover(ray(camera, [5, 0, 0]), floors, half, null, new Set())).toBeNull();
    expect(
      resolveHover({ origin: [0, 0.5, 5], direction: [0, 0, -1] }, floors, half, null, new Set()),
    ).toBeNull();
    // Looking up and away from every floor
    expect(resolveHover(ray(camera, [0, 9, 0]), floors, half, null, new Set())).toBeNull();
  });
});

describe('readoutParts', () => {
  it('names the cell and what stands there', () => {
    expect(readoutParts('Cc4', { type: PieceType.Bishop, color: 'white' })).toEqual({
      cell: 'Cc4',
      piece: 'White Bishop',
    });
    expect(readoutParts('Ee5', { type: PieceType.Unicorn, color: 'black' })).toEqual({
      cell: 'Ee5',
      piece: 'Black Unicorn',
    });
  });

  it('is just the cell when it is empty', () => {
    expect(readoutParts('Aa1', null)).toEqual({ cell: 'Aa1', piece: null });
  });
});
