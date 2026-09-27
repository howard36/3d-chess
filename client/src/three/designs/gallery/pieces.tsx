import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, MeshStandardMaterial } from 'three';
import type { Group, IUniform, Material } from 'three';
import { ChessPiece } from '../../pieces';
import { ContactShadow, LevelFootprint } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { LEVELS } from './palette';
import { CHECK_RIM, makeStone } from './stone';
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
// (see markers.tsx), its upward faces warm in the light, and it turns slowly
// on its plinth, as a sculpture on a gallery turntable. Let go, it turns
// back to face the way it stood. Hovered, it warms a little in anticipation.

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
      ...(state === 'check' ? { rimColor: CHECK_RIM, rimScale: 1.05 } : {}),
    });
    // The marble's rim is a glow; in check it needs to be strong enough to see
    if (state === 'check' && kind === 'marble') m.userData.stone.uRim.value = 0.4;
    if (state === 'check' && kind === 'bardiglio') m.userData.stone.uRim.value = 0.32;
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
    metalness: 0.55,
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

// One turn every 9 seconds: slow enough to be calm, quick enough to be seen
const TURN_SPEED = (Math.PI * 2) / 9;
const TAU = Math.PI * 2;

/**
 * A piece standing on its level: contact shadow, level inlay ring, and the
 * carved piece on a turntable that turns while it is selected.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const { type, color, selected, hovered, inCheck, level = 0 } = props;
  const turn = useRef<Group>(null);
  const ground = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    // The shadow and the level ring stay on the floor while Board lifts the piece
    const lift = ground.current?.parent;
    if (ground.current && lift?.userData.lift) ground.current.position.y = -lift.position.y;
    const g = turn.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 20);
    if (selected) {
      g.rotation.y = (g.rotation.y + dt * TURN_SPEED) % TAU;
      invalidate();
    } else if (g.rotation.y !== 0) {
      // Turn back the short way, easing in to rest
      const r = g.rotation.y > Math.PI ? g.rotation.y - TAU : g.rotation.y;
      const next = r * Math.max(0, 1 - dt * 7);
      g.rotation.y = Math.abs(next) < 1e-3 ? 0 : (next + TAU) % TAU;
      invalidate();
    }
  });
  const state: State = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'rest';
  const mats = pieceMaterials(color, state, level);
  return (
    <>
      <group ref={ground}>
        <ContactShadow radius={0.37} opacity={0.55} />
        <LevelFootprint
          color={LEVELS[level] ?? LEVELS[0]}
          radius={0.335}
          width={0.026}
          opacity={0.5}
        />
      </group>
      <group ref={turn}>
        <ChessPiece type={type} parts={mats} />
      </group>
    </>
  );
};
