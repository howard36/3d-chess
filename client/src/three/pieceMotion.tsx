import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
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

/** How long a mated king takes to fall and settle. */
export const TOPPLE_MS = 900;
/** The share of that at which he strikes the floor (a settling bounce follows). */
export const TOPPLE_STRIKE = 0.55;
/** The most one frame advances the fall. */
const TOPPLE_STEP_MS = 125;

// When a toppling king strikes the floor (on the scene's own clock, however
// slowly the frames come), for the result card to follow (GameScreen.tsx)
const toppled = new Set<() => void>();

/** Calls `listener` each time a mated king strikes the floor; returns the unsubscribe. */
export const onToppled = (listener: () => void) => {
  toppled.add(listener);
  return () => {
    toppled.delete(listener);
  };
};
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
    // A slow frame advances the fall by up to TOPPLE_STEP_MS, so it spans at
    // most eight frames however slowly they come (the result card waits for
    // it), while the first frame after an idle spell still can't skip it
    elapsed.current += Math.min(delta * 1000, TOPPLE_STEP_MS);
    const t = Math.min(elapsed.current / TOPPLE_MS, 1);
    // Accelerating fall, then a damped rebound off the floor
    const fall =
      t < TOPPLE_STRIKE
        ? (t / TOPPLE_STRIKE) ** 2
        : 1 - Math.sin((t - TOPPLE_STRIKE) * 14) * 0.06 * (1 - t);
    g.rotation.x = -1.42 * fall;
    // Once it tips, what lay flat at its base would stand up with it (every
    // frame, in case the body remounts a disc while the king is down)
    if (fall > 0.05) {
      showFloorDecals(g, false);
      decalsHidden.current = true;
    }
    if (t >= TOPPLE_STRIKE && !struck.current) {
      struck.current = true;
      toppled.forEach((listener) => listener());
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
