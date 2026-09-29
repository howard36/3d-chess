import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { layout } from '../scene/palette';
import { PROFILES } from '../pieces';
import { PieceType } from '../../engine/pieces';
import {
  arrivalRing,
  blendPose,
  breath,
  cardBeside,
  entranceFrom,
  faceAngle,
  FLOOR_Y,
  formForFill,
  gameOpening,
  kingEntrance,
  KING_SCALE,
  KING_TOP,
  LOBBY_FOV,
  LOBBY_ENTRANCE,
  LOBBY_TIMING,
  leaveDirection,
  lobbyPose,
  outlineForFill,
  placeRing,
  poseFromDirection,
  posePosition,
  SEAT_SPACING,
  seatOpening,
  seatX,
  settlePose,
  tossAngle,
  tossGlide,
  tossHop,
  tossLanded,
} from './lobbyMotion';
import type { CameraPose, Side } from './lobbyMotion';
import { introPlan } from '../intro/timeline';

// Behaviour, not tuning: the timings, heights and framing shares are the
// design's to change; what the scene relies on is tested here.

const TAU = Math.PI * 2;
/** `a` reduced to [0, 2π). */
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
const samples = (from: number, to: number, n = 200) =>
  Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);

const { toss, tossHold, tossGlide: glideTime } = LOBBY_TIMING;
/** When the landed coin reaches its seat. */
const tossEnd = toss + tossHold + glideTime;

describe('the coin toss', () => {
  it.each<Side>(['white', 'black'])('lands on the %s face when the spin ends', (side) => {
    const end = tossAngle(toss, side);
    // The same angle as the face, some whole turns on
    const off = wrap(end - faceAngle(side));
    expect(Math.min(off, TAU - off)).toBeCloseTo(0, 9);
    // A real spin, not a nudge
    expect(end).toBeGreaterThan(TAU);
    // ...and stays there once the spin is over
    expect(tossAngle(toss * 3, side)).toBeCloseTo(end, 12);
  });

  it.each<Side>(['white', 'black'])(
    'turns one way only toward the %s face and never passes it',
    (side) => {
      const end = tossAngle(toss, side);
      let prev = tossAngle(0, side);
      expect(prev).toBe(0);
      for (const t of samples(0, toss * 1.5)) {
        const angle = tossAngle(t, side);
        expect(angle).toBeGreaterThanOrEqual(prev);
        expect(angle).toBeLessThanOrEqual(end + 1e-12);
        prev = angle;
      }
    },
  );

  it('shows opposite faces for the two sides', () => {
    expect(wrap(faceAngle('white') - faceAngle('black'))).toBeCloseTo(Math.PI, 12);
  });

  it('spins slower as it comes to rest', () => {
    const early = tossAngle(0.1 * toss, 'white') - tossAngle(0, 'white');
    const late = tossAngle(toss, 'white') - tossAngle(0.9 * toss, 'white');
    expect(late).toBeLessThan(early / 10);
  });

  it('is thrown up and is down again when the spin ends', () => {
    expect(tossHop(0)).toBeCloseTo(0, 12);
    expect(tossHop(toss / 2)).toBeGreaterThan(0);
    expect(tossHop(toss)).toBeCloseTo(0, 12);
    expect(tossHop(toss * 2)).toBeCloseTo(0, 12);
    // Highest in the middle of the spin, never below the glass
    const peak = tossHop(toss / 2);
    for (const t of samples(0, toss)) {
      expect(tossHop(t)).toBeGreaterThanOrEqual(-1e-12);
      expect(tossHop(t)).toBeLessThanOrEqual(peak + 1e-12);
    }
  });

  it('holds its face, then glides to its seat and lands there', () => {
    // Still while it spins and while it shows its face
    for (const t of samples(0, toss + tossHold, 50)) expect(tossGlide(t)).toBe(0);
    let prev = 0;
    for (const t of samples(toss + tossHold, tossEnd, 50)) {
      const g = tossGlide(t);
      expect(g).toBeGreaterThanOrEqual(prev);
      expect(g).toBeLessThanOrEqual(1);
      prev = g;
    }
    expect(tossGlide(tossEnd)).toBe(1);
    expect(tossGlide(tossEnd + 5)).toBe(1);
    // Landed exactly when the glide is over
    expect(tossLanded(0)).toBe(false);
    expect(tossLanded(toss)).toBe(false);
    expect(tossLanded(tossEnd - 1e-6)).toBe(false);
    expect(tossLanded(tossEnd)).toBe(true);
    expect(tossLanded(tossEnd + 5)).toBe(true);
  });
});

