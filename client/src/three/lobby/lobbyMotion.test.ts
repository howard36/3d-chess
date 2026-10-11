import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { FRAME, layout } from '../scene/palette';
import { PROFILES } from '../pieces';
import { PieceType } from '../../engine/pieces';
import {
  arrivalRing,
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
  LOBBY_MAX_STEP,
  lobbyStep,
  leavePull,
  leaveSpin,
  LEAVE_GARDEN_DARK,
  LEAVE_GLASS_TURN,
  leaveVeil,
  leavePose,
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
  turnPose,
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

describe('handing over to the game', () => {
  it('spins the glass -164° on screen, the camera turning round the tower only in the dark', () => {
    const from = lobbyPose(1280 / 800);
    const to = gameOpening(1280, 800).pose;
    const [x, , z] = layout.viewDirection;
    const round = Math.atan2(x, z);
    // The camera seen from the glass: its pose turned back by the glass's turn
    const seen = (t: number) => {
      const { pose, glass } = leavePose(from, to, t);
      return turnPose(pose, -glass);
    };
    const spin = seen(1).azimuth - from.azimuth;
    expect(spin).toBeCloseTo(round - Math.PI, 9);
    expect(spin * (180 / Math.PI)).toBeLessThan(-150);
    // Round the tower the camera turns only while the garden is black
    let last = leavePose(from, to, 0).pose.azimuth;
    for (const t of samples(0, 1, 200)) {
      const now = leavePose(from, to, t).pose.azimuth;
      if (Math.abs(now - last) > 1e-9) expect(leaveVeil(t)).toBeCloseTo(1, 6);
      last = now;
    }
    expect(last - from.azimuth).toBeCloseTo(round, 9);
    // Half a turn: the square glass looks just as it did
    expect(LEAVE_GLASS_TURN).toBe(Math.PI);
  });

  it("darkens the lobby's garden from the start, holds it black, then brings the game's up", () => {
    // From the moment the lobby starts leaving, before the camera sets off,
    // easing in (no cut to black), black by LEAVE_GARDEN_DARK
    const leaving = -LOBBY_TIMING.leaveSetOff / LOBBY_TIMING.leaveMove;
    expect(leaveVeil(leaving)).toBe(0);
    expect(leaveVeil(leaving + 0.05)).toBeLessThan(0.05);
    expect(leaveVeil(LEAVE_GARDEN_DARK)).toBe(1);
    // ...over most of a second
    expect((LEAVE_GARDEN_DARK - leaving) * LOBBY_TIMING.leaveMove).toBeGreaterThanOrEqual(0.75);
    // Black for at least a quarter of the move
    for (const t of samples(LEAVE_GARDEN_DARK, 0.55, 20)) expect(leaveVeil(t)).toBe(1);
    expect(leaveVeil(0.97)).toBe(0);
    expect(leaveVeil(1)).toBe(0);
    // Down, then up, never back
    let last = 0;
    for (const t of samples(leaving, LEAVE_GARDEN_DARK, 20)) {
      expect(leaveVeil(t)).toBeGreaterThanOrEqual(last);
      last = leaveVeil(t);
    }
    for (const t of samples(0.5, 1, 20)) {
      expect(leaveVeil(t)).toBeLessThanOrEqual(last);
      last = leaveVeil(t);
    }
  });

  it("ends the leaving at rest on the game's first frame", () => {
    const from = lobbyPose(1280 / 800);
    const to = gameOpening(1280, 800).pose;
    const start = leavePose(from, to, 0);
    expect(start.pose).toEqual(from);
    expect(start.glass).toBeCloseTo(0, 12);
    const { pose, glass, settled } = leavePose(from, to, 1);
    expect(glass).toBeCloseTo(LEAVE_GLASS_TURN, 12);
    expect(settled).toBe(1);
    expect(Math.cos(pose.azimuth - to.azimuth)).toBeCloseTo(1, 12);
    expect(pose.elevation).toBeCloseTo(to.elevation, 12);
    expect(pose.distance).toBeCloseTo(to.distance, 12);
    pose.target.forEach((v) => expect(v).toBeCloseTo(0, 12));
  });

  it('eases off and draws back while the glass gathers itself and then spins hard', () => {
    for (const [w, h] of [
      [1280, 720],
      [390, 844],
    ]) {
      const from = lobbyPose(w / h);
      const to = gameOpening(w, h).pose;
      const [x, , z] = layout.viewDirection;
      // The whole spin seen from the glass
      const end = Math.PI - Math.atan2(x, z);
      // How far along each is (0 to 1): the camera's draw back (in the log
      // of the distance), the glass's spin, and the look up to the centre
      const parts = (t: number) => {
        const { pose, glass } = leavePose(from, to, t);
        return {
          back: Math.log(pose.distance / from.distance) / Math.log(to.distance / from.distance),
          spin: (from.azimuth - turnPose(pose, -glass).azimuth) / end,
          look: (pose.target[1] - from.target[1]) / (to.target[1] - from.target[1]),
        };
      };
      const dt = 1e-4;
      const pace = (t: number, part: 'back' | 'spin' | 'look') =>
        (parts(t + dt)[part] - parts(t)[part]) / dt;
      // All from rest to rest, never turning back
      for (const part of ['back', 'spin', 'look'] as const) {
        expect(pace(0, part)).toBeLessThan(0.01);
        expect(pace(1 - dt, part)).toBeLessThan(0.05);
        expect(parts(1)[part]).toBeCloseTo(1, 9);
        for (const t of samples(0, 1 - dt, 100)) expect(pace(t, part)).toBeGreaterThanOrEqual(0);
      }
      // The camera easing gently off over its first two-fifths, then at an
      // even pace through the middle
      expect(pace(0.1, 'back')).toBeLessThan(0.3);
      for (const t of samples(0.4, 0.7, 20)) expect(pace(t, 'back')).toBeCloseTo(1 / 0.65, 6);
      // The glass barely turning at first (under 2% by a quarter of the way,
      // under a fifth by halfway), and fastest late, three-quarters of the way
      expect(parts(0.25).spin).toBeLessThan(0.02);
      expect(parts(0.5).spin).toBeLessThan(0.2);
      expect(pace(0.75, 'spin')).toBeGreaterThan(pace(0.6, 'spin'));
      expect(pace(0.75, 'spin')).toBeGreaterThan(pace(0.9, 'spin'));
      expect(pace(0.75, 'spin')).toBeGreaterThan(2);
    }
    expect(leavePull(0)).toBe(0);
    expect(leavePull(1)).toBeCloseTo(1, 12);
    expect(leaveSpin(0.5)).toBeCloseTo(0.1875, 12);
  });

  it('brings the glass down the picture to its place without scraping the bottom', () => {
    // Where the glass is on screen (0 the middle, 1 the bottom edge), seen
    // from a pose as three.js projects it (without the lens shift): its
    // middle, and its lowest corner
    const reach = FRAME.half + 0.05;
    const seen = (pose: CameraPose, aspect: number) => {
      const camera = new PerspectiveCamera(LOBBY_FOV, aspect, 0.1, 1000);
      camera.position.set(...posePosition(pose));
      camera.lookAt(...pose.target);
      camera.updateMatrixWorld();
      const down = (x: number, z: number) =>
        -new Vector3(x * reach, FLOOR_Y, z * reach).project(camera).y;
      return {
        middle: down(0, 0),
        lowest: Math.max(down(1, 1), down(1, -1), down(-1, 1), down(-1, -1)),
      };
    };
    for (const [w, h] of [
      [1280, 720],
      [844, 390],
      [390, 844],
      [1920, 1080],
    ]) {
      const from = lobbyPose(w / h);
      const to = gameOpening(w, h).pose;
      const end = seen(to, w / h);
      expect(end.lowest).toBeLessThan(0.9);
      let inView = false;
      for (const t of samples(0, 1, 200)) {
        const { pose, glass } = leavePose(from, to, t);
        const now = seen(turnPose(pose, -glass), w / h);
        // Its middle glides down to its place, never sinking far past it
        expect(now.middle).toBeLessThan(end.middle + 0.04);
        // Once it is well in view it stays clear of the bottom edge (a
        // corner swings a little nearer as the square turns)
        inView ||= now.lowest < 0.95;
        if (inView) expect(now.lowest).toBeLessThan(0.98);
      }
      expect(inView).toBe(true);
    }
  });

  it('turns a pose about the vertical as three.js turns an object', () => {
    const pose: CameraPose = { target: [1, 2, 0.5], azimuth: 0.3, elevation: 0.4, distance: 7 };
    const turned = turnPose(pose, 0.9);
    const position = new Vector3(...posePosition(pose)).applyAxisAngle(new Vector3(0, 1, 0), 0.9);
    new Vector3(...posePosition(turned))
      .toArray()
      .forEach((v, i) => expect(v).toBeCloseTo(position.toArray()[i], 12));
    expect(turned.target[1]).toBe(2);
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

  it("ends on the game's first frame: its fitted distance", () => {
    const white = gameOpening(1280, 800);
    const opening = poseFromDirection([0, 0, 0], layout.viewDirection, 1);
    expect(white.pose.elevation).toBeCloseTo(opening.elevation, 12);
    expect(white.pose.azimuth).toBeCloseTo(opening.azimuth, 12);
    // The game's entrance after the lobby has no dolly: the lobby brings
    // the camera all the way, and the game takes it up at rest
    expect(introPlan('lobby').dolly.from).toBe(1);
    expect(gameOpening(1280, 800, true).pose.distance).toBeCloseTo(white.pose.distance, 9);
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

describe('lobbyStep', () => {
  it('takes one ordinary frame where a motion sets off from rest, however long the rest', () => {
    expect(lobbyStep(11.7, true)).toBeCloseTo(1 / 60);
    expect(lobbyStep(0.25, true)).toBeCloseTo(1 / 60);
    expect(lobbyStep(0.01, true)).toBe(0.01);
  });

  it('takes the frame its own time under way, up to the longest step', () => {
    expect(lobbyStep(0.2, false)).toBe(0.2);
    expect(lobbyStep(7, false)).toBe(LOBBY_MAX_STEP);
  });
});
