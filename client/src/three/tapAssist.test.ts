import { describe, expect, it } from 'vitest';
import {
  convexHull,
  DESTINATION_PREFERENCE_PX,
  distanceToHull,
  resolveTap,
  TAP_REACH_PX,
} from './tapAssist';
import type { ScreenPoint, TapTarget } from './tapAssist';

/** A w×h box's corners, centred on (x, y). */
const box = (x: number, y: number, w: number, h = w): ScreenPoint[] => [
  [x - w / 2, y - h / 2],
  [x + w / 2, y - h / 2],
  [x + w / 2, y + h / 2],
  [x - w / 2, y + h / 2],
];

const piece = (id: string, x: number, y: number, w = 14, h = 30): TapTarget => ({
  id,
  kind: 'piece',
  outline: box(x, y, w, h),
});
const square = (id: string, x: number, y: number, w = 24, h = 10): TapTarget => ({
  id,
  kind: 'destination',
  outline: box(x, y, w, h),
});

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

describe('resolveTap', () => {
  it('takes the target nearest by outline and centre together', () => {
    const targets = [piece('a', 100, 100), piece('b', 140, 100)];
    // Halfway between two alike: the first; a pixel nearer b: b
    expect(resolveTap([120, 100], targets)?.id).toBe('a');
    expect(resolveTap([121, 100], targets)?.id).toBe('b');
  });

  it('does not give every tap along a seam to the bigger piece in front', () => {
    // A big front piece overlapping a small back one's lower left on screen:
    // a tap just left of the small one's middle is a hair nearer the big
    // one's outline, but much nearer the small one's centre
    const back = piece('back', 100, 100, 16, 28);
    const front: TapTarget = { id: 'front', kind: 'piece', outline: box(84, 122, 18, 32) };
    // (3 px from the back one's outline, 2 from the front one's)
    expect(resolveTap([89, 104], [back, front])?.id).toBe('back');
    // Further down the seam, the front piece
    expect(resolveTap([90, 112], [back, front])?.id).toBe('front');
  });

  it('gives a tap inside a target to that target', () => {
    expect(resolveTap([100, 110], [piece('a', 100, 100), piece('b', 130, 100)])?.id).toBe('a');
  });

  it('measures to the outline, not the centre: beside a tall piece its whole height is near', () => {
    // 10 px beside the top of a 60 px tall piece, 30 px from its centre
    expect(resolveTap([117, 75], [piece('king', 100, 100, 14, 60)])?.id).toBe('king');
  });

  it('reaches TAP_REACH_PX and no further', () => {
    const edge = 100 + 7;
    expect(resolveTap([edge + TAP_REACH_PX, 100], [piece('a', 100, 100)])?.id).toBe('a');
    expect(resolveTap([edge + TAP_REACH_PX + 0.5, 100], [piece('a', 100, 100)])).toBeNull();
    expect(resolveTap([400, 400], [piece('a', 100, 100), square('b', 120, 140)])).toBeNull();
  });

  it('takes a custom reach', () => {
    expect(resolveTap([120, 100], [piece('a', 100, 100)], { reach: 10 })).toBeNull();
    expect(resolveTap([116, 100], [piece('a', 100, 100)], { reach: 10 })?.id).toBe('a');
  });

  it('is null with nothing to act on', () => {
    expect(resolveTap([100, 100], [])).toBeNull();
    expect(resolveTap([100, 100], [{ id: 'empty', kind: 'piece', outline: [] }])).toBeNull();
  });

  it('breaks a tie of outlines (a tap inside two) by the nearer centre', () => {
    // Two overlapping outlines, both containing the tap
    const targets = [square('back', 100, 95, 30, 20), square('front', 100, 108, 30, 20)];
    expect(resolveTap([100, 99], targets)?.id).toBe('back');
    expect(resolveTap([100, 104], targets)?.id).toBe('front');
  });

  it('keeps the first of exactly equal candidates', () => {
    const targets = [piece('a', 100, 100), piece('b', 100, 100)];
    expect(resolveTap([120, 100], targets)?.id).toBe('a');
  });

  describe('while a piece is held', () => {
    const held = piece('held', 60, 100);
    const neighbour = piece('neighbour', 100, 100);
    const destination = square('dest', 100, 140, 24, 10);

    it('lets a destination win a near tie with another piece', () => {
      // 6.5 px below the neighbour's outline (y 115), 13.5 px above the
      // square's (y 135): the neighbour is 4 px nearer, outline and centre
      // together, inside the preference
      const tap: ScreenPoint = [100, 121.5];
      expect(resolveTap(tap, [held, neighbour, destination], { holding: true })?.id).toBe('dest');
      expect(
        resolveTap(tap, [held, neighbour, destination], { holding: true, preference: 0 })?.id,
      ).toBe('neighbour');
    });

    it('still switches to a piece that is clearly nearer', () => {
      // 2 px from the neighbour's outline, 18 px from the square's
      const tap: ScreenPoint = [100, 117];
      expect(DESTINATION_PREFERENCE_PX).toBeLessThan(20);
      expect(resolveTap(tap, [held, neighbour, destination], { holding: true })?.id).toBe(
        'neighbour',
      );
    });

    it('treats putting the held piece down like a switch', () => {
      // Between the held piece (x 53..67) and a square just right of it
      const right = square('right', 90, 100, 24, 10);
      expect(resolveTap([72, 100], [held, right], { holding: true })?.id).toBe('right');
      expect(resolveTap([68, 100], [held, right], { holding: true })?.id).toBe('held');
    });

    it('takes a capture on a small far pawn from a tap just above it', () => {
      const pawn: TapTarget = { id: 'Dd5', kind: 'destination', outline: box(200, 60, 8, 11) };
      const ownFarPiece = piece('Cb3', 240, 110);
      expect(resolveTap([201, 44], [pawn, ownFarPiece], { holding: true })?.id).toBe('Dd5');
    });
  });
});