describe('the fill', () => {
  it('forms nothing at an empty fill and the whole king at a whole one', () => {
    expect(formForFill(0)).toBe(0);
    expect(formForFill(1)).toBe(1);
    // Out of range: clamped
    expect(formForFill(-0.5)).toBe(0);
    expect(formForFill(2)).toBe(1);
  });

  it('forms more of the king as it fills', () => {
    let prev = -Infinity;
    for (const f of samples(0, 1)) {
      const form = formForFill(f);
      expect(form).toBeGreaterThanOrEqual(prev);
      prev = form;
    }
  });

  it('gives the outline way to the material', () => {
    expect(outlineForFill(0)).toBe(1);
    expect(outlineForFill(1)).toBe(0);
    expect(outlineForFill(-1)).toBe(1);
    let prev = Infinity;
    for (const f of samples(0, 1)) {
      const glow = outlineForFill(f);
      expect(glow).toBeGreaterThanOrEqual(0);
      expect(glow).toBeLessThanOrEqual(1);
      expect(glow).toBeLessThanOrEqual(prev);
      prev = glow;
    }
  });

  it("opens a named pick's free seat with the invitation: after its label's delay, up to whole", () => {
    expect(seatOpening(0)).toBe(0);
    expect(seatOpening(LOBBY_TIMING.openDelay)).toBe(0);
    expect(seatOpening(LOBBY_TIMING.openDelay + LOBBY_TIMING.open)).toBe(1);
    expect(seatOpening(Infinity)).toBe(1);
    let prev = 0;
    for (const t of samples(0, 2)) {
      const open = seatOpening(t);
      expect(open).toBeGreaterThanOrEqual(prev);
      prev = open;
    }
  });

  it('breathes: full at rest, dipping and back on a slow period, calmer after a while', () => {
    expect(breath(0)).toBeCloseTo(1, 12);
    const early = samples(0, 12, 480).map(breath);
    const late = samples(120, 132, 480).map(breath);
    for (const b of [...early, ...late]) {
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThanOrEqual(1 + 1e-12);
    }
    // It dips, and comes back to full
    expect(Math.min(...early)).toBeLessThan(0.9);
    expect(Math.max(...early.slice(early.length / 2))).toBeCloseTo(1, 3);
    // A shallower breath once the wait has gone on
    expect(Math.min(...late)).toBeGreaterThan(Math.min(...early));
  });
});

/** Where a world point lands in a pose's view (NDC, -1 to 1 across the frame). */
const project = (pose: CameraPose, aspect: number, point: [number, number, number]) => {
  const camera = new PerspectiveCamera(LOBBY_FOV, aspect, 0.1, 900);
  camera.position.set(...posePosition(pose));
  camera.lookAt(new Vector3(...pose.target));
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return new Vector3(...point).project(camera);
};

const WIDE = 16 / 9;
const PHONE = 390 / 844;
const foot = FLOOR_Y;
const head = FLOOR_Y + KING_TOP * KING_SCALE;
/** A lobby king's half-width: its base, the widest part of it. */
const HALF_WIDTH = PROFILES.radius[PieceType.King] * KING_SCALE;

