import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { layout } from '../scene/palette';
import {
  arrivalRing,
  blendPose,
  breath,
  cutForFill,
  faceAngle,
  FLOOR_Y,
  KING_SCALE,
  KING_TOP,
  LOBBY_FOV,
  LOBBY_TIMING,
  leaveDirection,
  lobbyPose,
  outlineForFill,
  poseFromDirection,
  posePosition,
  seatSpacing,
  seatX,
  tossAngle,
  tossHop,
  waitDrift,
} from './lobbyMotion';
import type { CameraPose, Side } from './lobbyMotion';

const TAU = Math.PI * 2;
/** `a` reduced to [0, 2π). */
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
const samples = (from: number, to: number, n = 200) =>
  Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);

describe('the coin toss', () => {
  it.each<Side>(['white', 'black'])('lands on the %s face when the toss ends', (side) => {
    const end = tossAngle(LOBBY_TIMING.toss, side);
    // The same angle as the face, some whole turns on
    const off = wrap(end - faceAngle(side));
    expect(Math.min(off, TAU - off)).toBeCloseTo(0, 9);
    // Three turns and a bit: a real spin, not a nudge
    expect(end).toBeGreaterThan(TAU * 2.5);
    // ...and stays there once the toss is over
    expect(tossAngle(LOBBY_TIMING.toss * 3, side)).toBeCloseTo(end, 12);
  });

  it.each<Side>(['white', 'black'])(
    'turns one way only toward the %s face and never passes it',
    (side) => {
      const end = tossAngle(LOBBY_TIMING.toss, side);
      let prev = tossAngle(0, side);
      expect(prev).toBe(0);
      for (const t of samples(0, LOBBY_TIMING.toss * 1.5)) {
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
    const d = LOBBY_TIMING.toss;
    const early = tossAngle(0.1 * d, 'white') - tossAngle(0, 'white');
    const late = tossAngle(d, 'white') - tossAngle(0.9 * d, 'white');
    expect(late).toBeLessThan(early / 10);
  });

  it('hops off the hand and is down again before it lands', () => {
    expect(tossHop(0)).toBeCloseTo(0, 12);
    expect(Math.max(...samples(0, LOBBY_TIMING.toss).map((t) => tossHop(t)))).toBeCloseTo(0.22, 3);
    expect(tossHop(LOBBY_TIMING.toss)).toBeCloseTo(0, 12);
    for (const t of samples(0, LOBBY_TIMING.toss))
      expect(tossHop(t)).toBeGreaterThanOrEqual(-1e-12);
  });
});

describe('the fill', () => {
  it('cuts nothing away at an empty fill, and turns the cut off at a whole one', () => {
    expect(cutForFill(0)).toBeCloseTo(1.02, 12);
    expect(cutForFill(1)).toBe(-1);
    expect(cutForFill(2)).toBe(-1);
    // Out of range below: as empty
    expect(cutForFill(-0.5)).toBeCloseTo(1.02, 12);
    // Just short of whole, the cut is already below the foot
    expect(cutForFill(0.999)).toBeLessThan(0);
  });

  it('lowers the cut as the king fills', () => {
    let prev = Infinity;
    for (const f of samples(0, 1)) {
      const cut = cutForFill(f);
      expect(cut).toBeLessThanOrEqual(prev);
      prev = cut;
    }
  });

  it('gives the outline way to the material', () => {
    expect(outlineForFill(0)).toBe(1);
    expect(outlineForFill(1)).toBe(0);
    // Gone a little before the king is whole
    expect(outlineForFill(1 / 1.15)).toBeCloseTo(0, 12);
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

  it('breathes between 0.65 and 1 on a six-second period, calming after half a minute', () => {
    expect(breath(0)).toBeCloseTo(1, 12);
    expect(breath(3)).toBeCloseTo(0.65, 12);
    expect(breath(6)).toBeCloseTo(1, 12);
    for (const t of samples(0, 120, 2400)) {
      expect(breath(t)).toBeGreaterThanOrEqual(0.65 - 1e-12);
      expect(breath(t)).toBeLessThanOrEqual(1 + 1e-12);
    }
    // Calmer: after 50 s the depth is 40% of the first
    expect(breath(51)).toBeCloseTo(1 - 0.35 * 0.4, 12);
    expect(breath(123)).toBeCloseTo(1 - 0.35 * 0.4, 12);
  });
});

describe('the seats', () => {
  it('stand two squares apart in a wide window and one in a narrow one', () => {
    expect(seatSpacing(16 / 9)).toBe(2);
    expect(seatSpacing(1)).toBe(2);
    expect(seatSpacing(0.9)).toBe(2);
    expect(seatSpacing(390 / 844)).toBe(1);
  });

  it("put White's king on the left, Black's on the right and the coin between", () => {
    expect(seatX('white', 16 / 9)).toBe(-2);
    expect(seatX('coin', 16 / 9)).toBe(0);
    expect(seatX('black', 16 / 9)).toBe(2);
    expect(seatX('white', 390 / 844)).toBe(-1);
    expect(seatX('coin', 390 / 844)).toBe(0);
    expect(seatX('black', 390 / 844)).toBe(1);
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

describe('the lobby camera', () => {
  const foot = FLOOR_Y;
  const head = FLOOR_Y + KING_TOP * KING_SCALE;

  it.each([
    ['a wide window', 16 / 9, false],
    ['a wide window with a card', 16 / 9, true],
    ['a phone', 390 / 844, false],
    ['a phone with a card', 390 / 844, true],
  ])('keeps the whole row of kings in frame in %s', (_, aspect, card) => {
    const pose = lobbyPose(aspect, card);
    for (const seat of ['white', 'coin', 'black'] as const) {
      const x = seatX(seat, aspect);
      // Each king's width either side, from foot to crown
      for (const px of [x - 0.75, x + 0.75]) {
        for (const py of [foot, head]) {
          const p = project(pose, aspect, [px, py, 0]);
          expect(Math.abs(p.x)).toBeLessThan(0.95);
          expect(Math.abs(p.y)).toBeLessThan(0.95);
          expect(p.z).toBeLessThan(1);
        }
      }
    }
    // The kings' middle above the frame's centre, clear of the card under them
    const mid = project(pose, aspect, [0, (foot + head) / 2, 0]);
    expect(mid.y).toBeGreaterThan(0.05);
    // ...and the row filling most of the width in a wide window
    if (aspect > 1) {
      const right = project(pose, aspect, [seatX('black', aspect) + 0.75, foot, 0]);
      expect(right.x).toBeGreaterThan(0.6);
    }
  });

  it('looks low over the glass from the near side', () => {
    const pose = lobbyPose(16 / 9);
    expect(pose.azimuth).toBe(0);
    expect(pose.elevation).toBeCloseTo((11 * Math.PI) / 180, 12);
    expect(pose.distance).toBeGreaterThanOrEqual(4.4);
    // Higher with a card docked under the kings (wide windows only)
    expect(lobbyPose(16 / 9, true).target[1]).toBeLessThan(pose.target[1]);
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

  it('drifts a little way round while waiting, once, and rests', () => {
    expect(waitDrift(0)).toBe(-0);
    expect(waitDrift(18)).toBeCloseTo((-12 * Math.PI) / 180, 12);
    expect(waitDrift(600)).toBeCloseTo((-12 * Math.PI) / 180, 12);
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
    expect(arrivalRing(0)).toEqual({ radius: 0.3, strength: 1 });
    const end = arrivalRing(1.4);
    expect(end.radius).toBeCloseTo(3.7, 12);
    expect(end.strength).toBe(0);
    expect(arrivalRing(10)).toEqual(end);
  });
});
