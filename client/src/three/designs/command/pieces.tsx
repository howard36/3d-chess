import {
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Matrix4,
  MeshStandardMaterial,
  RingGeometry,
  ShaderMaterial,
  Shape,
} from 'three';
import type { Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from '../../../engine/pieces';
import { STAUNTON } from '../../pieceGeometry';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { LEVEL_COLORS, PALETTE } from './shared';

// The armies are solid units (never see-through): ice against burnished
// amber. Each piece darkens toward its base (a core of deeper colour, like
// polished resin), and a rim of its army's light wraps its silhouette, mixed
// into the shading so it shows even on the near-white ice. The rim comes from
// the view, so it wraps every piece the same way from both seats. A king in
// check turns red through, deep red for amber and rose for ice, so it never
// reads as just another amber piece. Materials are shared by every piece of
// an army and state; anything that fades one piece clones first.

export type Glow = 'none' | 'hover' | 'selected' | 'check';

interface Look {
  color: string;
  /** The colour the body deepens to at its base. */
  core: string;
  rim: string;
  roughness: number;
  metalness: number;
  /** How far the rim colour replaces the shading at the silhouette, by state. */
  rimMix: Record<Glow, number>;
  rimPower: number;
}

const LOOK: Record<PieceColor, Look> = {
  white: {
    color: PALETTE.white,
    core: PALETTE.whiteCore,
    rim: PALETTE.whiteRim,
    roughness: 0.34,
    metalness: 0.02,
    rimMix: { none: 0.34, hover: 0.8, selected: 0.75, check: 0.6 },
    rimPower: 2.2,
  },
  black: {
    color: PALETTE.black,
    core: PALETTE.blackCore,
    rim: PALETTE.blackRim,
    roughness: 0.3,
    metalness: 0.28,
    rimMix: { none: 0.38, hover: 0.8, selected: 0.76, check: 0.6 },
    rimPower: 2.0,
  },
};

const CHECK_BODY: Record<PieceColor, { color: string; core: string }> = {
  white: { color: PALETTE.whiteInCheck, core: '#9c3a46' },
  black: { color: PALETTE.blackInCheck, core: '#4a060c' },
};

const makeBody = (side: PieceColor, glow: Glow) => {
  const look = LOOK[side];
  const check = glow === 'check' ? CHECK_BODY[side] : null;
  const m = new MeshStandardMaterial({
    color: check?.color ?? look.color,
    roughness: look.roughness,
    metalness: look.metalness,
    envMapIntensity: 0.9,
  });
  // A little light of its own, so the shadowed side never goes dead; picked
  // up, a unit powers up, lit from within by its army's light
  m.emissive.set(check?.color ?? look.color).multiplyScalar(0.06);
  if (glow === 'selected') m.emissive.add(new Color(look.rim).multiplyScalar(0.16));
  // Under the pointer, a unit a player may pick up glows a little
  if (glow === 'hover') m.emissive.add(new Color(look.rim).multiplyScalar(0.2));
  const uniforms = {
    uCore: { value: new Color(check?.core ?? look.core) },
    uRim: { value: new Color(check ? PALETTE.check : look.rim) },
    uRimMix: { value: look.rimMix[glow] },
    uRimPower: { value: look.rimPower },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uCore;
        uniform vec3 uRim;
        uniform float uRimMix;
        uniform float uRimPower;
        varying float vHeight;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Deeper toward the base (heights are in piece units, base at 0)
        diffuseColor.rgb = mix(uCore, diffuseColor.rgb, smoothstep(0.02, 0.5, vHeight));`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float rimK = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), uRimPower);
        outgoingLight = mix(outgoingLight, uRim, uRimMix * rimK);
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'command-body';
  return m;
};

const bodies = new Map<string, MeshStandardMaterial>();
export const bodyMaterial = (side: PieceColor, glow: Glow) => {
  const key = `${side}/${glow}`;
  let m = bodies.get(key);
  if (!m) {
    m = makeBody(side, glow);
    bodies.set(key, m);
  }
  return m;
};

// The unicorn's spiral and the knight's mane are cut in a deep accent, so the
// horn reads as a twisted horn and the knight as a horse, even small.
const accents: Record<PieceColor, MeshStandardMaterial> = {
  white: new MeshStandardMaterial({ color: PALETTE.whiteAccent, roughness: 0.5 }),
  black: new MeshStandardMaterial({ color: PALETTE.blackAccent, roughness: 0.5 }),
};

export const glowOf = ({ inCheck, selected, hovered }: PieceBodyProps): Glow =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';

// The Staunton knight's head is a rounded slab that reads as a tombstone at
// board distance. This one has a clear horse's profile: an arched neck, a
// long muzzle, pricked ears, and a mane cut in the accent down its back.
const extrude = (outline: [number, number][], depth: number, bevel: number) => {
  const shape = new Shape();
  shape.moveTo(...outline[0]);
  for (const p of outline.slice(1)) shape.lineTo(...p);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.85,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  return g;
};

const knightHead = extrude(
  [
    [0.13, 0.13],
    [0.16, 0.2],
    [0.15, 0.27],
    [0.105, 0.33],
    [0.13, 0.38],
    [0.21, 0.415],
    [0.285, 0.45],
    [0.305, 0.495],
    [0.28, 0.53],
    [0.19, 0.565],
    [0.115, 0.625],
    [0.095, 0.685],
    [0.08, 0.75],
    [0.035, 0.705],
    [-0.02, 0.675],
    [-0.08, 0.615],
    [-0.12, 0.525],
    [-0.15, 0.405],
    [-0.165, 0.27],
    [-0.155, 0.13],
  ],
  0.14,
  0.028,
);

const knightMane = extrude(
  [
    [-0.005, 0.7],
    [-0.085, 0.645],
    [-0.14, 0.54],
    [-0.175, 0.41],
    [-0.192, 0.28],
    [-0.15, 0.28],
    [-0.13, 0.405],
    [-0.1, 0.515],
    [-0.05, 0.6],
    [0.02, 0.655],
  ],
  0.07,
  0.012,
);

// Every piece is baked into one body geometry and at most one accent
// geometry, with its origin at the base, so the shader can read a vertex's
// height above the base (for the core gradient) and a piece is two draw calls.
type Placed = [BufferGeometry, [number, number, number]?, number?];

const bake = (parts: Placed[]): BufferGeometry => {
  const geometries = parts.map(([g, at = [0, 0, 0], yaw = 0]) => {
    const copy = (g.index ? g.toNonIndexed() : g.clone()) as BufferGeometry;
    for (const name of Object.keys(copy.attributes)) {
      if (name !== 'position' && name !== 'normal') copy.deleteAttribute(name);
    }
    copy.applyMatrix4(new Matrix4().makeRotationY(yaw).setPosition(...at));
    return copy;
  });
  const merged = mergeGeometries(geometries);
  geometries.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
};

const ring = (n: number, r: number, y: number, yaw = false): Placed[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n;
    return [STAUNTON.rookCrenellation, [Math.cos(a) * r, y, Math.sin(a) * r], yaw ? -a : 0];
  });

const coronet = Array.from({ length: 8 }, (_, i): Placed => {
  const a = (i * 2 * Math.PI) / 8;
  return [STAUNTON.queenCoronet, [Math.cos(a) * 0.15, 0.715, Math.sin(a) * 0.15]];
});

const SETS: Record<PieceType, { body: BufferGeometry; accent?: BufferGeometry }> = {
  [PieceType.Pawn]: { body: bake([[STAUNTON.pawnBody], [STAUNTON.pawnHead, [0, 0.43, 0]]]) },
  [PieceType.Rook]: { body: bake([[STAUNTON.rookBody], ...ring(5, 0.17, 0.585, true)]) },
  [PieceType.Bishop]: {
    body: bake([[STAUNTON.bishopBody], [STAUNTON.bishopFinial, [0, 0.725, 0]]]),
  },
  [PieceType.Knight]: { body: bake([[STAUNTON.knightBase], [knightHead]]), accent: knightMane },
  [PieceType.Unicorn]: {
    body: bake([[STAUNTON.unicornBody], [STAUNTON.unicornHorn, [0, 0.67, 0]]]),
    accent: STAUNTON.unicornSpiral,
  },
  [PieceType.Queen]: {
    body: bake([[STAUNTON.queenBody], ...coronet, [STAUNTON.queenFinial, [0, 0.79, 0]]]),
  },
  [PieceType.King]: {
    body: bake([
      [STAUNTON.kingBody],
      [STAUNTON.kingCrossVertical, [0, 0.8, 0]],
      [STAUNTON.kingCrossHorizontal, [0, 0.815, 0]],
    ]),
  },
};

/** A piece's meshes, painted with `body`, its detail cut in `accent`. */
export const CommandParts = ({
  type,
  body,
  accent,
}: {
  type: PieceType;
  body: Material;
  accent: Material;
}) => {
  const set = SETS[type];
  if (!set) return null;
  return (
    <>
      <mesh geometry={set.body} material={body} />
      {set.accent && <mesh geometry={set.accent} material={accent} />}
    </>
  );
};

// The ring at a piece's base, in its level's colour. Its own shader, so it
// fades out as the piece tips over (a toppled king's ring would otherwise
// stand on edge beside it). Under the pointer or picked up, it widens and
// brightens with the piece.
const FOOTPRINT = { radius: 0.36, width: 0.045, opacity: 0.85 };
const FOOTPRINT_LIT = { radius: 0.41, width: 0.07, opacity: 1 };

const footprintRings = new Map<string, RingGeometry>();
const footprintMaterials = new Map<string, ShaderMaterial>();

const Footprint = ({ level, lit }: { level: number; lit: boolean }) => {
  const f = lit ? FOOTPRINT_LIT : FOOTPRINT;
  const ringKey = `${f.radius}/${f.width}`;
  let ring = footprintRings.get(ringKey);
  if (!ring) {
    ring = new RingGeometry(f.radius - f.width, f.radius, 48).rotateX(-Math.PI / 2);
    footprintRings.set(ringKey, ring);
  }
  const key = `${level}/${lit}`;
  let material = footprintMaterials.get(key);
  if (!material) {
    material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        // Lit, the ring runs hotter: its level's colour toward white
        uColor: {
          value: new Color(LEVEL_COLORS[level] ?? LEVEL_COLORS[0]).lerp(
            new Color('#ffffff'),
            lit ? 0.45 : 0,
          ),
        },
        uOpacity: { value: f.opacity },
      },
      vertexShader: /* glsl */ `
        varying float vUp;
        void main() {
          vUp = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0)).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vUp;
        void main() {
          float a = uOpacity * smoothstep(0.85, 0.98, vUp);
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    footprintMaterials.set(key, material);
  }
  return (
    <mesh
      geometry={ring}
      material={material}
      position={[0, 0.006, 0]}
      renderOrder={LAYER.shadow}
      raycast={noRaycast}
    />
  );
};

/**
 * A piece standing on a thin ring in its level's colour: which platform a
 * piece stands on reads from its footprint, even where the rows of two levels
 * interleave on screen. The ring is part of the body, so it travels with it.
 */
export const PieceBody = (props: PieceBodyProps) => (
  <>
    <Footprint level={props.level ?? 0} lit={props.hovered || props.selected} />
    <CommandParts
      type={props.type}
      body={bodyMaterial(props.color, glowOf(props))}
      accent={accents[props.color]}
    />
  </>
);