describe('the seats', () => {
  it.each([WIDE, 1, PHONE])(
    "put White's king on the left, Black's on the right and the coin between (aspect %s)",
    (aspect) => {
      expect(seatX('coin')).toBe(0);
      expect(seatX('white')).toBeLessThan(0);
      expect(seatX('black')).toBe(-seatX('white'));
      expect(seatX('black')).toBe(SEAT_SPACING);
      // Side by side, never overlapping, and centred on the glass's squares
      expect(SEAT_SPACING).toBeGreaterThan(2 * HALF_WIDTH);
      expect(Number.isInteger(SEAT_SPACING)).toBe(true);
      void aspect;
    },
  );

  it('stand further out, and smaller, in a narrow window than in a wide one', () => {
    const at = (aspect: number) => {
      const pose = lobbyPose(aspect);
      const x = seatX('black');
      return {
        out: project(pose, aspect, [x, foot, 0]).x,
        height: project(pose, aspect, [0, head, 0]).y - project(pose, aspect, [0, foot, 0]).y,
      };
    };
    expect(at(PHONE).out).toBeGreaterThan(at(WIDE).out);
    expect(at(PHONE).height).toBeLessThan(at(WIDE).height);
  });
});

/** Every window shape worth a thought: phones either way up, tablets, squares, ultrawides. */
const SHAPES = [
  360 / 800,
  390 / 844,
  768 / 1024,
  0.89,
  0.9,
  0.95,
  1,
  1.1,
  1024 / 768,
  1.5,
  16 / 10,
  16 / 9,
  2.16,
  21 / 9,
  32 / 9,
];

describe('the lobby camera', () => {
  it.each(SHAPES.flatMap((aspect) => [[aspect, false] as const, [aspect, true] as const]))(
    'keeps the whole row of kings in frame and apart at aspect %s (card: %s)',
    (aspect, card) => {
      const pose = lobbyPose(aspect, card);
      // Neighbouring kings apart on screen, edge to edge
      const edge = (x: number) => project(pose, aspect, [x, foot, 0]).x;
      expect(edge(seatX('coin') - HALF_WIDTH)).toBeGreaterThan(edge(seatX('white') + HALF_WIDTH));
      expect(edge(seatX('black') - HALF_WIDTH)).toBeGreaterThan(edge(seatX('coin') + HALF_WIDTH));
      for (const seat of ['white', 'coin', 'black'] as const) {
        const x = seatX(seat);
        for (const px of [x - HALF_WIDTH, x + HALF_WIDTH]) {
          for (const py of [foot, head]) {
            const p = project(pose, aspect, [px, py, 0]);
            expect(Math.abs(p.x)).toBeLessThan(0.95);
            expect(Math.abs(p.y)).toBeLessThan(0.95);
            expect(p.z).toBeLessThan(1);
          }
        }
      }
    },
  );

  it.each([
    ['a wide window', WIDE, false],
    ['a wide window with a card', WIDE, true],
    ['a phone', PHONE, false],
    ['a phone with a card', PHONE, true],
  ])('keeps the whole row of kings in frame in %s', (_, aspect, card) => {
    const pose = lobbyPose(aspect, card);
    for (const seat of ['white', 'coin', 'black'] as const) {
      const x = seatX(seat);
      // Each king's width either side, from foot to crown
      for (const px of [x - HALF_WIDTH, x + HALF_WIDTH]) {
        for (const py of [foot, head]) {
          const p = project(pose, aspect, [px, py, 0]);
          expect(Math.abs(p.x)).toBeLessThan(0.95);
          expect(Math.abs(p.y)).toBeLessThan(0.95);
          expect(p.z).toBeLessThan(1);
        }
      }
    }
    // The row stands level across the frame, White's on the left
    const white = project(pose, aspect, [seatX('white'), foot, 0]);
    const black = project(pose, aspect, [seatX('black'), foot, 0]);
    expect(white.x).toBeCloseTo(-black.x, 9);
    expect(white.y).toBeCloseTo(black.y, 9);
  });

  it('puts the card beside the kings only in a short, wide window', () => {
    expect(cardBeside(844, 390)).toBe(true);
    expect(cardBeside(667, 375)).toBe(true);
    expect(cardBeside(1440, 900)).toBe(false);
    expect(cardBeside(390, 844)).toBe(false);
    expect(cardBeside(500, 480)).toBe(false);
  });

  it.each([844 / 390, 667 / 375, 1.4])(
    'moves the row left of a card docked beside it, still in frame (aspect %s)',
    (aspect) => {
      const pose = lobbyPose(aspect, true, true);
      const right = project(pose, aspect, [seatX('black') + HALF_WIDTH, foot, 0]).x;
      const left = project(pose, aspect, [seatX('white') - HALF_WIDTH, foot, 0]).x;
      // The card takes the right of the frame, the kings the left
      expect(right).toBeLessThan(0.15);
      expect(left).toBeGreaterThan(-0.95);
      for (const py of [foot, head]) {
        expect(Math.abs(project(pose, aspect, [0, py, 0]).y)).toBeLessThan(0.95);
      }
    },
  );

  it('raises the kings on screen while a card is docked under them', () => {
    const mid = (card: boolean) =>
      project(lobbyPose(WIDE, card), WIDE, [0, (foot + head) / 2, 0]).y;
    expect(mid(true)).toBeGreaterThan(mid(false));
  });

  it('looks from the near side, a little above the glass', () => {
    for (const aspect of [WIDE, PHONE]) {
      const pose = lobbyPose(aspect);
      expect(pose.azimuth).toBe(0);
      expect(pose.elevation).toBeGreaterThan(0);
      expect(pose.elevation).toBeLessThan(Math.PI / 4);
      expect(posePosition(pose)[1]).toBeGreaterThan(FLOOR_Y);
    }
  });

  it('places the camera from a pose, and a pose from a direction', () => {
    const pose = poseFromDirection([1, 2, 3], [0, 3, 4], 10);
    expect(pose.distance).toBe(10);
    const [x, y, z] = posePosition(pose);
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(2 + 6, 12);
    expect(z).toBeCloseTo(3 + 8, 12);
    // A zero direction does not divide by zero
    expect(Number.isFinite(poseFromDirection([0, 0, 0], [0, 0, 0], 1).azimuth)).toBe(true);
  });
});

