import { describe, expect, it } from 'vitest';
import {
  aimingLens,
  askingLens,
  convexHull,
  decideTap,
  distanceToHull,
  fromLens,
  inRect,
  LENS_PX,
  LENS_REACH_PX,
  LENS_SPACING_PX,
  LENS_ZOOM,
  MAX_CANDIDATES,
  NOTHING_PX,
  pickInLens,
  recordTap,
  spreadOf,
  TAP_SPREAD_PX,
  TIE_ODDS,
  CANDIDATE_ODDS,
  tapTarget,
  toLens,
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
/** A move's mark about as a phone shows one (20 x 7 px), with the held piece standing on it above. */
const mark = (id: string, x: number, y: number, standing = true): TapTarget =>
  tapTarget(id, 'destination', box(x, y, 20, 7), standing ? box(x, y - 12, 17, 28) : []);

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
  it('takes its hull and middle from the hit shape, and its reach from the piece standing there too', () => {
    const t = mark('Ba3', 100, 100);
    expect(t.hull).toHaveLength(4);
    expect(t.centre).toEqual([100, 100]);
    expect(distanceToHull([100, 80], t.hull)).toBeGreaterThan(0);
    expect(distanceToHull([100, 80], t.reach)).toBe(0);
    // Without one, its reach is its hull
    const bare = mark('Ba3', 0, 0, false);
    expect(bare.reach).toBe(bare.hull);
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

  it('asks between two moves a tap lies between, the likelier first', () => {
    const targets = [mark('m', 100, 100), mark('n', 122, 100)];
    expect(decideTap([109, 100], targets, { holding: true, direct: null })).toEqual({
      act: 'ask',
      ids: ['m', 'n'],
    });
  });

  it('asks even when the ray hit one of two close marks', () => {
    const targets = [mark('m', 100, 100), mark('n', 120, 100)];
    const decision = decideTap([108, 100], targets, { holding: true, direct: 'm' });
    expect(decision).toEqual({ act: 'ask', ids: ['m', 'n'] });
  });

  it('asks between a move and a piece nearly as likely', () => {
    const targets = [mark('m', 100, 100), piece('p', 100, 70)];
    const decision = decideTap([100, 86], targets, { holding: true, direct: null });
    expect(decision).toEqual({ act: 'ask', ids: ['m', 'p'] });
  });

  it(`plays the likelier move when the next is less than 1 / ${TIE_ODDS} as likely`, () => {
    const targets = [mark('m', 100, 100), mark('n', 136, 100), piece('p', 100, 66)];
    expect(decideTap([104, 103], targets, { holding: true, direct: null })).toEqual({
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

  it('counts a tap above a mark, where the piece would stand, as near the mark', () => {
    const targets = [mark('m', 100, 100), mark('n', 160, 100)];
    expect(decideTap([100, 86], targets, { holding: true, direct: null })).toEqual({
      act: 'take',
      id: 'm',
    });
  });

  it(`asks about ${MAX_CANDIDATES} at most, each at least 1 / ${CANDIDATE_ODDS} as likely as the likeliest`, () => {
    const targets = Array.from({ length: 8 }, (_, k) =>
      mark(String(k), 100 + 9 * Math.cos(k), 100 + 9 * Math.sin(k), false),
    );
    const decision = decideTap([100, 100], targets, { holding: true, direct: null });
    expect(decision.act).toBe('ask');
    if (decision.act === 'ask') expect(decision.ids).toHaveLength(MAX_CANDIDATES);
  });

  it('asks less of a steadier hand', () => {
    const targets = [mark('m', 100, 100), mark('n', 130, 100)];
    const tap: ScreenPoint = [108, 100];
    expect(decideTap(tap, targets, { holding: true, direct: null, spread: 14 }).act).toBe('ask');
    expect(decideTap(tap, targets, { holding: true, direct: null, spread: 6 })).toEqual({
      act: 'take',
      id: 'm',
    });
  });
});

describe('the magnifier', () => {
  const view = { width: 390, height: 844, top: 100 };

  it('sets the two closest candidates a fingertip apart, within its zoom', () => {
    const candidates = [mark('m', 200, 400), mark('n', 214, 400)];
    const lens = askingLens([207, 402], candidates, view);
    expect(lens.zoom).toBe(LENS_SPACING_PX / 14);
    const [a, b] = candidates.map((c) => toLens(c.centre, lens));
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(LENS_SPACING_PX);
    // Apart, the least zoom; on top of each other, the most
    expect(askingLens([0, 0], [mark('m', 200, 400), mark('n', 230, 400)], view).zoom).toBe(
      LENS_ZOOM.min,
    );
    expect(askingLens([0, 0], [mark('m', 200, 400), mark('n', 201, 400)], view).zoom).toBe(
      LENS_ZOOM.max,
    );
  });

  it('shows the two likeliest whole, zooming out only when they spread', () => {
    const whole = (c: TapTarget, lens: ReturnType<typeof askingLens>) =>
      c.hull.every((p) => inRect(toLens(p, lens), lens.frame));
    // Close together, and a third far off: the two big, the third left out
    const near = [mark('m', 150, 400), mark('n', 168, 400), mark('o', 280, 400)];
    const lens = askingLens([160, 400], near, view);
    expect(lens.zoom).toBeGreaterThanOrEqual(LENS_ZOOM.min);
    expect(whole(near[0], lens) && whole(near[1], lens)).toBe(true);
    expect(whole(near[2], lens)).toBe(false);
    // The two likeliest far apart: zoomed out to show them
    const spread = [mark('m', 150, 400), mark('o', 260, 400), mark('n', 160, 400)];
    const out = askingLens([200, 400], spread, view);
    expect(out.zoom).toBeLessThan(LENS_ZOOM.min);
    expect(whole(spread[0], out) && whole(spread[1], out)).toBe(true);
  });

  it('stands above the finger, below it when there is no room, and inside the window', () => {
    const candidates = [mark('m', 200, 400), mark('n', 220, 400)];
    const above = askingLens([210, 600], candidates, view);
    expect(above.frame.y + above.frame.height).toBeLessThan(600);
    expect(above.frame.width).toBe(LENS_PX);
    const below = askingLens([210, 200], candidates, view);
    expect(below.frame.y).toBeGreaterThan(200);
    const edge = askingLens([5, 600], candidates, view);
    expect(edge.frame.x).toBeGreaterThanOrEqual(0);
    const narrow = askingLens([100, 600], candidates, { width: 200, height: 400 });
    expect(narrow.frame.x + narrow.frame.width).toBeLessThanOrEqual(200);
  });

  it('maps between the view and the lens both ways', () => {
    const lens = aimingLens([200, 500], view);
    expect(lens.zoom).toBe(LENS_ZOOM.aim);
    // The finger at the middle of the lens
    const [x, y] = toLens([200, 500], lens);
    expect(x).toBeCloseTo(lens.frame.x + lens.frame.width / 2);
    expect(y).toBeCloseTo(lens.frame.y + lens.frame.height / 2);
    const back = fromLens(toLens([190, 507], lens), lens);
    expect(back[0]).toBeCloseTo(190);
    expect(back[1]).toBeCloseTo(507);
  });

  it('picks the candidate a tap in it is nearest, within its reach', () => {
    const candidates = [mark('m', 200, 400), mark('n', 214, 400)];
    expect(pickInLens([201, 400], candidates, 4)).toBe('m');
    expect(pickInLens([213, 401], candidates, 4)).toBe('n');
    expect(pickInLens([200, 400 + (LENS_REACH_PX + 4) / 4 + 3.5], candidates, 4)).toBe(null);
    expect(pickInLens([200, 400], [], 4)).toBe(null);
  });
});

describe("the player's spread", () => {
  it('is the default until the player has tapped', () => {
    expect(spreadOf(null)).toBe(TAP_SPREAD_PX);
    expect(spreadOf({ n: 0, sumSq: 0 })).toBe(TAP_SPREAD_PX);
  });

  it('follows their taps, within bounds', () => {
    let steady = { n: 0, sumSq: 0 };
    let shaky = { n: 0, sumSq: 0 };
    for (let k = 0; k < 40; k++) {
      steady = recordTap(steady, [4, 3]);
      shaky = recordTap(shaky, [20, 15]);
    }
    expect(spreadOf(steady)).toBeLessThan(TAP_SPREAD_PX);
    expect(spreadOf(steady)).toBeGreaterThanOrEqual(6);
    expect(spreadOf(shaky)).toBe(14);
  });

  it('keeps only the latest taps', () => {
    let record = { n: 0, sumSq: 0 };
    for (let k = 0; k < 200; k++) record = recordTap(record, [20, 0]);
    expect(record.n).toBe(60);
    for (let k = 0; k < 400; k++) record = recordTap(record, [2, 0]);
    expect(record.n).toBe(60);
    expect(record.sumSq / record.n).toBeLessThan(10);
  });
});
