import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import { MOVE_ANIMATION, prefersReducedMotion } from './motion';
import { toppled } from './toppled';
import type { Group, Object3D } from 'three';

/**
 * userData for a group of decoration at a piece's base that stays on the
 * floor while the piece lifts (a base ring, a pedestal glow). Lift pins the
 * group to the floor in the same frame the piece rises, so it never trails
 * or bounces. Lift owns the group's y position: put offsets on its children.
 * Topple hides it (floorDecal) while the king is down, so it doesn't stand
 * up on edge with the fallen piece.
 */
export const ON_FLOOR = { floorDecal: true, onFloor: true } as const;

// Holds every ON_FLOOR group under a Lift at the floor, undoing the lift
// through any scaling between the two
const pinToFloor = (lift: Group) =>
  lift.traverse((o) => {
    if (o === lift || !o.userData.onFloor) return;
    let scale = 1;
    for (let p = o.parent; p && p !== lift; p = p.parent) scale *= p.scale.y;
    o.position.y = -lift.position.y / (scale || 1);
  });

const showFloorDecals = (root: Object3D | null, show: boolean) =>
  root?.traverse((o) => {
    if (o.userData.floorDecal) o.visible = show;
  });

/**
 * What a piece body can know of the move glide carrying it: the level it left
 * and the level it lands on, and how far along it is. A body whose base shows
 * its level (a ring in the level colour) can change colour as the piece
 * travels rather than wearing the destination's colour from the start.
 */
interface GlideInfo {
  /** Level (engine z, 0 = A) the move started on. */
  fromLevel: number;
  /** Level it lands on: the body's own `level`. */
  toLevel: number;
  /**
   * Eased progress along the path, 0 at the source to 1 at rest. A ref: read
   * it in useFrame (the glide requests frames while it runs).
   */
  progress: { readonly current: number };
}

export const GlideContext = createContext<GlideInfo | null>(null);

/** The glide carrying this piece (see GlideInfo), or null when it is at rest. */
export const useGlide = () => useContext(GlideContext);

/**
 * The timed lift's ease, 0 to 1: cubic out. It leaves at once, at its
 * fastest, so a piece answers the pointer or the click without a pause, and
 * slows into its height without passing it.
 */
export const easeLift = (t: number) => 1 - (1 - t) ** 3;
/** How far along the ease a travel may begin (see liftEntry). */
const LATEST_ENTRY = 0.8;

/**
 * Where along the ease a timed travel of `span` over `seconds` should begin
 * when the piece is already moving at `speed` (per second). From the start
 * (the ease's fastest) when it is at rest, turning back, or moving slower
 * than that; when it is moving faster, further along, where the ease's speed
 * over what is left of it (3 / (1 - t)) matches, so it carries on without a
 * lurch (at most LATEST_ENTRY).
 */
export const liftEntry = (span: number, seconds: number, speed: number) => {
  if (span === 0 || seconds <= 0 || speed * span <= 0) return 0;
  const want = (Math.abs(speed) * seconds) / Math.abs(span);
  return Math.min(LATEST_ENTRY, Math.max(0, 1 - 3 / want));
};

/** A Lift's travel toward its height. */
interface Travel {
  /** Where the travel began, and its target. */
  from: number;
  to: number;
  /** The seconds the target asked for (see Lift). */
  toSeconds: number;
  /** The travel's length and where along its ease it is. */
  seconds: number;
  t0: number;
  t: number;
  /** The height, and its speed. */
  y: number;
  speed: number;
}

/**
 * Raises its children `height` above their resting place, travelling from
 * wherever they are to the new height over `seconds`, setting off at once and
 * slowing into it, never past it. A travel between two heights takes the
 * longer of the times they were given, so a rise to the held height and the
 * fall back from it both take the held time. A travel turned toward a farther
 * height in the same direction never slows at the turn. Requests frames only
 * while moving, so a demand-driven canvas idles once it settles. Groups
 * tagged ON_FLOOR stay behind on the floor.
 */