describe('blending two poses', () => {
  const a: CameraPose = { target: [0, 0, 0], azimuth: 0.2, elevation: 0.1, distance: 5 };
  const b: CameraPose = { target: [1, 2, 3], azimuth: 1.2, elevation: 0.6, distance: 20 };

  it('starts at the first and ends at the second', () => {
    expect(blendPose(a, b, 0)).toEqual(a);
    const end = blendPose(a, b, 1);
    expect(end.target).toEqual(b.target);
    expect(end.azimuth).toBeCloseTo(b.azimuth, 12);
    expect(end.elevation).toBeCloseTo(b.elevation, 12);
    expect(end.distance).toBeCloseTo(b.distance, 12);
  });

  it('eases in and out, drawing back geometrically', () => {
    const mid = blendPose(a, b, 0.5);
    expect(mid.target[1]).toBeCloseTo(1, 12);
    expect(mid.distance).toBeCloseTo(Math.sqrt(5 * 20), 12);
    // Slow at both ends
    expect(blendPose(a, b, 0.1).elevation - a.elevation).toBeLessThan(
      0.1 * (b.elevation - a.elevation),
    );
    expect(b.elevation - blendPose(a, b, 0.9).elevation).toBeLessThan(
      0.1 * (b.elevation - a.elevation),
    );
  });

  it('turns the short way round', () => {
    // From just short of +π to just past -π: through π, not through 0
    const from: CameraPose = { ...a, azimuth: 3 };
    const to: CameraPose = { ...a, azimuth: -3 };
    const mid = blendPose(from, to, 0.5);
    expect(mid.azimuth).toBeCloseTo(Math.PI, 12);
    const end = blendPose(from, to, 1);
    expect(end.azimuth).toBeCloseTo(TAU - 3, 12);
    expect(wrap(end.azimuth)).toBeCloseTo(wrap(-3), 12);
    for (const t of samples(0, 1, 50)) {
      const az = blendPose(from, to, t).azimuth;
      expect(az).toBeGreaterThanOrEqual(3 - 1e-12);
      expect(az).toBeLessThanOrEqual(TAU - 3 + 1e-12);
    }
  });
});

