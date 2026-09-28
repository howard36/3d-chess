import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import type { Group, Object3D } from 'three';
import type { SettingValues } from '../settings';
import type { Design, PieceLift } from '../types';

/**
 * userData for decoration lying on the floor at a piece's base (a contact
 * shadow, a level ring): Topple hides it while the king is down, so it
 * doesn't stand up on edge with the fallen piece. The kit's ContactShadow and
 * LevelFootprint carry it; spread it onto a design's own base discs.
 */
export const FLOOR_DECAL = { floorDecal: true } as const;

/**
 * userData for a group of decoration at a piece's base that stays on the
 * floor while the piece lifts (a base ring, a pedestal glow). Lift pins the
 * group to the floor in the same frame the piece rises, so it never trails
 * or bounces. Lift owns the group's y position: put offsets on its children.
 * It is a FLOOR_DECAL too, so Topple hides it.
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
export interface GlideInfo {
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

/** Board's piece lift (Design.hoverLift) when a design just says `true`. */
export const LIFT_DEFAULTS: Required<PieceLift> = {
  hover: 0.08,
  selected: 0.2,
  bob: 0,
  hoverSeconds: 0,
  selectSeconds: 0,
};

/**
 * The gentle bob of a held piece that the round-2 designs were reviewed
 * with; a design opts in with `hoverLift: { bob: SELECTION_BOB }`.
 */
export const SELECTION_BOB = 0.035;

/**
 * A design's piece lift with its defaults filled in, or null for none. A
 * design whose lift is a function of its settings gets them here.
 */
export const pieceLift = (
  hoverLift: Design['hoverLift'],
  settings: SettingValues = {},
): Required<PieceLift> | null => {
  const lift = typeof hoverLift === 'function' ? hoverLift(settings) : hoverLift;
  return !lift ? null : lift === true ? LIFT_DEFAULTS : { ...LIFT_DEFAULTS, ...lift };
};

/** The timed lift's ease, 0 to 1: sine in and out, starting and ending at rest. */
export const easeLift = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const easeLiftRate = (t: number) => 0.5 * Math.PI * Math.sin(Math.PI * t);
/** The ease's rate at `t` over what is left of it: the speed it enters with from there. */
const entryRate = (t: number) => easeLiftRate(t) / (1 - easeLift(t));

/**
 * Where along the ease a timed travel of `span` over `seconds` should begin
 * when the piece is already moving at `speed` (per second), so it carries on
 * without a hitch: 0 from rest or when turning back, at most 0.5 (the ease's
 * fastest point, so the rest of the way still slows into the target).
 */
export const liftEntry = (span: number, seconds: number, speed: number) => {
  if (span === 0 || seconds <= 0 || speed * span <= 0) return 0;
  const want = (Math.abs(speed) * seconds) / Math.abs(span);
  if (entryRate(0.5) <= want) return 0.5;
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (entryRate(mid) < want) lo = mid;
    else hi = mid;
  }
  return lo;
};

/** A Lift's travel toward its height. */
interface Travel {
  /** Where the travel began, and its target. */
  from: number;
  to: number;
  /** The seconds the target asked for (see Lift). */
  toSeconds: number;
  /** The travel's length (0: the quick approach) and where along its ease it is. */
  seconds: number;
  t0: number;
  t: number;
  /** The height (without the bob), its speed, and the bob's size now. */
  y: number;
  speed: number;
  bob: number;
}

/**
 * Raises its children `height` above their resting place and bobs them `bob`
 * up and down while there (0: held still). With `seconds` the piece travels
 * from wherever it is to the new height along a gentle ease of that length,
 * never past it; a travel between two heights takes the longer of the times
 * they were given, so a rise to the held height and the fall back from it
 * both take the held time. A travel turned toward a farther height in the
 * same direction keeps its speed. Without `seconds` it eases there quickly,
 * slowing as it arrives. Requests frames only while moving, so a
 * demand-driven canvas idles once it settles. Groups tagged ON_FLOOR stay
 * behind on the floor.
 */
