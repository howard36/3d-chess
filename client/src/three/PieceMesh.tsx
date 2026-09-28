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
import { useDesign } from './designs/context';
import { Lift, pieceLift, Topple } from './designs/kit/motion';
import { useSettingsOf } from './designs/settings';
import { noRaycast } from './designs/kit/noRaycast';
import type { Design } from './designs/types';
import type { Orientation } from './layout';

export type PieceMeshProps = JSX.IntrinsicElements['group'] & {
  type: PieceType;
  color: 'white' | 'black';
  emissive?: string | number;
  position?: [number, number, number];
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  selected?: boolean;
  hovered?: boolean;
  inCheck?: boolean;
  /** This king has been checkmated. */
  mated?: boolean;
  /** Yaw for a knight's head, when the board decides which way it faces. */
  facing?: number;
  /** The seat the board is drawn for, passed on to the design's piece body. */
  orientation?: Orientation;
  /** The level (engine z) of the piece's cell, passed on to the design's piece body. */
  level?: number;
};

const PIECE_TYPES = new Set<string>(Object.values(PieceType));

// --- The hit proxy ----------------------------------------------------------------
//
// Pointer events and clicks on a piece hit an invisible, static stand-in for
// it rather than its visible meshes: a solid of revolution fitted round the
// body where it rests, tall enough to take in the body lifted too. The visible
// body is never hit-tested (its group's raycast stops three's descent), so a
// piece that rises under the pointer, bobs or animates cannot slide out from
// under it and back, which made a lifting piece flicker between hovered and
// not when the pointer sat near its base.

/** Opts an object's whole subtree out of raycasting (three skips its children). */
const skipSubtree = () => false as const;
// Never drawn (the proxy is invisible), but Mesh.raycast needs a material
const proxyMaterial = new MeshBasicMaterial();
// Until a body has been measured (or when it draws nothing): a generic piece
const FALLBACK = { radius: 0.3, height: 0.9 };
const fallbacks = new Map<number, BufferGeometry>();
const fallbackProxy = (extra: number) => {
  let g = fallbacks.get(extra);
  if (!g) {
    const h = FALLBACK.height + extra;
    g = new CylinderGeometry(FALLBACK.radius, FALLBACK.radius, h, 16).translate(0, h / 2, 0);
    fallbacks.set(extra, g);
  }
  return g;
};
// Measured proxies, per design, piece and army, and lift
const proxies = new WeakMap<Design, Map<string, BufferGeometry>>();
const SLICES = 8;

/**
 * The profile of a piece body, measured round its vertical axis: the widest
 * extent of its hit-testable meshes (decoration made with the kit's
 * noRaycast is left out) in each of a few height bands, in the body's own
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

/** A stepped solid of revolution round a measured body, `extra` taller at the top. */
const proxyGeometry = (body: NonNullable<ReturnType<typeof measureBody>>, extra: number) => {
  const pad = 0.01;
  const profile = [new Vector2(0, 0)];
  let from = 0;
  body.radii.forEach((r, k) => {
    const to = k === SLICES - 1 ? body.top + extra : body.heights[k];
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
  emissive,
  position,
  onClick,
  selected = false,
  hovered = false,
  inCheck = false,
  mated = false,
  facing,
  orientation = 'white',
  level,
  ...rest
}) {
  const design = useDesign();
  const seat = useRef<Group>(null);
  const proxy = useRef<Mesh>(null);
  const lift = pieceLift(design.hoverLift, useSettingsOf(design));
  // The proxy takes in the body at its highest
  const extra = lift ? Math.max(lift.hover, lift.selected + lift.bob) : 0;

  // Fit the proxy to the body once per design, piece and army (bodies of a
  // kind share their shape), after the body's meshes exist
  const proxyKey = `${type}/${color}/${extra}`;
  useLayoutEffect(() => {
    if (!seat.current || !proxy.current) return;
    let byDesign = proxies.get(design);
    if (!byDesign) proxies.set(design, (byDesign = new Map()));
    let geometry = byDesign.get(proxyKey);
    if (!geometry) {
      const body = measureBody(seat.current);
      // Not remembered when there is nothing to measure yet
      if (!body) return;
      geometry = proxyGeometry(body, extra);
      byDesign.set(proxyKey, geometry);
    }
    proxy.current.geometry = geometry;
  }, [design, proxyKey, extra]);

  if (!PIECE_TYPES.has(type)) return null;
  const Body = design.PieceBody;

  // In the lattice the armies hold opposite edges of the cube (low and near,
  // high and far), so the knight's profile should face the default camera; a
  // slight opposing turn per color keeps the two armies from looking like
  // mirror stamps. Rotation lives on the inner group so the outer group only
  // carries the position/userData/handler contract.
  const yaw = design.knightYaw ?? 0.35;
  const rotation: [number, number, number] =
    type === PieceType.Knight ? [0, facing ?? (color === 'white' ? -yaw : yaw), 0] : [0, 0, 0];

  let body = (
    <Body
      type={type}
      color={color}
      emissive={emissive ?? 0x000000}
      selected={selected}
      hovered={hovered}
      inCheck={inCheck}
      orientation={orientation}
      level={level}
    />
  );
  // Picked up, a piece floats off its floor (bobbing if the design asks);
  // under the pointer, it stirs.
  if (lift) {
    body = (
      <Lift
        height={selected ? lift.selected : hovered ? lift.hover : 0}
        bob={selected ? lift.bob : 0}
        seconds={selected ? lift.selectSeconds : lift.hoverSeconds}
      >
        {body}
      </Lift>
    );
  }
  if (design.toppleMatedKing) body = <Topple active={mated}>{body}</Topple>;

  // Pieces are modeled base-at-y=0; seat them on the cell floor, scaled
  // about the base when the design shrinks its pieces
  const seatAt: [number, number, number] = [0, design.layout.floorY, 0];
  const scale =
    design.pieceScale !== undefined && design.pieceScale !== 1 ? design.pieceScale : undefined;
  return (
    <group
      position={position}
      onClick={onClick}
      userData={{ piece: { type, color }, emissive }}
      {...rest}
    >
      {/* The body: drawn, never hit-tested */}
      <group
        ref={seat}
        position={seatAt}
        rotation={rotation}
        {...(scale !== undefined ? { scale } : {})}
        raycast={skipSubtree}
      >
        {body}
      </group>
      {/* What pointer events hit instead: still, invisible, in the same frame */}
      <mesh
        ref={proxy}
        position={seatAt}
        scale={scale ?? 1}
        geometry={fallbackProxy(extra)}
        material={proxyMaterial}
        visible={false}
        userData={{ hitProxy: true }}
      />
    </group>
  );
});
