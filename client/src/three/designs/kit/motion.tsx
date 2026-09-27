import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import type { Group } from 'three';
import type { PieceLift } from '../types';

/** Board's piece lift (Design.hoverLift) when a design just says `true`. */
export const LIFT_DEFAULTS: Required<PieceLift> = { hover: 0.08, selected: 0.2, bob: 0 };

/**
 * The gentle bob of a held piece that the round-2 designs were reviewed
 * with; a design opts in with `hoverLift: { bob: SELECTION_BOB }`.
 */
export const SELECTION_BOB = 0.035;

/** A design's piece lift with its defaults filled in, or null for none. */
export const pieceLift = (
  hoverLift: boolean | PieceLift | undefined,
): Required<PieceLift> | null =>
  !hoverLift ? null : hoverLift === true ? LIFT_DEFAULTS : { ...LIFT_DEFAULTS, ...hoverLift };

/**
 * Raises its children `height` above their resting place, easing there, and
 * bobs them `bob` up and down while there (0: held still). Requests frames
 * only while moving, so a demand-driven canvas idles once it settles.
 */
export const Lift = ({
  height,
  bob = 0,
  children,
}: {
  height: number;
  bob?: number;
  children: React.ReactNode;
}) => {
  const group = useRef<Group>(null);
  const clock = useRef(0);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => invalidate(), [height, bob, invalidate]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 30);
    clock.current += dt;
    const bobbing = bob > 0;
    const target = height + (bobbing ? Math.sin(clock.current * 3.2) * bob : 0);
    const y = g.position.y + (target - g.position.y) * Math.min(1, dt * 12);
    const settled = !bobbing && Math.abs(y - target) < 1e-3;
    g.position.y = settled ? target : y;
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
