import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { easeInOutCubic, MOVE_ANIMATION } from './motion';
import { GlideContext } from './pieceMotion';
import type { Vec3 } from './types';

/**
 * Glides its children from the `from` cell into their resting place, in a
 * straight line, whatever its level change.
 *
 * The children keep their own declarative world `position`; this wrapper only
 * carries the animated remainder of the journey, easing from `from - to` to
 * zero. It deliberately has no `position` prop — the start offset is set
 * imperatively once, so a mid-flight React re-render can never snap the piece
 * back. Mount the wrapper freshly (via key) for each move to be animated.
 *
 * The Canvas runs a demand-driven frame loop (nothing renders unless asked),
 * so the glide requests a frame on mount and again from every in-flight
 * frame; the frame that lands it needs no successor. The per-frame delta is
 * clamped because the first frame after an idle stretch reports the whole
 * idle time.
 */
export const MoveGlide = ({
  from,
  to,
  children,
  durationMs,
  fromLevel,
  toLevel,
  onLanded,
}: {
  from: Vec3;
  to: Vec3;
  children: React.ReactNode;
  durationMs: number;
  /**
   * The levels (engine z) the move leaves and lands on, handed to the piece
   * body through useGlide (pieceMotion.tsx) with the glide's progress.
   */
  fromLevel?: number;
  toLevel?: number;
  /**
   * Called once when the piece lands, so what the move brings about can
   * wait for it. (A newer move's glide supersedes this one, and reports its
   * own landing.)
   */
  onLanded?: () => void;
}) => {
  const group = useRef<Group>(null);
  const progress = useRef(0);
  const glide = useMemo(
    () =>
      fromLevel === undefined || toLevel === undefined ? null : { fromLevel, toLevel, progress },
    [fromLevel, toLevel],
  );
  const elapsedMs = useRef(0);
  const done = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  const dx = from[0] - to[0];
  const dy = from[1] - to[1];
  const dz = from[2] - to[2];

  // Seat the piece on the source cell before first paint.
  useLayoutEffect(() => {
    group.current?.position.set(dx, dy, dz);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only; a new move mounts a new wrapper
  }, []);

  useEffect(() => invalidate(), [invalidate]);
  const landed = useRef(onLanded);
  landed.current = onLanded;

  useFrame((_, delta) => {
    const g = group.current;
    if (done.current || !g) return;
    elapsedMs.current += Math.min(delta * 1000, MOVE_ANIMATION.maxFrameMs);
    const t = Math.min(elapsedMs.current / durationMs, 1);
    const eased = easeInOutCubic(t);
    progress.current = eased;
    if (elapsedMs.current >= durationMs) {
      progress.current = 1;
      g.position.set(0, 0, 0);
      done.current = true;
      landed.current?.();
      return;
    }
    // Straight from the source (offset d) to rest (0), eased
    g.position.set(dx - dx * eased, dy - dy * eased, dz - dz * eased);
    invalidate();
  });

  return (
    <group ref={group} userData={{ moveGlide: true }}>
      <GlideContext.Provider value={glide}>{children}</GlideContext.Provider>
    </group>
  );
};