export const Lift = ({
  height,
  bob = 0,
  seconds = 0,
  children,
}: {
  height: number;
  bob?: number;
  seconds?: number;
  children: React.ReactNode;
}) => {
  const group = useRef<Group>(null);
  const clock = useRef(0);
  const travel = useRef<Travel>({
    from: 0,
    to: 0,
    toSeconds: 0,
    seconds: 0,
    t0: 0,
    t: 1,
    y: 0,
    speed: 0,
    bob: 0,
  });
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => invalidate(), [height, bob, seconds, invalidate]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 30);
    clock.current += dt;
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
    let settled: boolean;
    if (s.seconds > 0) {
      // Timed: along the ease from where the travel began, with the bob
      // easing in and out on top
      s.t = dt > 0 ? Math.min(1, s.t + dt / s.seconds) : s.t;
      const done = (easeLift(s.t) - easeLift(s.t0)) / (1 - easeLift(s.t0));
      const y = s.t >= 1 ? s.to : s.from + (s.to - s.from) * done;
      s.speed = s.t >= 1 ? 0 : dt > 0 ? (y - s.y) / dt : s.speed;
      s.y = y;
      s.bob += (bob - s.bob) * Math.min(1, dt * 6);
      if (Math.abs(s.bob - bob) < 1e-4) s.bob = bob;
      settled = s.t >= 1 && s.bob === 0;
      g.position.y = y + (s.bob > 0 ? Math.sin(clock.current * 3.2) * s.bob : 0);
    } else {
      const bobbing = bob > 0;
      const target = height + (bobbing ? Math.sin(clock.current * 3.2) * bob : 0);
      const y = g.position.y + (target - g.position.y) * Math.min(1, dt * 12);
      settled = !bobbing && Math.abs(y - target) < 1e-3;
      g.position.y = settled ? target : y;
      s.speed = settled ? 0 : dt > 0 ? (g.position.y - s.y) / dt : s.speed;
      s.y = g.position.y;
    }
    pinToFloor(g);
    if (!settled) invalidate();
  });

  // Tagged so a piece's hit proxy is measured without the lift (PieceMesh)
  return (
    <group ref={group} userData={{ lift: true }}>
      {children}
    </group>
  );
};

const TOPPLE_MS = 900;
// The base is a disc of about this radius: the piece pivots on its rim, as a
// real one tips over, rather than sinking through the board around its centre.
const PIVOT = 0.22;

/**
 * Tips a mated king onto its side, with a small settling bounce. It falls
 * across the view (toward the camera's right, as seen when the mate lands),
 * so the fallen king shows its profile rather than its base.
 */
export const Topple = ({ active, children }: { active: boolean; children: React.ReactNode }) => {
  const heading = useRef<Group>(null);
  const pivot = useRef<Group>(null);
  const elapsed = useRef(0);
  const aimed = useRef(false);
  const decalsHidden = useRef(false);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    elapsed.current = 0;
    aimed.current = false;
    invalidate();
  }, [active, invalidate]);

  useFrame(({ camera }, delta) => {
    const g = pivot.current;
    const h = heading.current;
    if (!g || !h) return;
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
      // The camera's right, level with the board, in the parent's frame: the
      // pivot tips toward local -z, so turn -z onto that direction.
      const at = h.getWorldPosition(new Vector3());
      const view = at.sub(camera.position);
      const right = new Vector3(-view.z, 0, view.x);
      if (right.lengthSq() > 1e-9 && h.parent) {
        const parentTurn = h.parent.getWorldQuaternion(new Quaternion()).invert();
        right.applyQuaternion(parentTurn);
        h.rotation.y = Math.atan2(-right.x, -right.z);
      }
    }
    elapsed.current += Math.min(delta, 1 / 30) * 1000;
    const t = Math.min(elapsed.current / TOPPLE_MS, 1);
    // Accelerating fall, then a damped rebound off the floor
    const fall = t < 0.55 ? (t / 0.55) ** 2 : 1 - Math.sin((t - 0.55) * 14) * 0.06 * (1 - t);
    g.rotation.x = -1.42 * fall;
    // Once it tips, what lay flat at its base would stand up with it (every
    // frame, in case the body remounts a disc while the king is down)
    if (fall > 0.05) {
      showFloorDecals(g, false);
      decalsHidden.current = true;
    }
    if (t < 1) invalidate();
  });

  return (
    <group ref={heading}>
      <group position={[0, 0, -PIVOT]}>
        <group ref={pivot}>
          <group position={[0, 0, PIVOT]}>{children}</group>
        </group>
      </group>
    </group>
  );
};
