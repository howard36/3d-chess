import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, TorusGeometry, Vector3 } from 'three';
import type { Group, IUniform } from 'three';
import { PieceType } from '../../../engine/pieces';
import { Part, StauntonParts } from '../classic/pieces';
import { STAUNTON } from '../../pieceGeometry';
import { ContactShadow } from '../kit/plates';
import { prefersReducedMotion } from '../../motion';
import type { PieceBodyProps, PieceColor } from '../types';
import { buildKnightHead } from './knight';
import { PAL } from './palette';

// The set: glazed porcelain against ink-blue lacquer, Staunton silhouettes
// with a thin brushed-gold collar on every piece and a gilded horn on the
// unicorn (so it never reads as a bishop, even from above).
//
// Both glazes are physical materials lit by the studio's softboxes, with one
// addition injected into the shader: a soft darkening toward the silhouette
// on porcelain (it holds its edge against the light backdrop) and a cool
// lacquer sheen on ink. The selected piece's material also carries a glint,
// a band of light that sweeps up across the glaze now and then.

type Look = 'idle' | 'hover' | 'selected' | 'check';

interface GlazeUniforms {
  uEdgeColor: IUniform<Color>;
  uEdgeAmount: IUniform<number>;
  uEdgePower: IUniform<number>;
  uRimColor: IUniform<Color>;
  uRimAmount: IUniform<number>;
  uRimPower: IUniform<number>;
  uGlintOrigin: IUniform<Vector3>;
  uGlintDir: IUniform<Vector3>;
  uGlintPos: IUniform<number>;
  uGlintStrength: IUniform<number>;
  uGlintColor: IUniform<Color>;
}

type Glaze = MeshPhysicalMaterial & { userData: { uniforms: GlazeUniforms } };

const glaze = (
  params: ConstructorParameters<typeof MeshPhysicalMaterial>[0],
  u: {
    edge: [string, number, number];
    rim: [string, number, number];
    glint?: [string, number];
  },
): Glaze => {
  const m = new MeshPhysicalMaterial(params) as Glaze;
  const uniforms: GlazeUniforms = {
    uEdgeColor: { value: new Color(u.edge[0]) },
    uEdgeAmount: { value: u.edge[1] },
    uEdgePower: { value: u.edge[2] },
    uRimColor: { value: new Color(u.rim[0]) },
    uRimAmount: { value: u.rim[1] },
    uRimPower: { value: u.rim[2] },
    uGlintOrigin: { value: new Vector3() },
    uGlintDir: { value: new Vector3(0, 1, 0) },
    uGlintPos: { value: -10 },
    uGlintStrength: { value: 0 },
    uGlintColor: { value: new Color(u.glint?.[0] ?? '#ffffff') },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvAtWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vAtWorld;
        uniform vec3 uEdgeColor; uniform float uEdgeAmount; uniform float uEdgePower;
        uniform vec3 uRimColor; uniform float uRimAmount; uniform float uRimPower;
        uniform vec3 uGlintOrigin; uniform vec3 uGlintDir; uniform float uGlintPos;
        uniform float uGlintStrength; uniform vec3 uGlintColor;`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
          float atGrazing = 1.0 - saturate(dot(geometryNormal, geometryViewDir));
          outgoingLight = mix(outgoingLight, uEdgeColor, uEdgeAmount * pow(atGrazing, uEdgePower));
          outgoingLight += uRimColor * uRimAmount * pow(atGrazing, uRimPower);
          float atBand = dot(vAtWorld - uGlintOrigin, uGlintDir) - uGlintPos;
          outgoingLight += uGlintColor * uGlintStrength * exp(-atBand * atBand / 0.004);
        }
        #include <opaque_fragment>`,
      );
  };
  return m;
};

