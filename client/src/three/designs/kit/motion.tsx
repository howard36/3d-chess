import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';

/**
 * Raises its children `height` above their resting place, easing there, and
 * bobs them gently while raised high (a picked-up piece). Requests frames
 * only while moving, so a demand-driven canvas idles once it settles.
 */
export const Lift = ({ height, children }: { height: number; children: React.ReactNode }) => {
  const group = useRef<Group>(null);
  const clock = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const bob = height >= 0.15;

  useEffect(() => invalidate(), [height, invalidate]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 30);
    clock.current += dt;
    const target = height + (bob ? Math.sin(clock.current * 3.2) * 0.035 : 0);
    const y = g.position.y + (target - g.position.y) * Math.min(1, dt * 12);
    const settled = !bob && Math.abs(y - target) < 1e-3;
    g.position.y = settled ? target : y;
    if (!settled) invalidate();
  });

  return <group ref={group}>{children}</group>;
};

const TOPPLE_MS = 900;
// The base is a disc of about this radius: the piece pivots on its rim, as a
// real one tips over, rather than sinking through the board around its centre.
const PIVOT = 0.22;

/** Tips a mated king onto its side, with a small settling bounce. */
export const Topple = ({ active, children }: { active: boolean; children: React.ReactNode }) => {
  const pivot = useRef<Group>(null);
  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    elapsed.current = 0;
    invalidate();
  }, [active, invalidate]);

  useFrame((_, delta) => {
    const g = pivot.current;
    if (!g) return;
    if (!active) {
      g.rotation.x = 0;
      return;
    }
    elapsed.current += Math.min(delta, 1 / 30) * 1000;
    const t = Math.min(elapsed.current / TOPPLE_MS, 1);
    // Accelerating fall, then a damped rebound off the floor
    const fall = t < 0.55 ? (t / 0.55) ** 2 : 1 - Math.sin((t - 0.55) * 14) * 0.06 * (1 - t);
    g.rotation.x = -1.42 * fall;
    if (t < 1) invalidate();
  });

  return (
    <group position={[0, 0, -PIVOT]}>
      <group ref={pivot}>
        <group position={[0, 0, PIVOT]}>{children}</group>
      </group>
    </group>
  );
};
