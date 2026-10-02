import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import type { Group } from 'three';
import { MOVE_ANIMATION } from './motion';
import { glideEndMs, glidePose, touchdownMs } from './glide';
import type { GlidePlan } from './glide';
import { GlideContext } from './pieceMotion';
import type { Vec3 } from './types';

/**
 * Carries its children from the move's source cell into their resting
 * place along the plan (planGlide), and shapes them on the way: squash,
 * stretch and lean, about the foot of the piece on its destination square
 * (`foot`, a world position).
 *
 * The children keep their own declarative world `position`; this wrapper only
 * carries the animated remainder of the journey. It deliberately has no
 * `position` prop — the start offset is set imperatively once, so a
 * mid-flight React re-render can never snap the piece back. Mount the
 * wrapper freshly (via key) for each move to be animated.
 *
 * The Canvas runs a demand-driven frame loop (nothing renders unless asked),
 * so the glide requests a frame on mount and again from every in-flight
 * frame; the frame that settles it needs no successor. The per-frame delta is
 * clamped because the first frame after an idle stretch reports the whole
 * idle time.
 */
export const MoveGlide = ({
  plan,
  foot,
  children,
  fromLevel,
  toLevel,
  onLanded,
}: {
  plan: GlidePlan;
  foot: Vec3;
  children: React.ReactNode;
  /**
   * The levels (engine z) the move leaves and lands on, handed to the piece
   * body through useGlide (pieceMotion.tsx) with the glide's progress.
   */
  fromLevel?: number;
  toLevel?: number;
  /**
   * Called once when the piece touches down, so what the move brings about
   * can wait for it. (A newer move's glide supersedes this one, and reports
   * its own landing.)
   */
  onLanded?: () => void;
}) => {
  const group = useRef<Group>(null);
  const shape = useRef<Group>(null);
  const progress = useRef(0);
  const glide = useMemo(
    () =>
      fromLevel === undefined || toLevel === undefined ? null : { fromLevel, toLevel, progress },
    [fromLevel, toLevel],
  );
  const elapsedMs = useRef(0);
  const landed = useRef(false);
  const done = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  // The axis it leans about: level, across its heading (up × heading)
  const axis = useMemo(
    () => (plan.heading ? new Vector3(plan.heading[1], 0, -plan.heading[0]) : null),
    [plan],
  );
  const turn = useMemo(() => new Quaternion(), []);

  const apply = (ms: number) => {
    const pose = glidePose(plan, ms);
    progress.current = pose.progress;
    group.current?.position.set(...pose.offset);
    const s = shape.current;
    if (s) {
      const across = 1 / Math.sqrt(pose.scaleY);
      s.scale.set(across, pose.scaleY, across);
      if (axis) s.quaternion.copy(turn.setFromAxisAngle(axis, pose.lean));
      else s.quaternion.identity();
    }
  };

  // Seat the piece on the source cell before first paint.
  useLayoutEffect(() => {
    apply(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only; a new move mounts a new wrapper
  }, []);

  useEffect(() => invalidate(), [invalidate]);
  const latestLanded = useRef(onLanded);
  latestLanded.current = onLanded;

  useFrame((_, delta) => {
    if (done.current || !group.current) return;
    elapsedMs.current += Math.min(delta * 1000, MOVE_ANIMATION.maxFrameMs);
    const ms = elapsedMs.current;
    apply(ms);
    if (!landed.current && ms >= touchdownMs(plan)) {
      landed.current = true;
      latestLanded.current?.();
    }
    if (ms >= glideEndMs(plan)) {
      done.current = true;
      return;
    }
    invalidate();
  });

  // The same arrays from one render to the next (r3f redraws for a prop handed anew)
  const [fx, fy, fz] = foot;
  const [at, back] = useMemo<[Vec3, Vec3]>(
    () => [
      [fx, fy, fz],
      [-fx, -fy, -fz],
    ],
    [fx, fy, fz],
  );
  return (
    <group ref={group} userData={{ moveGlide: true }}>
      <group position={at}>
        <group ref={shape}>
          <group position={back}>
            <GlideContext.Provider value={glide}>{children}</GlideContext.Provider>
          </group>
        </group>
      </group>
    </group>
  );
};
