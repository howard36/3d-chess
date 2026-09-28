import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { Vec3 } from '../types';

// Floors that a marker has taken over from the piece standing there. A
// capture or a check marker is drawn in place of the victim's (or the
// king's) level ring rather than round it, so the two never stack as
// concentric circles: while such a marker is up, the ring at its floor
// steps aside (pieces.tsx), and the last move's ring there too (markers.tsx).

export type ClaimKind = 'capture' | 'check';

const claims: Record<ClaimKind, Vec3[]> = { capture: [], check: [] };

/** Takes over the ring at `floor` while the calling marker is mounted. */
export const useClaim = (kind: ClaimKind, floor: Vec3) => {
  const invalidate = useThree((s) => s.invalidate);
  const [x, y, z] = floor;
  useEffect(() => {
    const at: Vec3 = [x, y, z];
    claims[kind].push(at);
    invalidate();
    return () => {
      const k = claims[kind].indexOf(at);
      if (k >= 0) claims[kind].splice(k, 1);
      invalidate();
    };
  }, [kind, x, y, z, invalidate]);
};

/** A point in world space (a Vector3, or any x, y, z). */
export interface Point {
  x: number;
  y: number;
  z: number;
}

const near = (a: Vec3, p: Point) =>
  Math.abs(a[0] - p.x) < 0.06 && Math.abs(a[2] - p.z) < 0.06 && Math.abs(a[1] - p.y) < 0.3;

/** Whether a marker of one of these kinds has taken over the floor at `p` (world). */
export const claimed = (p: Point, kinds: readonly ClaimKind[]) =>
  kinds.some((kind) => claims[kind].some((a) => near(a, p)));

/** Whether any floor is taken over (a cheap test before looking). */
export const anyClaims = () => claims.capture.length > 0 || claims.check.length > 0;
