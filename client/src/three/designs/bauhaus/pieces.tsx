import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { BufferGeometry, Material } from 'three';
import { PieceType } from '../../../engine/pieces';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor, Vec3 } from '../types';
import { inkMaterial, toonMaterial, withOutline } from './toon';

// The Bauhaus set: every piece is built from pure primitives, flat-shaded in
// one primary with a black ink outline. Silhouettes, not detail, tell them
// apart: a ball (pawn), a block tower (rook), a cone (bishop), a Γ (knight),
// a needle (unicorn), a ring on a column (queen), a cross on a column (king).

export const INK = '#141414';
export const RED = '#e63b2e';
export const BLUE = '#1f4bd8';
export const YELLOW = '#f6c62a';
export const PAPER = '#f1ebdd';

// Three flat tones per army: lit, mid and shade.
const TONES: Record<PieceColor, [string, string, string]> = {
  white: ['#f2553a', '#d8321f', '#9e1f14'],
  black: ['#3a66f0', '#1f47cc', '#122a86'],
};

type Glow = 'none' | 'hover' | 'selected' | 'check';

const fills = new Map<string, Material>();
const fillFor = (color: PieceColor, glow: Glow) => {
  const key = `${color}-${glow}`;
  let m = fills.get(key);
  if (!m) {
    const [lit, mid, shade] = TONES[color];
    // A picked-up piece brightens its lit face toward yellow, like a light on it.
    m =
      glow === 'selected' || glow === 'hover'
        ? toonMaterial(color === 'white' ? '#ff8a4a' : '#6f95ff', mid, shade)
        : toonMaterial(lit, mid, shade);
    fills.set(key, m);
  }
  return m;
};

const inks: Record<Glow, Material> = {
  none: inkMaterial(INK, 0.022),
  hover: inkMaterial(INK, 0.03),
  selected: inkMaterial(INK, 0.036),
  check: inkMaterial(YELLOW, 0.045),
};

export const inkBlack = new MeshBasicMaterial({ color: INK });

// --- Geometry -------------------------------------------------------------

const box = (w: number, h: number, d: number, y: number) =>
  withOutline(new BoxGeometry(w, h, d).translate(0, y + h / 2, 0));
const cylinder = (r: number, h: number, y: number, segments = 40) =>
  withOutline(new CylinderGeometry(r, r, h, segments).translate(0, y + h / 2, 0));

const G = {
  // Pawn: a ball on a drum
  pawnDrum: cylinder(0.17, 0.17, 0),
  pawnBall: withOutline(new SphereGeometry(0.155, 32, 20).translate(0, 0.31, 0)),
  // Rook: a block tower with a broad cap
  rookFoot: box(0.46, 0.08, 0.46, 0),
  rookShaft: box(0.32, 0.4, 0.32, 0.08),
  rookCap: box(0.46, 0.17, 0.46, 0.48),
  // Bishop: a cone
  bishopCone: withOutline(new ConeGeometry(0.255, 0.68, 48).translate(0, 0.34, 0)),
  // Knight: a Γ on a slab — neck up, head forward
  knightSlab: box(0.44, 0.08, 0.3, 0),
  knightNeck: withOutline(new BoxGeometry(0.17, 0.6, 0.26).translate(-0.1, 0.38, 0)),
  knightHead: withOutline(new BoxGeometry(0.4, 0.18, 0.26).translate(0.03, 0.59, 0)),
  knightEye: new BoxGeometry(0.05, 0.05, 0.28).translate(0.08, 0.6, 0),
  // Unicorn: a three-sided needle on a square plinth
  unicornPlinth: box(0.3, 0.14, 0.3, 0),
  unicornNeedle: withOutline(new ConeGeometry(0.16, 0.72, 3).translate(0, 0.14 + 0.36, 0)),
  // Queen: a ring on a column
  queenFoot: cylinder(0.22, 0.06, 0),
  queenColumn: cylinder(0.075, 0.44, 0.06, 24),
  queenRing: withOutline(new TorusGeometry(0.155, 0.048, 16, 48).translate(0, 0.66, 0)),
  // King: a cross of cubes on a column
  kingFoot: box(0.44, 0.07, 0.44, 0),
  kingColumn: box(0.15, 0.44, 0.15, 0.07),
  kingBar: withOutline(new BoxGeometry(0.42, 0.13, 0.13).translate(0, 0.66, 0)),
  kingPost: withOutline(new BoxGeometry(0.13, 0.4, 0.13).translate(0, 0.68, 0)),
};

const PARTS: Record<PieceType, { g: BufferGeometry; rot?: Vec3 }[]> = {
  [PieceType.Pawn]: [{ g: G.pawnDrum }, { g: G.pawnBall }],
  [PieceType.Rook]: [{ g: G.rookFoot }, { g: G.rookShaft }, { g: G.rookCap }],
  [PieceType.Bishop]: [{ g: G.bishopCone }],
  [PieceType.Knight]: [{ g: G.knightSlab }, { g: G.knightNeck }, { g: G.knightHead }],
  [PieceType.Unicorn]: [{ g: G.unicornPlinth, rot: [0, Math.PI / 4, 0] }, { g: G.unicornNeedle }],
  [PieceType.Queen]: [
    { g: G.queenFoot },
    { g: G.queenColumn },
    { g: G.queenRing, rot: [0, 0.5, 0] },
  ],
  [PieceType.King]: [{ g: G.kingFoot }, { g: G.kingColumn }, { g: G.kingBar }, { g: G.kingPost }],
};

/** The meshes of one piece. `decor` copies (capture debris) never take a ray. */
export const BauhausPiece = ({
  type,
  color,
  glow = 'none',
  decor = false,
}: {
  type: PieceType;
  color: PieceColor;
  glow?: Glow;
  decor?: boolean;
}) => {
  const fill = fillFor(color, glow);
  const ink = inks[glow];
  return (
    <>
      {PARTS[type].map(({ g, rot }, i) => (
        <group key={i} rotation={rot}>
          <mesh geometry={g} material={fill} raycast={decor ? noRaycast : undefined} />
          <mesh geometry={g} material={ink} raycast={noRaycast} />
        </group>
      ))}
      {type === PieceType.Knight && (
        <mesh geometry={G.knightEye} material={inkBlack} raycast={noRaycast} />
      )}
    </>
  );
};

export const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => (
  <BauhausPiece
    type={type}
    color={color}
    glow={inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none'}
  />
);