// Check keeps each army's own colour: the king's body stays porcelain or ink,
// lit from its silhouette inward by a crimson rim, over the check marker.
const porcelain = (look: Look) =>
  glaze(
    {
      color: PAL.ivory,
      roughness: 0.34,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.55,
      emissive:
        look === 'check'
          ? '#b0281c'
          : look === 'selected'
            ? '#3a2406'
            : look === 'hover'
              ? '#2a2210'
              : '#000000',
      emissiveIntensity: look === 'check' ? 0.1 : 1,
    },
    {
      // Selected porcelain is gilded at its silhouette: a warm light edge
      // would vanish against the light acrylic, a bronze-gold one reads
      edge:
        look === 'selected'
          ? [PAL.gilt, 0.8, 1.7]
          : [PAL.ivoryEdge, look === 'check' ? 0.2 : 0.5, 2.2],
      rim:
        look === 'check'
          ? [PAL.crimson, 0.95, 2]
          : look === 'selected'
            ? [PAL.spot, 0.3, 2.6]
            : ['#ffffff', 0, 1],
      glint: ['#ffc873', 0],
    },
  );

const lacquer = (look: Look) =>
  glaze(
    {
      color: PAL.ink,
      roughness: 0.3,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.05,
      emissive: look === 'check' ? '#1e0306' : look === 'hover' ? '#101a33' : '#000000',
      emissiveIntensity: 1,
    },
    {
      edge: ['#000000', 0, 1],
      rim:
        look === 'check'
          ? ['#ff2b35', 1, 2.7]
          : look === 'selected'
            ? [PAL.spot, 0.95, 2.6]
            : [PAL.inkRim, 0.16, 3],
      glint: ['#e4ecff', 0],
    },
  );

const glazes = new Map<string, Glaze>();
const glazeFor = (color: PieceColor, look: Look): Glaze => {
  const key = `${color}/${look}`;
  let m = glazes.get(key);
  if (!m) {
    m = color === 'white' ? porcelain(look) : lacquer(look);
    glazes.set(key, m);
  }
  return m;
};

const gold = new MeshStandardMaterial({
  color: PAL.gold,
  metalness: 1,
  roughness: 0.3,
  envMapIntensity: 1.1,
});
const grooves = {
  white: new MeshStandardMaterial({ color: PAL.ivoryGroove, roughness: 0.6 }),
  black: new MeshStandardMaterial({ color: PAL.inkGroove, roughness: 0.5 }),
};

// Where each piece's collar is (height, radius), for the gold band
const COLLAR: Record<PieceType, [number, number]> = {
  [PieceType.Pawn]: [0.312, 0.122],
  [PieceType.Rook]: [0.455, 0.19],
  [PieceType.Bishop]: [0.432, 0.132],
  [PieceType.Knight]: [0.108, 0.17],
  [PieceType.Unicorn]: [0.412, 0.122],
  [PieceType.Queen]: [0.502, 0.152],
  [PieceType.King]: [0.542, 0.162],
};
const knightHead = buildKnightHead();
const bands = new Map(
  Object.entries(COLLAR).map(([type, [, r]]) => [
    type,
    new TorusGeometry(r + 0.003, 0.011, 6, 36).rotateX(Math.PI / 2),
  ]),
);

/** The piece's meshes: Staunton parts, the unicorn's horn gilded, a gold collar. */
const Parts = ({
  type,
  color,
  material,
}: {
  type: PieceType;
  color: PieceColor;
  material: Glaze;
}) => (
  <>
    {type === PieceType.Unicorn ? (
      <>
        <Part geometry={STAUNTON.unicornBody} mat={material} />
        <Part position={[0, 0.67, 0]} geometry={STAUNTON.unicornHorn} mat={gold} />
        <Part geometry={STAUNTON.unicornSpiral} mat={material} />
      </>
    ) : type === PieceType.Knight ? (
      <>
        <Part geometry={STAUNTON.knightBase} mat={material} />
        <Part geometry={knightHead} mat={material} />
      </>
    ) : (
      <StauntonParts type={type} material={material} groove={grooves[color]} />
    )}
    <mesh position={[0, COLLAR[type][0], 0]} geometry={bands.get(type)} material={gold} />
  </>
);

