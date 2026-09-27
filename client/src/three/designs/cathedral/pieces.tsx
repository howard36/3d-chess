import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MeshBasicMaterial, MeshStandardMaterial, RingGeometry } from 'three';
import type { BufferGeometry } from 'three';
import type { Group } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { ContactShadow, LevelFootprint } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { ALABASTER, CANDLE, EBONY, GILT, LEVEL, PIECE_GILT, RUBY, SUNLIGHT } from './palette';

// The armies: the shared Staunton set carved in warm alabaster and in
// ebony, with gilt inlay (the knight's mane, the bishop's cut, the unicorn's
// spiral, the queen's pearls, the king's cross), bright on alabaster and
// old gold on ebony; the rook's hollow is carved from its own stone. Each
// piece stands on a thin band of jewel glass in the colour of its level.
// Both armies are drawn by candlelight: a warm rim of light runs round every
// edge that turns away from the viewer, so the ebony army reads as carved
// wood, never as a silhouette, even against the dark nave. Alabaster glows a
// little from within, as thin stone does in candlelight; ebony shows its
// grain in fine lighter streaks. In check, a king takes a ruby rim, not a
// ruby coat: its army stays plain to see.

export type PieceState = 'rest' | 'hovered' | 'selected' | 'check';

interface Rim {
  color: string;
  power: number;
  strength: number;
}

/**
 * Adds a view-dependent rim of light to a standard material (and, for
 * wood, a turned grain), keeping everything else about it physical.
 */
