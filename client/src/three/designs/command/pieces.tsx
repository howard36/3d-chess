import { Color, ExtrudeGeometry, MeshStandardMaterial, Shape } from 'three';
import type { Material } from 'three';
import { PieceType } from '../../../engine/pieces';
import { STAUNTON } from '../../pieceGeometry';
import { StauntonParts } from '../classic/pieces';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { PALETTE } from './shared';

// The armies are solid, matte units (never see-through): ice white against
// amber, each with a fresnel rim of its own light, so a silhouette stays crisp
// against the dark room and through tinted glass from any angle. The rim is
// computed from the view, so it wraps every piece the same way from both
// seats. Materials are shared by every piece of an army and state; anything
// that fades one piece clones first (the kit's GhostPiece does).

export type Glow = 'none' | 'hover' | 'selected' | 'check';

interface Look {
  color: string;
  rim: string;
  roughness: number;
  metalness: number;
  /** Rim strength by state. */
  rimGain: Record<Glow, number>;
  rimPower: number;
  /** A little light of its own, so the shadowed side never goes dead. */
  selfLight: number;
}

const LOOK: Record<PieceColor, Look> = {
  white: {
    color: PALETTE.white,
    rim: PALETTE.whiteRim,
    roughness: 0.36,
    metalness: 0.02,
    rimGain: { none: 0.85, hover: 1.3, selected: 2.3, check: 2.2 },
    rimPower: 2.6,
    selfLight: 0.06,
  },
  black: {
    color: PALETTE.black,
    rim: PALETTE.blackRim,
    roughness: 0.34,
    metalness: 0.05,
    rimGain: { none: 0.95, hover: 1.4, selected: 2.3, check: 2.2 },
    rimPower: 2.2,
    selfLight: 0.08,
  },
};

const makeBody = (side: PieceColor, glow: Glow) => {
  const look = LOOK[side];
  const m = new MeshStandardMaterial({
    color: look.color,
    roughness: look.roughness,
    metalness: look.metalness,
    envMapIntensity: 0.8,
  });
  const rimColor = glow === 'check' ? PALETTE.check : look.rim;
  if (glow === 'check') {
    // A king in check warms red through, and keeps its army's colour
    m.emissive.set(PALETTE.check).multiplyScalar(0.16);
  } else {
    m.emissive.set(look.color).multiplyScalar(look.selfLight);
    // Picked up, a unit powers up: lit from within by its own light
    if (glow === 'selected') m.emissive.add(new Color(look.rim).multiplyScalar(0.14));
  }
  const rim = { value: new Color(rimColor).multiplyScalar(look.rimGain[glow]) };
  const power = { value: look.rimPower };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rim;
    shader.uniforms.uRimPower = power;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRim;\nuniform float uRimPower;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));
        totalEmissiveRadiance += uRim * pow(rimK, uRimPower);`,
      );
  };
  m.customProgramCacheKey = () => 'command-rim';
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

// The bishop's mitre slot and the unicorn's spiral are cut in a deep accent,
// so the horn reads as a twisted horn and the mitre as split, even small.
const accents: Record<PieceColor, MeshStandardMaterial> = {
  white: new MeshStandardMaterial({ color: PALETTE.whiteAccent, roughness: 0.6 }),
  black: new MeshStandardMaterial({ color: PALETTE.blackAccent, roughness: 0.6 }),
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
  if (type === PieceType.Unicorn) {
    return (
      <>
        <mesh geometry={STAUNTON.unicornBody} material={body} />
        <mesh position={[0, 0.67, 0]} geometry={STAUNTON.unicornHorn} material={body} />
        <mesh geometry={STAUNTON.unicornSpiral} material={accent} />
      </>
    );
  }
  if (type === PieceType.Knight) {
    return (
      <>
        <mesh geometry={STAUNTON.knightBase} material={body} />
        <mesh geometry={knightHead} material={body} />
        <mesh geometry={knightMane} material={accent} />
      </>
    );
  }
  return <StauntonParts type={type} material={body} groove={accent} />;
};

export const accentMaterial = (side: PieceColor) => accents[side];

/** A piece standing on its contact shadow (part of the body, so it moves and fades with it). */
export const PieceBody = (props: PieceBodyProps) => (
  <>
    <ContactShadow radius={0.37} opacity={0.5} color="#01040a" />
    <CommandParts
      type={props.type}
      body={bodyMaterial(props.color, glowOf(props))}
      accent={accents[props.color]}
    />
  </>
);
