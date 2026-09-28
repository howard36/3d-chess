import type { Vec3 } from '../types';

// Squares whose hexagon a marker has taken over. A piece stands in a hexagon
// of its level's light (pieces.tsx); a capture, a check or the last move's
// arrival retints that hexagon rather than drawing a second one round it, so
// no two outlines ever stack. The marker draws the retinted hexagon itself,
// exactly where the piece's own lies, and claims the square; the piece's
// hexagon steps aside while the claim stands.

/** Set while a mate is on the board (by the Celebration), so the check's crown can come down. */
export const mate = { over: false };

export type ClaimKind = 'capture' | 'check' | 'arrived';

interface Claim {
  kind: ClaimKind;
  at: Vec3;
}

const claims = new Set<Claim>();

/** Claims the hexagon on the floor at `at`; returns the release. */
export const claim = (kind: ClaimKind, at: Vec3): (() => void) => {
  const c: Claim = { kind, at };
  claims.add(c);
  return () => {
    claims.delete(c);
  };
};

/**
 * Whether a marker has claimed the hexagon on the floor at (x, y, z): of
 * `kind` if given, and not counting claims of kind `except`.
 */
export const claimAt = (
  x: number,
  y: number,
  z: number,
  kind?: ClaimKind,
  except?: ClaimKind,
): boolean => {
  for (const c of claims) {
    if (kind && c.kind !== kind) continue;
    if (except && c.kind === except) continue;
    if (
      Math.abs(c.at[0] - x) < 0.06 &&
      Math.abs(c.at[1] - y) < 0.06 &&
      Math.abs(c.at[2] - z) < 0.06
    )
      return true;
  }
  return false;
};
