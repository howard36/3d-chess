import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { MOVE_ANIMATION } from './motion';
import { glidePose, touchdownMs } from './glide';
import type { GlidePlan } from './glide';
import { GlideContext } from './pieceMotion';

/**
 * Glides its children from the move's source cell into their resting place
 * along the plan (planGlide): a straight line, eased, the piece rigid.
 *
 * The children keep their own declarative world `position`; this wrapper only
 * carries the animated remainder of the journey. It deliberately has no
 * `position` prop — the start offset is set imperatively once, so a
 * mid-flight React re-render can never snap the piece back. Mount the
 * wrapper freshly (via key) for each move to be animated.
 *
 * The Canvas runs a demand-driven frame loop (nothing renders unless asked),
 * so the glide requests a frame on mount and again from every in-flight
 * frame; the frame that lands it needs no successor. The per-frame delta is
 * clamped because the first frame after an idle stretch reports the whole
 * idle time.
 */
export const MoveGlide = ({
  plan,
  children,
  fromLevel,
  toLevel,
  onLanded,
  landsEarlyMs = 0,
}: {
  plan: GlidePlan;
  children: React.ReactNode;
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
  /** Report the landing this much before the piece comes to rest (ms). */
  landsEarlyMs?: number;
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
  const reported = useRef(false);
  const invalidate = useThree((s) => s.invalidate);

  const apply = (ms: number) => {
    const pose = glidePose(plan, ms);
    progress.current = pose.progress;
    group.current?.position.set(...pose.offset);
  };

  // Seat the piece on the source cell before first paint.
  useLayoutEffect(() => {
    apply(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only; a new move mounts a new wrapper
  }, []);

  useEffect(() => invalidate(), [invalidate]);
  const landed = useRef(onLanded);
  landed.current = onLanded;

  useFrame((_, delta) => {
    if (done.current || !group.current) return;
    elapsedMs.current += Math.min(delta * 1000, MOVE_ANIMATION.maxFrameMs);
    apply(elapsedMs.current);
    if (!reported.current && elapsedMs.current >= touchdownMs(plan) - landsEarlyMs) {
      reported.current = true;
      landed.current?.();
    }
    if (elapsedMs.current >= touchdownMs(plan)) {
      done.current = true;
      return;
    }
    invalidate();
  });

  return (
    <group ref={group} userData={{ moveGlide: true }}>
      <GlideContext.Provider value={glide}>{children}</GlideContext.Provider>
    </group>
  );
};
