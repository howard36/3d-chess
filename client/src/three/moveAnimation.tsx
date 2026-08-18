import React, { useLayoutEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import type { PieceType } from '../engine/pieces';
import { CELL_FLOOR_Y } from './layout';
import { easeInOutCubic, MOVE_ANIMATION } from './motion';
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
 */
export const MoveGlide = ({
  from,
  to,
  children,
}: {
  from: Vec3;
  to: Vec3;
  children: React.ReactNode;
}) => {
  const group = useRef<Group>(null);
  const elapsedMs = useRef(0);
  const done = useRef(false);
  const dx = from[0] - to[0];
  const dy = from[1] - to[1];
  const dz = from[2] - to[2];

  // Seat the piece on the source cell before first paint.
  useLayoutEffect(() => {
    group.current?.position.set(dx, dy, dz);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only; a new move mounts a new wrapper
  }, []);

  useFrame((_, delta) => {
    const g = group.current;
    if (done.current || !g) return;
    elapsedMs.current += Math.min(delta * 1000, MOVE_ANIMATION.maxFrameMs);
    const t = Math.min(elapsedMs.current / MOVE_ANIMATION.durationMs, 1);
    if (t >= 1) {
      g.position.set(0, 0, 0);
      done.current = true;
      return;
    }
    const e = easeInOutCubic(t);
    const remain = 1 - e;
    g.position.set(
      dx * remain,
      // Parabolic lift with its apex at the spatial midpoint of the glide
      dy * remain + MOVE_ANIMATION.liftWorld * 4 * e * remain,
      dz * remain,
    );
  });

  return (
    <group ref={group} userData={{ moveGlide: true }}>
      {children}
    </group>
  );
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

  useFrame((_, delta) => {
    const g = group.current;
    if (finished || !g) return;
    if (!materials.current) {
      // First frame: the ghost must never intercept pointer events, and its
      // materials (fresh instances per PieceMesh, so live pieces are
      // unaffected) need to blend rather than punch holes in the cell fills.
      const mats: MeshStandardMaterial[] = [];
      g.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh) return;
        mesh.raycast = () => null;
        const material = mesh.material as MeshStandardMaterial;
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
    if (t >= 1) setFinished(true);
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