export const Lift = ({
  height,
  seconds,
  children,
}: {
  height: number;
  seconds: number;
  children: React.ReactNode;
}) => {
  const group = useRef<Group>(null);
  const travel = useRef<Travel>({
    from: 0,
    to: 0,
    toSeconds: 0,
    seconds: 0,
    t0: 0,
    t: 1,
    y: 0,
    speed: 0,
  });
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => invalidate(), [height, seconds, invalidate]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 30);
    const s = travel.current;
    if (height !== s.to) {
      const time = Math.max(seconds, s.toSeconds);
      s.t0 = liftEntry(height - s.y, time, s.speed);
      s.t = s.t0;
      s.from = s.y;
      s.to = height;
      s.toSeconds = seconds;
      s.seconds = time;
    }
    // Along the ease from where the travel began
    s.t = dt > 0 ? Math.min(1, s.t + dt / s.seconds) : s.t;
    const done = (easeLift(s.t) - easeLift(s.t0)) / (1 - easeLift(s.t0));
    const y = s.t >= 1 ? s.to : s.from + (s.to - s.from) * done;
    s.speed = s.t >= 1 ? 0 : dt > 0 ? (y - s.y) / dt : s.speed;
    s.y = y;
    g.position.y = y;
    pinToFloor(g);
    if (s.t < 1) invalidate();
  });

  // Tagged so a piece's hit proxy is measured without the lift (PieceMesh)
  return (
    <group ref={group} userData={{ lift: true }}>
      {children}
    </group>
  );
};

/**
 * How far a piece rises: under the pointer it stirs; held, it rises a little
 * higher, answering the click at once and settling over a longer ease, and
 * holds still (heights in piece units, a king stands 0.87 tall).
 */
export const PIECE_LIFT = {
  hover: 0.09,
  selected: 0.09 + 0.05,
  hoverSeconds: 0.24,
  selectSeconds: 0.6,
};

/** A check's flinch and a refused tap's shake (see Jolt). */
export const JOLT = {
  /** The king rocks side to side on his foot, as seen from the camera. */
  checkMs: 560,
  checkAngle: 0.13,
  checkCycles: 2,
  /** A piece that can't be picked up shakes its head: side to side across the view. */
  refusedMs: 340,
  refusedShift: 0.05,
  refusedCycles: 2.5,
  /** The winners' cheer at mate: one hop (piece units) over this long. */
  cheerMs: 380,
  cheerHeight: 0.14,
};

// A decaying wobble, 0 at both ends
const wobble = (v: number, cycles: number) =>
  v >= 1 ? 0 : Math.exp(-4 * v) * Math.sin(2 * Math.PI * cycles * v) * (1 - v);

/**
 * The camera's right, level with the board, in `group`'s parent's frame (the
 * direction a piece moves to move right on screen), or null when the camera
 * looks straight down at it.
 */
const viewRight = (group: Group, camera: { position: Vector3 }) => {
  const at = group.getWorldPosition(new Vector3());
  const view = at.sub(camera.position);
  const right = new Vector3(-view.z, 0, view.x);
  if (right.lengthSq() < 1e-9) return null;
  right.normalize();
  if (group.parent) {
    right.applyQuaternion(group.parent.getWorldQuaternion(new Quaternion()).invert());
  }
  return right;
};

/**
 * A piece's short answers on its own square. A king put in check (`check`
 * turning on) flinches, rocking on his foot from side to side; a piece the
 * player taps but can't pick up (each new `refused` count) shakes its head,
 * side to side across the view, so no tap goes unanswered. Neither plays for
 * a player who asked for less motion, nor for a check the piece mounted in
 * (a reload).
 */
