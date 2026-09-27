import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, MeshStandardMaterial, RingGeometry, ShaderMaterial } from 'three';
import type { Group, IUniform, Material } from 'three';
import { ChessPiece } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { LEVELS } from './palette';
import { makeStone } from './stone';
import type { StoneKind } from './stone';

// The armies: the shared Staunton set carved in Carrara marble and in
// basalt, the details that name a piece (the bishop's cut, the knight's
// mane, the unicorn's spiral, the queen's pearls, the king's cross, the
// rook's crenels) inlaid in a second stone of the same family, and a foot
// band of brass anodised in the colour of the piece's level. Each piece
// stands on a soft contact shadow and a thin inlay ring of its level's
// colour.
//
// Selected, a piece becomes the exhibit: the spotlight strikes up over it
// (see markers.tsx), its rim and upward faces warm in the light (never its
// body: the army's value is sacred), and it turns once on its plinth, as a
// sculpture on a gallery turntable, then rests facing the way it stood.
// Hovered, its rim warms a little in anticipation.

/**
 * The selection's spotlight on the piece, 0 (off) to 1: one uniform shared
 * by every selected-state material (only one piece is selected at a time),
 * struck up by the Selection marker when it mounts.
 */
export const SPOTLIGHT: IUniform<number> = { value: 0 };
const HOVER_SPOT = 0.45;

type State = 'rest' | 'hover' | 'selected' | 'check';

const BODY: Record<PieceColor, StoneKind> = { white: 'marble', black: 'basalt' };
const ACCENT: Record<PieceColor, StoneKind> = { white: 'bardiglio', black: 'graphite' };

const cache = new Map<string, MeshStandardMaterial>();
const stone = (kind: StoneKind, state: State) => {
  const key = `${kind}/${state}`;
  let m = cache.get(key);
  if (!m) {
    m = makeStone(kind, {
      spot: state === 'selected' ? SPOTLIGHT : { value: state === 'hover' ? HOVER_SPOT : 0 },
      check: state === 'check',
    });
    cache.set(key, m);
  }
  return m;
};

/** Anodised brass in each level's colour, glowing a little so it holds in shade. */
export const FEET = LEVELS.map((c) => {
  const color = new Color(c);
  return new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.28,
    metalness: 0.2,
    roughness: 0.32,
  });
});

/** The materials of one piece of one army in one state. */
export const pieceMaterials = (
  color: PieceColor,
  state: State,
  level: number,
): { body: Material; accent: Material; foot: Material } => ({
  body: stone(BODY[color], state),
  accent: stone(ACCENT[color], state),
  foot: FEET[level] ?? FEET[0],
});

// The level's ring round a piece's base: thin and unlit, quieter than any
// gameplay mark, and a little stronger from high above, where it is what
// tells the levels' pieces apart
const FOOTPRINT = new RingGeometry(0.3, 0.337, 48).rotateX(-Math.PI / 2);
const footprints = LEVELS.map(
  (c) =>
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: { uColor: { value: new Color(c) } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec3 vWorld;
        void main() {
          float steep = smoothstep(0.6, 0.95, normalize(cameraPosition - vWorld).y);
          gl_FragColor = vec4(uColor, mix(0.45, 0.8, steep));
          #include <colorspace_fragment>
        }`,
    }),
);

// One slow turn on the turntable when a piece is picked up, then rest
const TURN_MS = 4800;
const TAU = Math.PI * 2;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A piece standing on its level: contact shadow, level ring, and the carved
 * piece on a turntable that turns once when it is selected.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const { type, color, selected, hovered, inCheck, level = 0 } = props;
  const turn = useRef<Group>(null);
  const ground = useRef<Group>(null);
  const turned = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    // The shadow and the level ring stay on the floor while Board lifts the piece
    const lift = ground.current?.parent;
    if (ground.current && lift?.userData.lift) ground.current.position.y = -lift.position.y;
    const g = turn.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 20) * 1000;
    if (selected && turned.current < TURN_MS) {
      turned.current = Math.min(turned.current + dt, TURN_MS);
      g.rotation.y = (TAU * easeInOut(turned.current / TURN_MS)) % TAU;
      invalidate();
    } else if (!selected) {
      turned.current = 0;
      if (g.rotation.y !== 0) {
        // Let go mid-turn: turn back the short way, easing in to rest
        const r = g.rotation.y > Math.PI ? g.rotation.y - TAU : g.rotation.y;
        const next = r * Math.max(0, 1 - (dt / 1000) * 7);
        g.rotation.y = Math.abs(next) < 1e-3 ? 0 : (next + TAU) % TAU;
        invalidate();
      }
    }
  });
  const state: State = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'rest';
  const mats = pieceMaterials(color, state, level);
  return (
    <>
      <group ref={ground}>
        <ContactShadow radius={0.37} opacity={0.55} />
        <mesh
          geometry={FOOTPRINT}
          material={footprints[level] ?? footprints[0]}
          position={[0, 0.006, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
      </group>
      <group ref={turn}>
        <ChessPiece type={type} parts={mats} />
      </group>
    </>
  );
};
