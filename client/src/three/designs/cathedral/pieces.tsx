import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CircleGeometry,
  Color,
  Euler,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import type { Camera, Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { FLOOR_DECAL } from '../kit/motion';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { ALABASTER, CANDLE, EBONY, LEVEL, PIECE_GILT, RUBY, SUNLIGHT } from './palette';

// The armies: the shared Staunton set carved in warm alabaster and in
// ebony, with gilt inlay (the knight's mane, the bishop's cut, the unicorn's
// spiral, the queen's pearls, the king's cross), bright on alabaster and
// old gold on ebony; the rook's hollow is carved from its own stone. Each
// piece stands on a thin band of jewel glass in the colour of its level.
// Both armies are drawn by candlelight: a warm rim of light runs round every
// edge that turns away from the viewer, so the ebony army reads as carved
// wood, never as a silhouette, even against the dark nave. Alabaster glows a
// little from within, as thin stone does in candlelight; ebony shows its
// grain in fine lighter streaks. No state ever re-tints a body: the held
// piece is lit from above and keeps a thin rim, and a checked king blushes
// ruby only at its head.

export type PieceState = 'rest' | 'hovered' | 'selected' | 'check';

interface Rim {
  color: string;
  power: number;
  strength: number;
  /**
   * A second rim for the head only (object-space heights `from`–`to`, piece
   * units): a checked king blushes ruby at the crown while its body keeps
   * its army's candle rim.
   */
  head?: { color: string; power: number; strength: number; from: number; to: number };
  /** Sunlight on the upward faces (crown and shoulders): the held piece in its shaft. */
  sun?: number;
}

/**
 * Adds a view-dependent rim of light to a standard material (and, for
 * wood, a turned grain), keeping everything else about it physical. The rim
 * and the sunlit top only ever touch a piece's edges and upper faces; the
 * body keeps its army's value in every state.
 */
const withRim = (m: MeshStandardMaterial, rim: Rim, grain = 0) => {
  const uniforms = {
    uRimColor: { value: new Color(rim.color) },
    uRimPower: { value: rim.power },
    uRimStrength: { value: rim.strength },
    uHeadColor: { value: new Color(rim.head?.color ?? rim.color) },
    uHeadPower: { value: rim.head?.power ?? rim.power },
    uHeadStrength: { value: rim.head?.strength ?? 0 },
    uHeadFrom: { value: rim.head?.from ?? 0 },
    uHeadTo: { value: rim.head?.to ?? 0 },
    uSun: { value: new Color(SUNLIGHT) },
    uSunStrength: { value: rim.sun ?? 0 },
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
        uniform vec3 uHeadColor;
        uniform float uHeadPower;
        uniform float uHeadStrength;
        uniform float uHeadFrom;
        uniform float uHeadTo;
        uniform vec3 uSun;
        uniform float uSunStrength;
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
        vec3 nV = normalize(normal);
        float rimF = 1.0 - clamp(dot(nV, normalize(vViewPosition)), 0.0, 1.0);
        float head = uHeadTo > uHeadFrom ? smoothstep(uHeadFrom, uHeadTo, vObj.y) : 0.0;
        totalEmissiveRadiance += mix(
          uRimColor * pow(rimF, uRimPower) * uRimStrength,
          uHeadColor * pow(rimF, uHeadPower) * uHeadStrength,
          head);
        // Light from straight above, on the faces that look up
        vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        // (weaker on faces turned to the camera: seen from straight above,
        // every face looks up, and a dark piece would go grey)
        float toEye = clamp(dot(nV, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uSun * pow(max(dot(nV, upV), 0.0), 2.0) * uSunStrength
          * (1.0 - 0.75 * toEye * toEye);`,
      );
  };
  m.customProgramCacheKey = () => 'vitrail-rim-2';
  return m;
};

/** The king's height (piece units), for the ruby blush on its head in check. */
const KING_TOP = 0.87;
const RUBY_HEAD = {
  color: RUBY,
  power: 4.5,
  strength: 0.3,
  // The top third: the crown and cross, never the body
  from: KING_TOP * 0.62,
  to: KING_TOP * 0.78,
};

// Per army and state. Hover warms the candle rim a little; the held piece
// keeps a thin rim (power 4 and up: at game size a softer rim covers a
// small piece and turns ebony gold) and is lit from above instead; a checked
// king keeps its army's rim on the body and blushes ruby only at the head.
const STATES: Record<PieceColor, Record<PieceState, Rim>> = {
  white: {
    rest: { color: CANDLE, power: 2.4, strength: 0.28 },
    hovered: { color: '#ffd08f', power: 2.4, strength: 0.46 },
    selected: { color: SUNLIGHT, power: 4, strength: 0.3, sun: 0.22 },
    check: { color: CANDLE, power: 2.4, strength: 0.28, head: RUBY_HEAD },
  },
  black: {
    rest: { color: CANDLE, power: 3, strength: 0.42 },
    hovered: { color: '#ffc98a', power: 3, strength: 0.56 },
    selected: { color: SUNLIGHT, power: 4.5, strength: 0.45, sun: 0.35 },
    check: { color: CANDLE, power: 3, strength: 0.42, head: RUBY_HEAD },
  },
};

const bodies = new Map<string, MeshStandardMaterial>();
/** Alabaster or ebony, shared per army and state. */
export const bodyMaterial = (color: PieceColor, state: PieceState = 'rest') => {
  const key = `${color}/${state}`;
  let m = bodies.get(key);
  if (!m) {
    const rim = STATES[color][state];
    if (color === 'white') {
      m = withRim(
        new MeshStandardMaterial({
          color: ALABASTER,
          roughness: 0.42,
          metalness: 0,
          envMapIntensity: 0.55,
        }),
        rim,
      );
      // Light held inside the stone
      m.emissive.set('#2b1f12');
    } else {
      m = withRim(
        new MeshStandardMaterial({
          color: EBONY,
          roughness: 0.34,
          metalness: 0,
          envMapIntensity: 1.1,
        }),
        rim,
        0.55,
      );
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

// --- The level cue on the glass ------------------------------------------------------

const RING_RADIUS = 0.36;
const RING_WIDTH = 0.026;
const ring = new RingGeometry(RING_RADIUS - RING_WIDTH, RING_RADIUS, 48).rotateX(-Math.PI / 2);
const hoverRing = new RingGeometry(0.39, 0.47, 48).rotateX(-Math.PI / 2);
const BEAD = 0.042;
const bead = new CircleGeometry(BEAD, 12).rotateX(-Math.PI / 2);
/** Angle between neighbouring beads on the ring. */
const BEAD_STEP = (BEAD * 2.6) / RING_RADIUS;

const glassMaterial = (color: string, opacity: number) =>
  new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

/** Quiet: a faint ring, thinner and fainter than any play mark. */
const ringMaterials = LEVEL.map((c) => glassMaterial(c, 0.35));
/** Beads of solid jewel glass: countable where a colour alone is not. */
const beadMaterials = LEVEL.map((c) => glassMaterial(c, 1));
/** Under the pointer: the level's own ring, wider and brighter (gilt means "go here"). */
const hoverMaterials = LEVEL.map((c) => glassMaterial(c, 1));

const toViewer = new Vector3();
const parentTurn = new Quaternion();
const turn = new Euler();

/**
 * Toward the viewer along the board: the camera's view direction reversed
 * and laid flat, one heading for every piece (not the way to the camera
 * from each piece, which from above fans out round the board). Looking
 * straight down that has no horizontal part, so the bottom of the screen
 * stands in for it.
 */
const towardViewer = (camera: Camera, out: Vector3) => {
  camera.getWorldDirection(out).negate();
  out.y = 0;
  if (out.lengthSq() < 1e-10) {
    out.set(0, -1, 0).applyQuaternion(camera.quaternion);
    out.y = 0;
  }
  return out;
};

/**
 * The square a piece stands on, outlined faintly in its level's colour and
 * shown only from high above, where the levels' grids thin to dots and
 * perspective would otherwise shift a lower piece onto the top level's
 * lines. A square annulus: a four-sided ring turned to lie square.
 */
const SQUARE_HALF = 0.52;
const SQUARE_LINE = 0.028;
const square = new RingGeometry(
  (SQUARE_HALF - SQUARE_LINE) * Math.SQRT2,
  SQUARE_HALF * Math.SQRT2,
  4,
  1,
  Math.PI / 4,
).rotateX(-Math.PI / 2);
const squareMaterials = LEVEL.map((c) => glassMaterial(c, 0));

/** How strongly the square footprints show (0–1), set from the camera's elevation. */
export const setFootprintStrength = (k: number) => {
  for (const m of squareMaterials) {
    m.opacity = 0.42 * k;
    m.visible = k > 0.01;
  }
};

/**
 * The level's number as beads on the ring (one on A, five on E), a short
 * row turned toward the viewer along the camera's heading, so it lies in
 * front of the piece from any side, and every piece's row lies the same way
 * from above; and, from high above, the piece's square, kept square to the
 * board whichever way the piece faces.
 */
const LevelBeads = ({ level }: { level: number }) => {
  const group = useRef<Group>(null);
  const squared = useRef<Group>(null);
  // Frames come when the camera moves (the controls ask for one), so the
  // rows follow it without keeping the scene rendering
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g?.parent) return;
    towardViewer(camera, toViewer);
    g.parent.getWorldQuaternion(parentTurn);
    turn.setFromQuaternion(parentTurn, 'YXZ');
    g.rotation.y = Math.atan2(toViewer.x, toViewer.z) - turn.y;
    if (squared.current) squared.current.rotation.y = -turn.y;
  });
  const n = level + 1;
  return (
    <>
      <group ref={squared}>
        <mesh
          userData={FLOOR_DECAL}
          geometry={square}
          material={squareMaterials[level]}
          position={[0, 0.005, 0]}
          renderOrder={LAYER.shadow + 0.1}
          raycast={noRaycast}
        />
      </group>
      <group ref={group}>
        {Array.from({ length: n }, (_, i) => {
          const a = (i - (n - 1) / 2) * BEAD_STEP;
          return (
            <mesh
              key={i}
              userData={FLOOR_DECAL}
              geometry={bead}
              material={beadMaterials[level]}
              position={[
                Math.sin(a) * (RING_RADIUS - RING_WIDTH / 2),
                0.007,
                Math.cos(a) * (RING_RADIUS - RING_WIDTH / 2),
              ]}
              renderOrder={LAYER.shadow + 0.2}
              raycast={noRaycast}
            />
          );
        })}
      </group>
    </>
  );
};

/** The foot band: jewel glass in the level's colour, glowing a little so it holds in shade. */
export const footMaterials = LEVEL.map((c) => {
  const color = new Color(c);
  return new MeshStandardMaterial({
    color,
    emissive: color,
    // Low enough that the hue survives (D's violet and E's rose stay apart)
    emissiveIntensity: 0.35,
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
 * A piece on its pane: a soft shadow, a faint ring of its level's jewel
 * colour on the glass with the level's number in beads (all three stay on
 * the floor when the piece rises), the ring swelling while the pointer
 * offers the piece to be picked up, and the piece above them on its band of
 * jewel glass.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const level = props.level ?? 0;
  return (
    <>
      <OnFloor>
        <ContactShadow radius={0.36} opacity={0.5} color="#050308" />
        <mesh
          userData={FLOOR_DECAL}
          geometry={ring}
          material={ringMaterials[level]}
          position={[0, 0.006, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
        <LevelBeads level={level} />
        {props.hovered && !props.selected && (
          <mesh
            userData={FLOOR_DECAL}
            geometry={hoverRing}
            material={hoverMaterials[level]}
            position={[0, 0.008, 0]}
            renderOrder={LAYER.shadow + 0.3}
            raycast={noRaycast}
          />
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
