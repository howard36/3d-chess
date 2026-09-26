import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import type { PieceType } from '../engine/pieces';
import { CELL_FLOOR_Y } from './layout';
import { easeInOutCubic, MOVE_ANIMATION } from './motion';
import type { DesignMotion } from './designs/types';
import { PieceMesh } from './PieceMesh';

type Vec3 = [number, number, number];

/**
 * Glides its children from the `from` cell into their resting place.
 *
 * The children keep their own declarative world `position`; this wrapper only
 * carries the animated remainder of the journey, easing from `from - to` to
 * zero. It deliberately has no `position` prop — the start offset is set
 * imperatively once, so a mid-flight React re-render can never snap the piece
 * back. Mount the wrapper freshly (via key) for each move to be animated.
 *
 * The Canvas runs a demand-driven frame loop (nothing renders unless asked),
 * so both animations here request a frame on mount and again from every
 * in-flight frame; the frame that lands the tween needs no successor. The
 * per-frame delta is clamped because the first frame after an idle stretch
 * reports the whole idle time.
 */
export const MoveGlide = ({
  from,
  to,
  children,
  motion = CLASSIC_MOTION,
  floorY = CELL_FLOOR_Y,
}: {
  from: Vec3;
  to: Vec3;
  children: React.ReactNode;
  motion?: DesignMotion;
  /** Cell-local floor height: squash and pop scale about the piece's base. */
  floorY?: number;
}) => {
  const group = useRef<Group>(null);
  const scaler = useRef<Group>(null);
  const elapsedMs = useRef(0);
  const done = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  const dx = from[0] - to[0];
  const dy = from[1] - to[1];
  const dz = from[2] - to[2];
  const { style, durationMs, lift } = motion;
  // A bounce keeps going after touchdown while the squash settles.
  const settleMs = style === 'bounce' ? SQUASH_MS : 0;

  // Seat the piece on the source cell before first paint.
  useLayoutEffect(() => {
    group.current?.position.set(dx, dy, dz);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only; a new move mounts a new wrapper
  }, []);

  useEffect(() => invalidate(), [invalidate]);

  useFrame((_, delta) => {
    const g = group.current;
    if (done.current || !g) return;
    elapsedMs.current += Math.min(delta * 1000, MOVE_ANIMATION.maxFrameMs);
    const t = Math.min(elapsedMs.current / durationMs, 1);
    const s = scaler.current;
    if (elapsedMs.current >= durationMs + settleMs) {
      g.position.set(0, 0, 0);
      s?.scale.set(1, 1, 1);
      done.current = true;
      return;
    }
    if (style === 'teleport') {
      // Out at the source for the first half, in at the destination after
      const out = t < 0.5;
      const k = out ? 1 - easeInOutCubic(t / 0.5) : easeOutBack((t - 0.5) / 0.5);
      if (out) g.position.set(dx, dy, dz);
      else g.position.set(0, 0, 0);
      s?.scale.setScalar(Math.max(k, 1e-4));
    } else if (style === 'slide') {
      const remain = 1 - easeInOutCubic(t);
      g.position.set(dx * remain, dy * remain, dz * remain);
    } else {
      const e = easeInOutCubic(t);
      const remain = 1 - e;
      g.position.set(
        dx * remain,
        // Parabolic lift with its apex at the spatial midpoint of the glide
        dy * remain + lift * 4 * e * remain,
        dz * remain,
      );
      if (style === 'bounce' && s) {
        const after = elapsedMs.current - durationMs;
        if (after >= 0) {
          // Touchdown: squash flat and wide, then wobble back to shape
          const k = after / SQUASH_MS;
          const squash = Math.sin(k * Math.PI * 2.5) * Math.exp(-k * 4) * 0.22;
          s.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);
        } else {
          // Stretched along the flight while airborne
          const stretch = Math.sin(t * Math.PI) * 0.1;
          s.scale.set(1 - stretch * 0.4, 1 + stretch, 1 - stretch * 0.4);
        }
      }
    }
    invalidate();
  });

  const scaled = style === 'bounce' || style === 'teleport';
  return (
    <group ref={group} userData={{ moveGlide: true }}>
      {scaled ? (
        <group position={[0, floorY, 0]}>
          <group ref={scaler}>
            <group position={[0, -floorY, 0]}>{children}</group>
          </group>
        </group>
      ) : (
        children
      )}
    </group>
  );
};

const SQUASH_MS = 320;

const easeOutBack = (t: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

const CLASSIC_MOTION: DesignMotion = {
  style: 'hop',
  durationMs: MOVE_ANIMATION.durationMs,
  lift: MOVE_ANIMATION.liftWorld,
};

/**
 * The piece just captured on the last move, fading and shrinking away under
 * the arriving capturer. Scales about the piece's base so it sinks into the
 * cell floor, then unmounts its meshes once fully gone.
 */
export const GhostPiece = ({
  type,
  color,
  position,
}: {
  type: PieceType;
  color: 'white' | 'black';
  position: Vec3;
}) => {
  const group = useRef<Group>(null);
  const elapsedMs = useRef(0);
  const materials = useRef<MeshStandardMaterial[] | null>(null);
  const [finished, setFinished] = useState(false);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => invalidate(), [invalidate]);
  // The faded copies are the ghost's own; free them with it.
  useEffect(() => () => materials.current?.forEach((m) => m.dispose()), []);

  useFrame((_, delta) => {
    const g = group.current;
    if (finished || !g) return;
    if (!materials.current) {
      // First frame: the ghost must never intercept pointer events, and its
      // materials need to blend rather than punch holes in the cell fills.
      // They are cloned first: a design may share one material between all
      // the pieces of an army, and fading that would fade them all.
      const mats: MeshStandardMaterial[] = [];
      g.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh) return;
        mesh.raycast = () => null;
        const material = (mesh.material as MeshStandardMaterial).clone();
        mesh.material = material;
        material.transparent = true;
        material.depthWrite = false;
        mats.push(material);
      });
      materials.current = mats;
    }
    elapsedMs.current += Math.min(delta * 1000, MOVE_ANIMATION.maxFrameMs);
    const t = Math.min(elapsedMs.current / MOVE_ANIMATION.durationMs, 1);
    const e = easeInOutCubic(t);
    g.scale.setScalar(Math.max(1 - e, 1e-4));
    for (const material of materials.current) material.opacity = 1 - e;
    // Unmounting is a React commit, which requests the frame that removes it.
    if (t >= 1) setFinished(true);
    else invalidate();
  });

  if (finished) return null;
  // Anchor the wrapper at the cell floor and push the PieceMesh back up, so
  // the scale pivot is the piece's base rather than the cell centre.
  return (
    <group
      ref={group}
      position={[position[0], position[1] + CELL_FLOOR_Y, position[2]]}
      userData={{ ghostPiece: true }}
    >
      <PieceMesh type={type} color={color} position={[0, -CELL_FLOOR_Y, 0]} />
    </group>
  );
};
