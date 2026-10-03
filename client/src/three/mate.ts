import { FRAME, MARGIN } from './scene/palette';
import type { Vec3 } from './types';

// How far a fallen king reaches from where he stood (world units): his
// height, and the rim he pivots on
const FALLEN_REACH = 0.9;

/**
 * Which way a mated king at `king` falls (level, unit x, z): away from the
 * piece that mated him at `from`, or as near that as keeps him on his
 * platform; null (the camera's right) when it stands straight above or below.
 */
export const fallAway = (king: Vec3, from: Vec3): [number, number] | null => {
  const dx = king[0] - from[0];
  const dz = king[2] - from[2];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  const base = Math.atan2(dz, dx);
  const edge = FRAME.half + MARGIN;
  // Turning a little further from straight away each time, either side
  for (let step = 0; step <= 12; step++) {
    for (const sign of step === 0 ? [1] : [1, -1]) {
      const a = base + (sign * step * Math.PI) / 12;
      const x = Math.cos(a);
      const z = Math.sin(a);
      const tipX = king[0] + x * FALLEN_REACH;
      const tipZ = king[2] + z * FALLEN_REACH;
      if (Math.abs(tipX) <= edge && Math.abs(tipZ) <= edge) return [x, z];
    }
  }
  return [dx / length, dz / length];
};