describe('handing over to the game', () => {
  it("leaves along the game's opening direction for White", () => {
    expect(leaveDirection('white')).toEqual([...layout.viewDirection]);
  });

  it('goes round to the far side for Black, mirrored through the vertical', () => {
    const [x, y, z] = layout.viewDirection;
    const [bx, by, bz] = leaveDirection('black');
    expect(bx).toBeCloseTo(-x, 12);
    expect(by).toBe(y);
    expect(bz).toBeCloseTo(-z, 12);
  });

  it('answers a seat being taken with a ring that spreads and fades', () => {
    const start = arrivalRing(0);
    const end = arrivalRing(1.4);
    expect(start.strength).toBeGreaterThan(0);
    expect(arrivalRing(0.7).strength).toBeLessThan(start.strength);
    expect(arrivalRing(0.7).radius).toBeGreaterThan(start.radius);
    expect(end.radius).toBeGreaterThan(arrivalRing(0.7).radius);
    expect(end.strength).toBe(0);
    expect(arrivalRing(10)).toEqual(end);
  });

  it("ends on the game's first frame: its fitted distance times the entrance's dolly", () => {
    const white = gameOpening('white', 1280, 800);
    const black = gameOpening('black', 1280, 800);
    const opening = poseFromDirection([0, 0, 0], leaveDirection('white'), 1);
    expect(white.pose.elevation).toBeCloseTo(opening.elevation, 12);
    expect(white.pose.azimuth).toBeCloseTo(opening.azimuth, 12);
    // The same framing from either side, round the tower
    expect(black.pose.distance).toBeCloseTo(white.pose.distance, 9);
    expect(black.shift).toEqual(white.shift);
    // Under reduced motion the game has no dolly, so the lobby stops where it fits
    const reduced = gameOpening('white', 1280, 800, true);
    expect(reduced.pose.distance / introPlan('lobby', true).dolly.from).toBeCloseTo(
      white.pose.distance / introPlan('lobby').dolly.from,
      9,
    );
    expect(reduced.pose.distance).toBeLessThan(white.pose.distance);
  });

  it('answers a king set on its seat with a ring that is gone by the time it has formed', () => {
    expect(placeRing(0).strength).toBeGreaterThan(0);
    expect(placeRing(0.4).radius).toBeGreaterThan(placeRing(0).radius);
    expect(placeRing(0.8).strength).toBeLessThanOrEqual(0.002);
    expect(placeRing(5)).toEqual(placeRing(0.8));
  });
});

describe('the entrance', () => {
  const rest: CameraPose = { target: [0, 1, 0], azimuth: 0.3, elevation: 0.2, distance: 20 };

  it('comes in from further out and higher', () => {
    const from = entranceFrom(rest);
    expect(from.distance).toBeGreaterThan(rest.distance);
    expect(from.elevation).toBeGreaterThan(rest.elevation);
    expect(from.azimuth).toBe(rest.azimuth);
    expect(from.target).toEqual(rest.target);
  });

  it('settles onto its rest without passing it, and stays there', () => {
    const from = entranceFrom(rest);
    expect(settlePose(from, rest, 0)).toEqual(from);
    const distances = samples(0, 1).map((t) => settlePose(from, rest, t).distance);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThanOrEqual(distances[i - 1]);
      expect(distances[i]).toBeGreaterThanOrEqual(rest.distance);
    }
    expect(settlePose(from, rest, 1).distance).toBeCloseTo(rest.distance, 12);
    expect(settlePose(from, rest, 3)).toEqual(settlePose(from, rest, 1));
  });

  it("brings a king's outline up before it forms, the kings in turn", () => {
    const { white, coin, black } = LOBBY_ENTRANCE.king;
    expect(white).toBeLessThan(coin);
    expect(coin).toBeLessThan(black);
    expect(kingEntrance(0, white)).toEqual({ outline: 0, forming: false });
    const early = kingEntrance(white - LOBBY_ENTRANCE.outline / 2, white);
    expect(early.outline).toBeGreaterThan(0);
    expect(early.forming).toBe(false);
    expect(kingEntrance(white, white)).toEqual({ outline: 1, forming: true });
    expect(kingEntrance(10, white)).toEqual({ outline: 1, forming: true });
  });
});
