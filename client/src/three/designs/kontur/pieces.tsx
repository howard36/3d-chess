import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Group, Material, Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { PieceType } from '../../../engine/pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { floorBelow } from './layout';
import { clamp01, useTimeline } from './motion';
import { ARMY, COBALT, INK, KEYLINE, SHADOW, VERMILION } from './palette';
import { inkMaterial, toonMaterial, withOutline } from './toon';

// The Kontur set, after Josef Hartwig's 1923 Bauhaus chessmen: every piece
// is a few pure solids, and where it can, its form says how it moves.
//
// - Pawn: a ball on a drum, the smallest piece.
// - Rook: a square keep with four corner merlons (a square with four nubs
//   from above).
// - Knight: an L, neck and head, the shape of its jump.
// - Bishop: a four-sided pyramid whose ridges run along the diagonals (an X
//   from above), capped with a bead.
// - Unicorn: a cube balanced on its corner, its space diagonal upright: the
//   line it moves along (a hexagon from above).
// - Queen: a ball ringed like a planet on a tapering column.
// - King: a cross on a square column, the tallest piece (a plus from above).
//
// Built at their final size: the king stands 0.74 tall, which leaves the
// pieces clear air under the platform above.

// --- Geometry ------------------------------------------------------------------

const part = (g: BufferGeometry, flat = false): BufferGeometry => {
  let out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  // Faceted solids (the pyramid) shade face by face
  if (flat) out.computeVertexNormals();
  out.deleteAttribute('uv');
  out = withOutline(out);
  return out;
};

const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  part(new BoxGeometry(w, h, d).translate(x, y + h / 2, z));
const drum = (r: number, h: number, y: number, segments = 28, rTop = r) =>
  part(new CylinderGeometry(rTop, r, h, segments).translate(0, y + h / 2, 0));
const ball = (r: number, y: number) => part(new SphereGeometry(r, 22, 14).translate(0, y, 0));

const merge = (parts: BufferGeometry[]) => {
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
};

// A cube stood on a corner: its (1, 1, 1) diagonal turned upright
const cubeOnCorner = (edge: number, y: number) => {
  const g = new BoxGeometry(edge, edge, edge);
  g.applyQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(1, 1, 1).normalize(), new Vector3(0, 1, 0)),
  );
  // A corner toward each seat's opening camera (16° and 196°), so from
  // either side it stands as a symmetric hexagon
  g.rotateY((-29 * Math.PI) / 180);
  const half = (edge * Math.sqrt(3)) / 2;
  return part(g.translate(0, y + half, 0));
};

// The head, pivoted at the back of the neck and dipped toward the muzzle
const HEAD_DIP = -0.24;
const headTransform = (g: BufferGeometry) =>
  g.translate(0.2, 0, 0).rotateZ(HEAD_DIP).translate(-0.19, 0.49, 0);
const knightHead = () => part(headTransform(new BoxGeometry(0.4, 0.17, 0.24)));

const pyramid = (r: number, h: number) =>
  // Four segments put the corners on the axes; a quarter turn puts the
  // ridges on the diagonals and the base square along the files and ranks
  part(new ConeGeometry(r, h, 4, 1).rotateY(Math.PI / 4).translate(0, h / 2, 0), true);

const ring = (radius: number, tube: number, y: number, tilt: number) =>
  part(
    new TorusGeometry(radius, tube, 10, 40)
      .rotateX(Math.PI / 2 + tilt)
      .rotateY(0.5)
      .translate(0, y, 0),
  );

const GEOMETRY: Record<PieceType, BufferGeometry> = {
  [PieceType.Pawn]: merge([drum(0.15, 0.12, 0), ball(0.135, 0.235)]),
  [PieceType.Rook]: merge([
    box(0.38, 0.4, 0.38, 0, 0, 0),
    ...[
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sz]) => box(0.13, 0.12, 0.13, sx * 0.125, 0.4, sz * 0.125)),
  ]),
  // Head toward +x (Board turns the knight to look along the ranks)
  [PieceType.Knight]: merge([
    box(0.3, 0.07, 0.28, -0.04, 0, 0),
    box(0.22, 0.44, 0.24, -0.08, 0.07, 0),
    knightHead(),
    // Two ears
    box(0.07, 0.08, 0.065, -0.14, 0.555, 0.07),
    box(0.07, 0.08, 0.065, -0.14, 0.555, -0.07),
  ]),
  [PieceType.Bishop]: merge([pyramid(0.26, 0.55), ball(0.062, 0.565)]),
  [PieceType.Unicorn]: merge([drum(0.12, 0.07, 0, 24, 0.1), cubeOnCorner(0.3, 0.035)]),
  [PieceType.Queen]: merge([
    drum(0.2, 0.06, 0, 32),
    drum(0.13, 0.4, 0.06, 24, 0.085),
    ball(0.115, 0.56),
    ring(0.18, 0.028, 0.56, 0.32),
  ]),
  [PieceType.King]: merge([
    box(0.36, 0.06, 0.36, 0, 0, 0),
    box(0.2, 0.44, 0.2, 0, 0.06, 0),
    box(0.1, 0.24, 0.1, 0, 0.5, 0),
    box(0.34, 0.1, 0.1, 0, 0.55, 0),
    box(0.1, 0.1, 0.34, 0, 0.55, 0),
  ]),
};