export const Jolt = ({
  check,
  refused,
  cheerAt,
  children,
}: {
  check: boolean;
  refused: number;
  /** The winning army's cheer at mate: the piece hops once, this many ms from now. */
  cheerAt?: number;
  children: React.ReactNode;
}) => {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const play = useRef<{
    kind: 'check' | 'refused' | 'cheer';
    ms: number;
    right: Vector3 | null;
  } | null>(null);
  const was = useRef({ check, refused });
  const still = useMemo(prefersReducedMotion, []);

  useEffect(() => {
    const before = was.current;
    was.current = { check, refused };
    if (still) return;
    if (check && !before.check) play.current = { kind: 'check', ms: 0, right: null };
    else if (refused > before.refused) play.current = { kind: 'refused', ms: 0, right: null };
    else return;
    invalidate();
  }, [check, refused, still, invalidate]);
  useEffect(() => {
    if (cheerAt === undefined || still) return;
    play.current = { kind: 'cheer', ms: -cheerAt, right: null };
    invalidate();
  }, [cheerAt, still, invalidate]);

  useFrame(({ camera }, delta) => {
    const g = group.current;
    const p = play.current;
    if (!g || !p) return;
    p.right ??= viewRight(g, camera);
    p.ms += Math.min(delta * 1000, MOVE_ANIMATION.maxFrameMs);
    const right = p.right;
    if (p.kind === 'cheer') {
      // Waiting its turn in the wave, then one hop
      const v = Math.max(p.ms, 0) / JOLT.cheerMs;
      g.position.set(0, v >= 1 ? 0 : JOLT.cheerHeight * Math.sin(Math.PI * v), 0);
      if (v >= 1) play.current = null;
    } else if (p.kind === 'check') {
      const v = p.ms / JOLT.checkMs;
      // Rocking about the line of sight tips him left and right on screen
      const angle = JOLT.checkAngle * wobble(v, JOLT.checkCycles);
      if (right) g.quaternion.setFromAxisAngle(new Vector3(right.z, 0, -right.x), angle);
      if (v >= 1) play.current = null;
    } else {
      const v = p.ms / JOLT.refusedMs;
      const shift = JOLT.refusedShift * wobble(v, JOLT.refusedCycles);
      if (right) g.position.set(right.x * shift, 0, right.z * shift);
      if (v >= 1) play.current = null;
    }
    if (!play.current) {
      g.position.set(0, 0, 0);
      g.quaternion.identity();
      return;
    }
    invalidate();
  });

  return <group ref={group}>{children}</group>;
};

/** How long a mated king takes to fall and settle. */
export const TOPPLE_MS = 900;
/** The share of that at which he strikes the floor (a settling bounce follows). */
export const TOPPLE_STRIKE = 0.55;
/** The most one frame advances the fall. */
const TOPPLE_STEP_MS = 125;
/** How far over a fallen king lies (radians). */
const FALLEN = 1.42;

/**
 * A mated king's fall after a knock (Topple's `teeter`): the mating piece's
 * arrival knocks him back onto the rim of his base, and from there it is a
 * rigid body on a pivot. Gravity pulls him back toward standing until his
 * centre of mass passes over the rim (his tipping point), then pulls him
 * over. The knock is barely enough to get him there: he tips back fast,
 * slows almost to a stop at the edge of his balance, hangs there a moment,
 * and goes. Angles in radians, toward where he falls.
 */
export const KNOCK_FALL = {
  /** Where he balances on his rim: his foot's radius over the height of his centre of mass. */
  tipAt: Math.atan(0.22 / 0.32),
  /** Gravity's pull about the rim for his build (per second squared): sets the pace. */
  pull: 40,
  /** How much more the knock gives than just reaching the tipping point (a share of it). */
  surplus: 0.006,
};

// His angle each ms from the knock until he strikes the floor, simulated
// once: angular speed changes by pull * sin(angle - tipAt) every instant
const knockFall = (() => {
  const { tipAt, pull, surplus } = KNOCK_FALL;
  const dt = 1e-4;
  let w = Math.sqrt(2 * pull * (1 - Math.cos(tipAt)) * (1 + surplus));
  let angle = 0;
  const perMs: number[] = [0];
  for (let step = 1; angle < FALLEN; step++) {
    w += pull * Math.sin(angle - tipAt) * dt;
    angle += w * dt;
    if (step % 10 === 0) perMs.push(Math.min(angle, FALLEN));
  }
  return perMs;
})();

/** When a knocked king strikes the floor (ms after the knock). */
export const TEETER_STRIKE_MS = knockFall.length - 1;
/** When he passes his tipping point (ms after the knock). */
export const TIPPING_MS = knockFall.findIndex((a) => a >= KNOCK_FALL.tipAt);
// The settling bounce after the strike
const BOUNCE_MS = TOPPLE_MS * (1 - TOPPLE_STRIKE);

const bounce = (t: number) =>
  FALLEN * (1 - Math.sin(t * (1 - TOPPLE_STRIKE) * 14) * 0.06 * (1 - TOPPLE_STRIKE) * (1 - t));

/**
 * How far a mated king leans `ms` after he starts to go (radians, toward
 * where he falls), and whether he has struck the floor and settled. Knocked
 * (`teeter`), he follows KNOCK_FALL; otherwise he simply falls.
 */