const withRim = (m: MeshStandardMaterial, rim: Rim, grain = 0) => {
  const uniforms = {
    uRimColor: { value: new Color(rim.color) },
    uRimPower: { value: rim.power },
    uRimStrength: { value: rim.strength },
    uGrain: { value: grain },
  };
  m.userData.rim = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRimColor;
        uniform float uRimPower;
        uniform float uRimStrength;
        uniform float uGrain;
        varying vec3 vObj;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uGrain > 0.0) {
          // Turned wood: fine streaks running up the piece, wandering a little
          float ang = atan(vObj.z, vObj.x);
          float g = sin(ang * 11.0 + vObj.y * 9.0 + 2.2 * sin(vObj.y * 17.0 + ang * 3.0));
          float s = sin(ang * 29.0 - vObj.y * 21.0);
          diffuseColor.rgb *= 1.0 + uGrain * (smoothstep(0.55, 1.0, g) * 0.9 + smoothstep(0.7, 1.0, s) * 0.4);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRimColor * pow(rimF, uRimPower) * uRimStrength;`,
      );
  };
  m.customProgramCacheKey = () => 'vitrail-rim';
  return m;
};

// Per army and state: what the state adds to the body
const STATE_GLOW: Record<PieceState, { emissive: string; rim: string; boost: number }> = {
  rest: { emissive: '#000000', rim: CANDLE, boost: 0 },
  // A piece the player may pick up catches a little more candlelight
  hovered: { emissive: '#1c1206', rim: '#ffd08f', boost: 0.6 },
  // In the shaft of sunlight
  selected: { emissive: '#140c03', rim: SUNLIGHT, boost: 0.5 },
  // A thinner rim than at rest, in ruby: the king stays its army's colour
  check: { emissive: '#000000', rim: RUBY, boost: -0.25 },
};

const bodies = new Map<string, MeshStandardMaterial>();
/** Alabaster or ebony, shared per army and state. */
export const bodyMaterial = (color: PieceColor, state: PieceState = 'rest') => {
  const key = `${color}/${state}`;
  let m = bodies.get(key);
  if (!m) {
    const s = STATE_GLOW[state];
    if (color === 'white') {
      m = withRim(
        new MeshStandardMaterial({
          color: ALABASTER,
          roughness: 0.42,
          metalness: 0,
          envMapIntensity: 0.55,
        }),
        { color: s.rim, power: 2.4, strength: 0.28 + s.boost * 0.5 },
      );
      // Light held inside the stone
      m.emissive.set('#2b1f12').add(new Color(s.emissive));
    } else {
      m = withRim(
        new MeshStandardMaterial({
          color: EBONY,
          roughness: 0.34,
          metalness: 0,
          envMapIntensity: 1.1,
        }),
        { color: s.rim, power: 3, strength: 0.42 + s.boost * 0.6 },
        0.55,
      );
      m.emissive.set(s.emissive);
    }
    bodies.set(key, m);
  }
  return m;
};

/**
 * Gilt: bright on alabaster, an older, darker gold on ebony (a bright gilt
 * hollow made a black rook read as a gold coin from above).
 */
export const giltMaterials: Record<PieceColor, MeshStandardMaterial> = {
  white: withRim(
    new MeshStandardMaterial({
      color: PIECE_GILT,
      roughness: 0.3,
      metalness: 1,
      envMapIntensity: 1.3,
    }),
    { color: CANDLE, power: 2.5, strength: 0.35 },
  ),
  black: withRim(
    new MeshStandardMaterial({
      color: '#8c6630',
      roughness: 0.38,
      metalness: 1,
      envMapIntensity: 0.85,
    }),
    { color: CANDLE, power: 2.8, strength: 0.25 },
  ),
};

/**
 * A rook's accent is its whole hollow as well as its sills: carved from its
 * own army's stone (honey-veined alabaster, a warmer wood on ebony) rather
 * than gilt, so that from above a rook reads as its army, not as gold.
 */
export const carvedAccents: Record<PieceColor, MeshStandardMaterial> = {
  white: withRim(
    new MeshStandardMaterial({ color: '#d6c09a', roughness: 0.48, envMapIntensity: 0.55 }),
    { color: CANDLE, power: 2.4, strength: 0.3 },
  ),
  black: withRim(
    new MeshStandardMaterial({ color: '#4a3126', roughness: 0.36, envMapIntensity: 1.1 }),
    { color: CANDLE, power: 3, strength: 0.42 },
    0.55,
  ),
};

/** The accent material of a piece: gilt, but for the rook's carved hollow. */
export const accentMaterial = (type: PieceType, color: PieceColor) =>
  type === PieceType.Rook ? carvedAccents[color] : giltMaterials[color];

// --- The level ring ---------------------------------------------------------------

const RING_RADIUS = 0.36;
const RING_WIDTH = 0.028;
const RING_GAP = (18 * Math.PI) / 180;
const rings = new Map<number, BufferGeometry>();

/**
 * The ring round a piece's base on the glass, in its level's colour and
 * broken into as many arcs as the level's number (A whole, B in two, ... E
 * in five), so the level can be told without its colour.
 */
export const levelRing = (level: number): BufferGeometry => {
  let g = rings.get(level);
  if (!g) {
    const arcs = level + 1;
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < arcs; i++) {
      const span = (Math.PI * 2) / arcs;
      const gap = arcs === 1 ? 0 : RING_GAP;
      parts.push(
        new RingGeometry(
          RING_RADIUS - RING_WIDTH,
          RING_RADIUS,
          Math.max(6, Math.round(48 / arcs)),
          1,
          Math.PI / 2 + i * span + gap / 2,
          span - gap,
        ),
      );
    }
    g = parts.length === 1 ? parts[0] : mergeGeometries(parts)!;
    if (parts.length > 1) parts.forEach((p) => p.dispose());
    g.rotateX(-Math.PI / 2);
    rings.set(level, g);
  }
  return g;
};

/** Quiet: thinner and fainter than any play mark. */
const ringMaterials = LEVEL.map(
  (c) =>
    new MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
);

/** The foot band: jewel glass in the level's colour, glowing a little so it holds in shade. */
export const footMaterials = LEVEL.map((c) => {
  const color = new Color(c);
  return new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.55,
    roughness: 0.18,
    metalness: 0,
  });
});

/**
 * Keeps its children on the floor while the piece above them is lifted
 * (Board wraps a body in the kit's Lift): it reads how far the Lift has
 * raised the body and moves back down by as much. It mounts a frame late so
 * its frame callback runs after the Lift's and reads this frame's height.
 */
const OnFloor = ({ children }: { children: React.ReactNode }) => {
  const [late, setLate] = useState(false);
  useEffect(() => setLate(true), []);
  const group = useRef<Group>(null);
  return (
    <group ref={group}>
      {children}
      {late && <FollowFloor group={group} />}
    </group>
  );
};

const FollowFloor = ({ group }: { group: React.RefObject<Group | null> }) => {
  useFrame(() => {
    const g = group.current;
    // Only a Lift's rise is undone (it tags its group); any other parent is left alone
    const parent = g?.parent;
    const lift = parent?.userData.lift ? parent.position.y : 0;
    if (g && g.position.y !== -lift) g.position.y = -lift;
  });
  return null;
};

export const pieceState = ({ inCheck, selected, hovered }: PieceBodyProps): PieceState =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hovered' : 'rest';

/**
 * A piece on its pane: a soft shadow and a thin, quiet ring of its level's
 * jewel colour on the glass (both stay on the floor when the piece rises),
 * a gilt ring round it while the pointer offers it to be picked up, and the
 * piece above them on its band of jewel glass.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const level = props.level ?? 0;
  return (
    <>
      <OnFloor>
        <ContactShadow radius={0.36} opacity={0.5} color="#050308" />
        <mesh
          geometry={levelRing(level)}
          material={ringMaterials[level]}
          position={[0, 0.006, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
        {/* A piece the player may pick up: a gilt ring on the glass, the mark of something to act on */}
        {props.hovered && !props.selected && (
          <LevelFootprint color={GILT} radius={0.47} width={0.035} opacity={0.95} />
        )}
      </OnFloor>
      <ChessPiece
        type={props.type}
        parts={{
          body: bodyMaterial(props.color, pieceState(props)),
          accent: accentMaterial(props.type, props.color),
          foot: footMaterials[level],
        }}
      />
    </>
  );
};