/** The knight's eye: an ink square on each side of its head. */
const EYE = headTransform(new BoxGeometry(0.055, 0.05, 0.25).translate(0.06, 0.025, 0));

/** Radius of each piece's contact shadow. */
const SHADOW_RADIUS: Record<PieceType, number> = {
  [PieceType.Pawn]: 0.27,
  [PieceType.Rook]: 0.36,
  [PieceType.Knight]: 0.34,
  [PieceType.Bishop]: 0.33,
  [PieceType.Unicorn]: 0.3,
  [PieceType.Queen]: 0.33,
  [PieceType.King]: 0.36,
};

// --- Materials -----------------------------------------------------------------

const FILL: Record<PieceColor, Material> = {
  white: toonMaterial(ARMY.white.lit, ARMY.white.mid, ARMY.white.shade),
  black: toonMaterial(ARMY.black.lit, ARMY.black.mid, ARMY.black.shade),
};

type Contour = 'rest' | 'hover' | 'selected' | 'check';

// The contour carries the piece's state: at rest, ink round the white army
// and a pale keyline round the black one (so black pieces standing in a row
// stay apart); cobalt under the pointer and, bolder, when picked up, the
// same cobalt as its destinations; vermilion for a king in check.
const REST: Record<PieceColor, Material> = {
  white: inkMaterial(INK, 2.1),
  black: inkMaterial(KEYLINE, 1.6),
};
const INKS: Record<Exclude<Contour, 'rest'>, Material> = {
  hover: inkMaterial(COBALT, 2.6),
  selected: inkMaterial(COBALT, 3.6),
  check: inkMaterial(VERMILION, 3.6),
};

const eyeMaterial = new MeshBasicMaterial({ color: INK });

// --- Body ------------------------------------------------------------------------

/** The meshes of one piece. `decor` copies (effects) never take a ray. */
export const KonturPiece = ({
  type,
  color,
  contour = 'rest',
  decor = false,
  fill,
  ink,
}: {
  type: PieceType;
  color: PieceColor;
  contour?: Contour;
  decor?: boolean;
  /** Override materials (an effect's faded copies). */
  fill?: Material;
  ink?: Material;
}) => (
  <>
    <mesh
      geometry={GEOMETRY[type]}
      material={fill ?? FILL[color]}
      raycast={decor ? noRaycast : undefined}
    />
    <mesh
      geometry={GEOMETRY[type]}
      material={ink ?? (contour === 'rest' ? REST[color] : INKS[contour])}
      raycast={noRaycast}
    />
    {type === PieceType.Knight && (
      <mesh geometry={EYE} material={eyeMaterial} raycast={noRaycast} />
    )}
  </>
);

// --- Grounded shadow ---------------------------------------------------------------

const shadowTexture = (() => {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
})();

const shadowPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMaterial = new MeshBasicMaterial({
  color: SHADOW,
  alphaMap: shadowTexture,
  transparent: true,
  opacity: 0.36,
  depthWrite: false,
  toneMapped: false,
  fog: false,
});

/**
 * Keeps a shadow on the platform under its piece: a piece picked up, or in
 * flight between levels, leaves its shadow on the highest platform below it,
 * spreading a little with height. Runs as the mesh is drawn, after every
 * transform of the frame is final, so it never lags the piece.
 */
function groundShadow(this: Object3D) {
  const m = this.matrixWorld.elements;
  const y = m[13];
  const floor = floorBelow(y);
  const spread = 1 + Math.min(y - floor, 1) * 0.7;
  for (const i of [0, 1, 2, 8, 9, 10]) m[i] *= spread;
  m[13] = floor + 0.004;
}

const GroundedShadow = ({ radius }: { radius: number }) => (
  <mesh
    geometry={shadowPlane}
    material={shadowMaterial}
    scale={[radius * 2, 1, radius * 2]}
    renderOrder={LAYER.shadow}
    raycast={noRaycast}
    onBeforeRender={groundShadow}
  />
);

// --- Picked up ----------------------------------------------------------------------

/** Plays once on mount: the piece stretches up and wobbles back, a spring let go. */
const Boing = ({ target }: { target: RefObject<Group | null> }) => {
  useEffect(
    () => () => {
      target.current?.scale.set(1, 1, 1);
    },
    [target],
  );
  useTimeline(360, (t) => {
    const g = target.current;
    if (!g) return;
    const k = clamp01(t / 0.36);
    const s = k >= 1 ? 1 : 1 + Math.sin(k * Math.PI * 2.4) * Math.exp(-k * 3.2) * 0.17;
    const across = 1 / Math.sqrt(s);
    g.scale.set(across, s, across);
  });
  return null;
};

/** A piece standing on its soft contact shadow, which stays on the platform when it lifts. */
export const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const body = useRef<Group>(null);
  return (
    <>
      <GroundedShadow radius={SHADOW_RADIUS[type]} />
      <group ref={body}>
        <KonturPiece
          type={type}
          color={color}
          contour={inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'rest'}
        />
      </group>
      {selected && <Boing target={body} />}
    </>
  );
};

export { GEOMETRY as PIECE_GEOMETRY };