// --- Motion of a picked-up piece ------------------------------------------------

const LIFT_SELECTED = 0.27;
const LIFT_HOVER = 0.06;
const SPIN = 0.5; // radians a second, a slow turntable
const GLINT_PERIOD = 3.2;
const GLINT_SWEEP = 0.9;
const TAU = Math.PI * 2;

const up = new Vector3(0, 1, 0);
const right = new Vector3();
const origin = new Vector3();

/** A piece on its contact shadow; it rises, turns and catches the light when picked up. */
export const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const look: Look = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'idle';
  const material = glazeFor(color, look);
  const lift = useRef<Group>(null);
  const shadow = useRef<Group>(null);
  const motion = useRef({ y: 0, v: 0, spin: 0, clock: 0 });
  const invalidate = useThree((s) => s.invalidate);

  useFrame((state, delta) => {
    const g = lift.current;
    const s = shadow.current;
    if (!g || !s) return;
    const m = motion.current;
    const goal = selected ? LIFT_SELECTED : hovered ? LIFT_HOVER : 0;
    const resting = Math.abs(m.y - goal) < 1e-4 && Math.abs(m.v) < 1e-4 && m.spin === 0;
    if (resting && !selected) return;
    const dt = Math.min(delta, 1 / 30);
    m.clock += dt;
    // A spring with a little overshoot: the piece pops up, then settles
    m.v += (220 * (goal - m.y) - 17 * m.v) * dt;
    m.y += m.v * dt;
    if (Math.abs(m.y - goal) < 1e-4 && Math.abs(m.v) < 1e-3) {
      m.y = goal;
      m.v = 0;
    }
    // Picked up it floats and turns slowly, unless the player asked for less motion
    const still = prefersReducedMotion();
    const bob = selected && !still ? Math.sin(m.clock * 2.1) * 0.014 : 0;
    if (selected && !still) {
      m.spin = (m.spin + dt * SPIN) % TAU;
    } else if (m.spin !== 0) {
      // Turn back to where it stood, the short way round
      const back = m.spin > Math.PI ? TAU - m.spin : -m.spin;
      const step = Math.sign(back) * Math.min(Math.abs(back), dt * 3);
      m.spin = Math.abs(back) < 1e-3 ? 0 : (m.spin + step + TAU) % TAU;
    }
    g.position.y = m.y + bob;
    g.rotation.y = m.spin;
    // The shadow stays on the platform, tightening as the piece rises
    s.scale.setScalar(1 - Math.min(m.y, 0.3) * 0.9);

    if (selected && !still) {
      const u = material.userData.uniforms;
      g.getWorldPosition(origin);
      u.uGlintOrigin.value.copy(origin);
      // A band leaning with the camera's right hand, sweeping upward
      right.setFromMatrixColumn(state.camera.matrixWorld, 0).setY(0).normalize();
      u.uGlintDir.value.copy(up).addScaledVector(right, 0.45).normalize();
      const phase = m.clock % GLINT_PERIOD;
      const k = phase / GLINT_SWEEP;
      u.uGlintPos.value = -0.15 + k * 0.95;
      u.uGlintStrength.value =
        k < 1 ? Math.sin(k * Math.PI) * (color === 'white' ? 0.55 : 0.75) : 0;
    }
    if (!(still && m.y === goal && m.spin === 0)) invalidate();
  });

  return (
    <>
      <group ref={shadow}>
        <ContactShadow radius={0.36} opacity={0.36} color="#2b241c" />
      </group>
      <group ref={lift}>
        <Parts type={type} color={color} material={material} />
      </group>
    </>
  );
};

/** The piece's meshes alone, in its resting glaze (for effects that stand in for a piece). */
export const StillPiece = ({ type, color }: { type: PieceType; color: PieceColor }) => (
  <Parts type={type} color={color} material={glazeFor(color, 'idle')} />
);

/** The resting glaze of an army, for shards and the like (shared: never fade it). */
export const restingGlaze = (color: PieceColor) => glazeFor(color, 'idle');