export const toppleAngle = (ms: number, teeter: boolean) => {
  const strikeMs = teeter ? TEETER_STRIKE_MS : TOPPLE_MS * TOPPLE_STRIKE;
  if (ms >= strikeMs) {
    const t = Math.min((ms - strikeMs) / BOUNCE_MS, 1);
    return { angle: bounce(t), struck: true, settled: t >= 1 };
  }
  if (!teeter) {
    const u = ms / strikeMs;
    return { angle: FALLEN * u * u, struck: false, settled: false };
  }
  // Between the simulated ms
  const at = Math.floor(ms);
  const angle = knockFall[at] + (knockFall[at + 1] - knockFall[at]) * (ms - at);
  return { angle, struck: false, settled: false };
};

// When a toppling king strikes the floor (on the scene's own clock, however
// slowly the frames come), for the result card to follow (GameScreen.tsx)
export { onToppled } from './toppled';
// The base is a disc of about this radius: the piece pivots on its rim, as a
// real one tips over, rather than sinking through the board around its centre.
const PIVOT = 0.22;

/**
 * Tips a mated king onto its side, with a small settling bounce. It falls
 * across the view (toward the camera's right, as seen when the mate lands),
 * so the fallen king shows its profile rather than its base.
 */
export const Topple = ({
  active,
  delayMs = 0,
  teeter = false,
  away,
  children,
}: {
  active: boolean;
  /** How long he stands still before he starts to go (ms). */
  delayMs?: number;
  /** Whether he is knocked over, teetering at the edge of his balance first (KNOCK_FALL). */
  teeter?: boolean;
  /**
   * Which way he falls, level, in the frame of the board (unit x, z): away
   * from the piece that mated him. Without it, toward the camera's right.
   */
  away?: [number, number] | null;
  children: React.ReactNode;
}) => {
  const heading = useRef<Group>(null);
  // Tipping toward where he falls pivots on that rim of his base; tipping
  // the other way, on the opposite rim
  const rim = useRef<Group>(null);
  const pivot = useRef<Group>(null);
  const back = useRef<Group>(null);
  const elapsed = useRef(0);
  const aimed = useRef(false);
  const struck = useRef(false);
  const decalsHidden = useRef(false);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    elapsed.current = 0;
    aimed.current = false;
    struck.current = false;
    invalidate();
  }, [active, invalidate]);

  useFrame(({ camera }, delta) => {
    const g = pivot.current;
    const h = heading.current;
    if (!g || !h || !rim.current || !back.current) return;
    if (!active) {
      g.rotation.x = 0;
      h.rotation.y = 0;
      if (decalsHidden.current) {
        showFloorDecals(g, true);
        decalsHidden.current = false;
      }
      return;
    }
    if (!aimed.current) {
      aimed.current = true;
      // The pivot tips toward local -z: turn -z onto the way he falls
      if (away) h.rotation.y = Math.atan2(-away[0], -away[1]);
      else {
        // The camera's right, level with the board, in the parent's frame
        const at = h.getWorldPosition(new Vector3());
        const view = at.sub(camera.position);
        const right = new Vector3(-view.z, 0, view.x);
        if (right.lengthSq() > 1e-9 && h.parent) {
          const parentTurn = h.parent.getWorldQuaternion(new Quaternion()).invert();
          right.applyQuaternion(parentTurn);
          h.rotation.y = Math.atan2(-right.x, -right.z);
        }
      }
    }
    // A slow frame advances the fall by up to TOPPLE_STEP_MS, so it spans
    // few frames however slowly they come (the result card waits for it),
    // while the first frame after an idle spell still can't skip it
    elapsed.current += Math.min(delta * 1000, TOPPLE_STEP_MS);
    const ms = elapsed.current - delayMs;
    const { angle, struck: down, settled } = toppleAngle(Math.max(ms, 0), teeter);
    const side = angle >= 0 ? 1 : -1;
    rim.current.position.z = -PIVOT * side;
    back.current.position.z = PIVOT * side;
    g.rotation.x = -angle;
    // Once it tips, what lay flat at its base would stand up with it (every
    // frame, in case the body remounts a disc while the king is down)
    if (angle > 0.3) {
      showFloorDecals(g, false);
      decalsHidden.current = true;
    }
    if (down && !struck.current) {
      struck.current = true;
      toppled();
    }
    if (!settled) invalidate();
  });

  return (
    <group ref={heading}>
      <group ref={rim} position={[0, 0, -PIVOT]}>
        <group ref={pivot}>
          <group ref={back} position={[0, 0, PIVOT]}>
            {children}
          </group>
        </group>
      </group>
    </group>
  );
};
