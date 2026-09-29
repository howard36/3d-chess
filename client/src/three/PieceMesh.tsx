import React, { useLayoutEffect, useRef } from 'react';
import type { JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import {
  CylinderGeometry,
  LatheGeometry,
  Matrix4,
  MeshBasicMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { BufferGeometry, Group, Mesh, Object3D } from 'three';
import { PieceType } from '../engine';
import { noRaycast } from './noRaycast';
import { Lift, PIECE_LIFT, Topple } from './pieceMotion';
import { layout, PIECE_SCALE } from './scene/palette';
import { PieceBody } from './scene/pieces';

export type PieceMeshProps = JSX.IntrinsicElements['group'] & {
  type: PieceType;
  color: 'white' | 'black';
  position?: [number, number, number];
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  selected?: boolean;
  hovered?: boolean;
  inCheck?: boolean;
  /** This king has been checkmated: he topples. */
  mated?: boolean;
  /** Yaw of a knight's head: the board decides which way it faces. */
  facing?: number;
  /** The level (engine z) of the piece's cell, passed on to the piece's body. */
  level?: number;
};

const PIECE_TYPES = new Set<string>(Object.values(PieceType));

// --- The hit proxy ----------------------------------------------------------------
//
// Pointer events and clicks on a piece hit an invisible, static stand-in for
// it rather than its visible meshes: a solid of revolution fitted round the
// body where it rests, tall enough to take in the body lifted too. The visible
// body is never hit-tested (its group's raycast stops three's descent), so a
// piece that rises under the pointer, or animates, cannot slide out from
// under it and back, which made a lifting piece flicker between hovered and
// not when the pointer sat near its base.

/** Opts an object's whole subtree out of raycasting (three skips its children). */
const skipSubtree = () => false as const;
// Never drawn (the proxy is invisible), but Mesh.raycast needs a material
const proxyMaterial = new MeshBasicMaterial();
// The proxy takes in the body at its highest, held
const EXTRA = PIECE_LIFT.selected;
// Until a body has been measured (or when it draws nothing): a generic piece
const FALLBACK = { radius: 0.3, height: 0.9 };
const fallbackHeight = FALLBACK.height + EXTRA;
const fallbackProxy = new CylinderGeometry(
  FALLBACK.radius,
  FALLBACK.radius,
  fallbackHeight,
  16,
).translate(0, fallbackHeight / 2, 0);
// Measured proxies, per piece and army
const proxies = new Map<string, BufferGeometry>();
const SLICES = 8;

/**
 * The profile of a piece body, measured round its vertical axis: the widest
 * extent of its hit-testable meshes (decoration made with noRaycast is
 * left out) in each of a few height bands, in the body's own
 * frame, with any Lift or animation taken out. Null when it draws nothing.
 */
const measureBody = (
  root: Object3D,
): { heights: number[]; radii: number[]; top: number } | null => {
  const points: [number, number][] = [];
  const m = new Matrix4();
  const v = new Vector3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.raycast === noRaycast || !mesh.geometry) return;
    // The mesh's frame in the root's: its own and its parents' local
    // transforms, but for a Lift's (the proxy covers the lifted body anyway)
    m.identity();
    for (let a: Object3D | null = mesh; a && a !== root; a = a.parent) {
      if (!a.visible) return;
      if (a.userData.lift) continue;
      a.updateMatrix();
      m.premultiply(a.matrix);
    }
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(m);
      points.push([Math.hypot(v.x, v.z), v.y]);
    }
  });
  let top = 0;
  for (const [, y] of points) top = Math.max(top, y);
  if (!(top > 0)) return null;
  const radii = new Array<number>(SLICES).fill(0);
  for (const [r, y] of points) {
    const k = Math.min(Math.max(Math.floor((y / top) * SLICES), 0), SLICES - 1);
    radii[k] = Math.max(radii[k], r);
  }
  // A band with nothing in it takes its neighbours' width
  for (let k = 0; k < SLICES; k++) {
    if (radii[k] === 0) radii[k] = Math.max(radii[k - 1] ?? 0, radii[k + 1] ?? 0);
  }
  return { heights: radii.map((_, k) => ((k + 1) / SLICES) * top), radii, top };
};

/** A stepped solid of revolution round a measured body, EXTRA taller at the top. */
const proxyGeometry = (body: NonNullable<ReturnType<typeof measureBody>>) => {
  const pad = 0.01;
  const profile = [new Vector2(0, 0)];
  let from = 0;
  body.radii.forEach((r, k) => {
    const to = k === SLICES - 1 ? body.top + EXTRA : body.heights[k];
    profile.push(new Vector2(r + pad, from), new Vector2(r + pad, to));
    from = to;
  });
  profile.push(new Vector2(0, from));
  return new LatheGeometry(profile, 16);
};

// --- The piece --------------------------------------------------------------------

// Memoized: a piece is up to 13 meshes, and the board re-renders on every
// selection change and incoming message. Board passes referentially stable
// position arrays and handlers so the shallow comparison actually skips.
export const PieceMesh: React.FC<PieceMeshProps> = React.memo(function PieceMesh({
  type,
  color,
  position,
  onClick,
  selected = false,
  hovered = false,
  inCheck = false,
  mated = false,
  facing = 0,
  level = 0,
  ...rest
}) {
  const seat = useRef<Group>(null);
  const proxy = useRef<Mesh>(null);

  // Fit the proxy to the body once per piece and army (bodies of a kind
  // share their shape), after the body's meshes exist
  const proxyKey = `${type}/${color}`;
  useLayoutEffect(() => {
    if (!seat.current || !proxy.current) return;
    let geometry = proxies.get(proxyKey);
    if (!geometry) {
      const body = measureBody(seat.current);
      // Not remembered when there is nothing to measure yet
      if (!body) return;
      geometry = proxyGeometry(body);
      proxies.set(proxyKey, geometry);
    }
    proxy.current.geometry = geometry;
  }, [proxyKey]);

  if (!PIECE_TYPES.has(type)) return null;

  // The knight turns to the yaw the board gives it. Rotation lives on the
  // inner group so the outer group only carries the position/userData/handler
  // contract.
  const rotation: [number, number, number] = [0, type === PieceType.Knight ? facing : 0, 0];

  // Picked up, a piece floats off its floor; under the pointer, it stirs. A
  // mated king topples.
  const body = (
    <Topple active={mated}>
      <Lift
        height={selected ? PIECE_LIFT.selected : hovered ? PIECE_LIFT.hover : 0}
        seconds={selected ? PIECE_LIFT.selectSeconds : PIECE_LIFT.hoverSeconds}
      >
        <PieceBody
          type={type}
          color={color}
          selected={selected}
          hovered={hovered}
          inCheck={inCheck}
          level={level}
        />
      </Lift>
    </Topple>
  );

  // Pieces are modeled base-at-y=0; seat them on the cell floor, scaled about
  // the base to fit the gap under the level above
  const seatAt: [number, number, number] = [0, layout.floorY, 0];
  return (
    <group position={position} onClick={onClick} userData={{ piece: { type, color } }} {...rest}>
      {/* The body: drawn, never hit-tested */}
      <group
        ref={seat}
        position={seatAt}
        rotation={rotation}
        scale={PIECE_SCALE}
        raycast={skipSubtree}
      >
        {body}
      </group>
      {/* What pointer events hit instead: still, invisible, in the same frame */}
      <mesh
        ref={proxy}
        position={seatAt}
        scale={PIECE_SCALE}
        geometry={fallbackProxy}
        material={proxyMaterial}
        visible={false}
        userData={{ hitProxy: true }}
      />
    </group>
  );
});
