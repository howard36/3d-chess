import { useEffect, useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { Vec3 } from '../types';

// Floors that a marker has taken over. A capture or a check marker is drawn
// in place of the victim's (or the king's) level ring rather than round it,
// and the last move's ring in place of the moved piece's, so no two rings
// ever stack as concentric circles: while such a marker is up, the ring at
// its floor steps aside (pieces.tsx). Likewise the small ring where the last
// move started steps aside for a destination drawn on that square
// (markers.tsx).

export type ClaimKind = 'capture' | 'check' | 'trace' | 'quiet';

const claims: Record<ClaimKind, Vec3[]> = { capture: [], check: [], trace: [], quiet: [] };

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
interface Point {
  x: number;
  y: number;
  z: number;
}

const near = (a: Vec3, p: Point) =>
  Math.abs(a[0] - p.x) < 0.06 && Math.abs(a[2] - p.z) < 0.06 && Math.abs(a[1] - p.y) < 0.3;

/** Whether a marker of one of these kinds has taken over the floor at `p` (world). */
export const claimed = (p: Point, kinds: readonly ClaimKind[]) =>
  kinds.some((kind) => claims[kind].some((a) => near(a, p)));

// --- Where the held piece stands ----------------------------------------------------------

// The Selection marker (selection.tsx) publishes the held piece's floor here;
// the markers read it, so a destination straight above or below it gives up
// its rim from above, and the last move's ring steps aside for the
// selection's own circle at its foot.

let heldFloor: Vec3 | null = null;

/** Publishes `floor` as the held piece's while the calling (Selection) marker is mounted. */
export const useHoldAt = (floor: Vec3) => {
  const [x, y, z] = floor;
  useLayoutEffect(() => {
    heldFloor = [x, y, z];
    return () => {
      heldFloor = null;
    };
  }, [x, y, z]);
};

/** The held piece's floor, or null (for useFrame). */
export const heldAt = () => heldFloor;
