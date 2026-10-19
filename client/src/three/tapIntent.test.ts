import { describe, expect, it } from 'vitest';
import {
  convexHull,
  decideTap,
  distanceToHull,
  MOVE_ODDS,
  NOTHING_PX,
  tapTarget,
} from './tapIntent';
import type { ScreenPoint, TapTarget } from './tapIntent';

/** A w×h box's corners, centred on (x, y). */
const box = (x: number, y: number, w: number, h = w): ScreenPoint[] => [
  [x - w / 2, y - h / 2],
  [x + w / 2, y - h / 2],
  [x + w / 2, y + h / 2],
  [x - w / 2, y + h / 2],
];

/** A piece about as a phone shows one: 17 x 28 px. */
const piece = (id: string, x: number, y: number, w = 17, h = 28): TapTarget =>
  tapTarget(id, 'piece', box(x, y, w, h));
/** A move's mark about as a phone shows one: 20 x 7 px. */
const mark = (id: string, x: number, y: number): TapTarget =>
  tapTarget(id, 'destination', box(x, y, 20, 7));

describe('convexHull', () => {
  it('keeps the outer points of a cloud, dropping the ones inside and on its edges', () => {
    const hull = convexHull([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5, 5],
      [5, 0],
      [3, 7],
    ]);
    expect(hull).toHaveLength(4);
    expect(new Set(hull.map((p) => p.join(',')))).toEqual(
      new Set(['0,0', '10,0', '10,10', '0,10']),
    );
  });

  it('passes fewer than three points through', () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([[1, 2]])).toEqual([[1, 2]]);
    expect(
      convexHull([
        [3, 0],
        [1, 0],
      ]),
    ).toEqual([
      [1, 0],
      [3, 0],
    ]);
  });

  it('reduces collinear points to their ends', () => {
    expect(
      convexHull([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    ).toEqual([
      [0, 0],
      [3, 3],
    ]);
  });
});

describe('distanceToHull', () => {
  const hull = convexHull(box(0, 0, 20));

  it('is zero inside and on the outline', () => {
    expect(distanceToHull([0, 0], hull)).toBe(0);
    expect(distanceToHull([9, -9], hull)).toBe(0);
    expect(distanceToHull([10, 3], hull)).toBe(0);
  });

  it('measures to the nearest edge or corner outside', () => {
    expect(distanceToHull([15, 0], hull)).toBeCloseTo(5);
    expect(distanceToHull([0, -18], hull)).toBeCloseTo(8);
    expect(distanceToHull([13, 14], hull)).toBeCloseTo(5);
  });

  it('handles a point and a segment', () => {
    expect(distanceToHull([3, 4], [[0, 0]])).toBeCloseTo(5);
    expect(
      distanceToHull(
        [5, 3],
        [
          [0, 0],
          [10, 0],
        ],
      ),
    ).toBeCloseTo(3);
    expect(distanceToHull([0, 0], [])).toBe(Infinity);
  });
});

describe('tapTarget', () => {
  it('takes its hull and middle from the hit shape', () => {
    const t = mark('Ba3', 100, 100);
    expect(t.hull).toHaveLength(4);
    expect(t.centre).toEqual([100, 100]);
  });
});

describe('decideTap', () => {
  const nothingHeld = { holding: false, direct: null };

  it('takes a piece the ray hit, whatever lies near it', () => {
    const targets = [piece('a', 100, 100), mark('m', 112, 104)];
    expect(decideTap([100, 100], targets, { holding: true, direct: 'a' })).toEqual({
      act: 'take',
      id: 'a',
    });
  });

  it('picks up the likeliest piece when nothing is held, however close the call', () => {
    const targets = [piece('a', 100, 100), piece('b', 120, 100)];
    expect(decideTap([108, 100], targets, nothingHeld)).toEqual({ act: 'take', id: 'a' });
    expect(decideTap([112, 100], targets, nothingHeld)).toEqual({ act: 'take', id: 'b' });
  });

  it(`means nothing ${NOTHING_PX} px clear of everything`, () => {
    const targets = [piece('a', 100, 100)];
    const clear = 100 + 17 / 2 + NOTHING_PX + 2;
    expect(decideTap([clear, 100], targets, nothingHeld)).toEqual({ act: 'none' });
    expect(decideTap([clear - 12, 100], targets, nothingHeld)).toEqual({ act: 'take', id: 'a' });
    expect(decideTap([0, 0], [], nothingHeld)).toEqual({ act: 'none' });
  });

  it('plays a move it is sure of', () => {
    const targets = [mark('m', 100, 100), mark('far', 220, 100)];
    expect(decideTap([100, 100], targets, { holding: true, direct: 'm' })).toEqual({
      act: 'take',
      id: 'm',
    });
  });

  it('plays a move whose mark the ray hit first, however close its neighbour', () => {
    const targets = [mark('m', 100, 100), mark('n', 120, 100)];
    expect(decideTap([109, 100], targets, { holding: true, direct: 'm' })).toEqual({
      act: 'take',
      id: 'm',
    });
    // Even nearer the other's middle: the ray's hit is what the finger is on
    expect(decideTap([111, 100], targets, { holding: true, direct: 'm' })).toEqual({
      act: 'take',
      id: 'm',
    });
  });

  it('plays the likelier of two moves a tap lies between, its ray hitting neither', () => {
    const targets = [mark('m', 100, 100), mark('n', 122, 100)];
    expect(decideTap([109, 100], targets, { holding: true, direct: null })).toEqual({
      act: 'take',
      id: 'm',
    });
    expect(decideTap([113, 100], targets, { holding: true, direct: null })).toEqual({
      act: 'take',
      id: 'n',
    });
  });

  it(`counts a move ${MOVE_ODDS} times a piece while one is held`, () => {
    const targets = [mark('m', 100, 100), piece('p', 100, 70)];
    // Nearer the pawn, but not by enough
    expect(decideTap([100, 88], targets, { holding: true, direct: null })).toEqual({
      act: 'take',
      id: 'm',
    });
  });

  it('picks up a piece likelier than any move, a move close behind or not', () => {
    const targets = [mark('m', 100, 100), piece('p', 100, 70)];
    expect(decideTap([100, 62], targets, { holding: true, direct: null })).toEqual({
      act: 'take',
      id: 'p',
    });
  });

  it('takes a piece near a tap when no move is in the running', () => {
    const targets = [mark('m', 300, 300), piece('p', 100, 100)];
    expect(decideTap([110, 100], targets, { holding: true, direct: null })).toEqual({
      act: 'take',
      id: 'p',
    });
  });

  it('gives a near miss beside a lone mark to that mark, never putting the piece down', () => {
    const targets = [mark('m', 100, 100), piece('far', 300, 300)];
    for (const tap of [
      [140, 100],
      [60, 100],
      [100, 140],
      [100, 50],
    ] as ScreenPoint[]) {
      expect(decideTap(tap, targets, { holding: true, direct: null })).toEqual({
        act: 'take',
        id: 'm',
      });
    }
  });
});
