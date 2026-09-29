import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { Group, ShaderMaterial } from 'three';
import { PieceType } from '../../engine/pieces';
import { prefersReducedMotion } from '../motion';
import { noRaycast } from '../noRaycast';
import { PIECE_LIFT } from '../pieceMotion';
import { smooth, toward } from '../scene/ease';
import { wholePiece } from '../scene/occlusion';
import { usePieceMaterial } from '../scene/pieces';
import { SelectionLight, selectState, stepSelection } from '../scene/selection';
import { neonGeometry, neonMaterial } from '../scene/stage';
import {
  breath,
  cutForFill,
  FLOOR_Y,
  KING_SCALE,
  KING_TOP,
  LOBBY_TIMING,
  outlineForFill,
  tossAngle,
  tossHop,
} from './lobbyMotion';
import type { Side } from './lobbyMotion';

// The lobby's kings. A seat's king is either there, in its army's material,
// or only its outline in neon, the way the garden's colossal sculptures are
// drawn: an empty seat. Filling, the material forms from the foot up behind
// a bright edge (the capture's burn, run backwards) as the neon gives way;
// draining, it goes from the crown down and the neon comes back. The
// player's own king lifts into the game's column of light, as a piece does
// when it is picked up, so the lobby teaches the board's language.

const HOVER_RATE = 1 / PIECE_LIFT.hoverSeconds;
const LIFT_RATE = 1 / PIECE_LIFT.selectSeconds;

/** Pointer handlers for a king that can be picked (the choosing screen). */
export interface Pickable {
  onOver?: () => void;
  onOut?: () => void;
  onPick?: () => void;
}

const pickHandlers = (p: Pickable, enabled: boolean) =>
  enabled
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          p.onOver?.();
        },
        onPointerOut: () => p.onOut?.(),
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          p.onPick?.();
        },
      }
    : {};

/** The body's shine, lift and light, eased toward their goals each frame. */
const useKingMotion = () => useRef({ fill: 1, outline: 0, lift: 0, hover: 0, hold: 0 });

export const LobbyKing = ({
  color,
  x,
  present,
  gone,
  hovered,
  lit,
  breathing,
  pick,
}: {
  color: Side;
  x: number;
  /** Its seat is taken: the king in its material (else its neon outline). */
  present: boolean;
  /** Leaving for the game: the king and its outline go up in light. */
  gone: boolean;
  hovered: boolean;
  /** The player's own king: lifted into the column of light. */
  lit: boolean;
  /** The free seat breathes while it waits. */
  breathing: boolean;
  pick?: Pickable;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const still = useMemo(prefersReducedMotion, []);
  const body = usePieceMaterial(color, PieceType.King, 0);
  const neon = useMemo(
    () => ({
      geometry: neonGeometry([{ type: PieceType.King, at: [x, FLOOR_Y, 0] }], KING_SCALE),
      material: neonMaterial({
        width: 0.05,
        core: 0.14,
        halo: 0.09,
        intensity: 1.15,
        mirror: false,
        fade: 0,
        turn: { value: 1 },
        shaded: false,
      }),
    }),
    [x],
  );
  useEffect(
    () => () => {
      neon.geometry.dispose();
      neon.material.dispose();
    },
    [neon],
  );
  const motion = useKingMotion();
  // Start as the seat stands, with no entrance on the first frame
  const first = useRef(true);
  const lift = useRef<Group>(null);
  const held = useRef(selectState());
  const [showLight, setShowLight] = useState(false);
  const breathClock = useRef(0);
  useEffect(() => invalidate(), [present, gone, hovered, lit, breathing, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const m = motion.current;
    const fillGoal = present && !gone ? 1 : 0;
    if (first.current) {
      first.current = false;
      m.fill = fillGoal;
    }
    const before = { ...m };
    const rate = still ? 1 / 0.15 : 1 / LOBBY_TIMING.fill;
    m.fill = toward(m.fill, fillGoal, dt * rate);
    // Gone, the outline fades with the body; else it answers the fill
    m.outline = gone ? toward(m.outline, 0, dt * rate) : outlineForFill(m.fill);
    m.hover = toward(m.hover, hovered && !lit && present ? 1 : 0, dt * HOVER_RATE);
    m.hold = toward(m.hold, lit && m.fill > 0.9 && !gone ? 1 : 0, dt * LIFT_RATE);
    const up = PIECE_LIFT.hover * smooth(m.hover) + PIECE_LIFT.selected * smooth(m.hold);
    if (lift.current) lift.current.position.y = up;

    const u = body.uniforms;
    u.uCut.value = cutForFill(m.fill);
    u.uHover.value = smooth(m.hover);
    u.uHold.value = smooth(m.hold) * held.current.strength;

    if (breathing && !still) breathClock.current += dt;
    else breathClock.current = 0;
    const inBreath = breathing && !still && breathClock.current < 60;
    neon.material.uniforms.uIntensity.value =
      1.15 * m.outline * (inBreath ? breath(breathClock.current) : 1);

    const showing = stepSelection(held.current, m.hold > 0.02 && lit && !gone, dt * 1000, still);
    if (showing !== showLight) setShowLight(showing);
    const moving =
      m.fill !== before.fill ||
      m.outline !== before.outline ||
      m.hover !== before.hover ||
      m.hold !== before.hold;
    if (moving || showing || inBreath) invalidate();
  });

  const top = KING_TOP;
  const canPick = !!pick && present && !gone;
  return (
    <group position={[x, FLOOR_Y, 0]}>
      <group scale={KING_SCALE}>
        {showLight && <SelectionLight state={held} top={top} />}
        <group ref={lift}>
          <mesh geometry={wholePiece(PieceType.King)} material={body} raycast={noRaycast} />
        </group>
        {/* A still stand-in to point at: the body lifts under the pointer */}
        {canPick && pick && (
          <mesh position={[0, top / 2, 0]} {...pickHandlers(pick, true)} visible={false}>
            <cylinderGeometry args={[0.33, 0.33, top + 0.2, 12]} />
          </mesh>
        )}
      </group>
      {/* The neon outline carries its place in its geometry (its shader
          draws in world space), so it stands still while the body lifts */}
      <mesh
        geometry={neon.geometry}
        material={neon.material}
        frustumCulled={false}
        renderOrder={5}
        raycast={noRaycast}
      />
    </group>
  );
};

/** A body in one half only: the coin's porcelain left half or charcoal right half. */
const halve = (material: ShaderMaterial, half: -1 | 1) => {
  material.uniforms.uHalf = { value: half };
  // (once: React may build the memo twice over the same material)
  if (material.fragmentShader.includes('uHalf')) return material;
  material.fragmentShader = material.fragmentShader.replace(
    'void main() {',
    'uniform float uHalf;\n  void main() {\n    if (vLocal.x * uHalf < 0.0) discard;',
  );
  material.needsUpdate = true;
  return material;
};

/**
 * "Random": a king split down its axis, porcelain on the left and charcoal on
 * the right. Tossed, it spins like a coin, slows, and settles showing one
 * face; then it burns away and `onLanded` hands the result to its seat.
 */
export const CoinKing = ({
  shown,
  hovered,
  toss,
  pick,
  onLanded,
}: {
  shown: boolean;
  hovered: boolean;
  toss: Side | null;
  pick?: Pickable;
  onLanded: (side: Side) => void;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const still = useMemo(prefersReducedMotion, []);
  const whiteBody = usePieceMaterial('white', PieceType.King, 0);
  const blackBody = usePieceMaterial('black', PieceType.King, 0);
  const halves = useMemo(
    () => [halve(whiteBody, -1), halve(blackBody, 1)] as const,
    [whiteBody, blackBody],
  );
  const spin = useRef<Group>(null);
  const lift = useRef<Group>(null);
  const root = useRef<Group>(null);
  // Starts as it is first shown: a page that opens without it never shows it
  const state = useRef({ fill: shown ? 1 : 0, hover: 0, tossT: -1, landed: false });
  const landedRef = useRef(onLanded);
  useEffect(() => {
    landedRef.current = onLanded;
  });
  useEffect(() => {
    state.current.tossT = toss ? 0 : -1;
    state.current.landed = false;
    invalidate();
  }, [toss, invalidate]);
  useEffect(() => invalidate(), [shown, hovered, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = state.current;
    let moving = false;
    let angle = 0;
    let hop = 0;
    let goal = shown ? 1 : 0;
    if (toss && s.tossT >= 0) {
      s.tossT += dt;
      const spinFor = still ? 0.01 : LOBBY_TIMING.toss;
      angle = tossAngle(s.tossT, toss, spinFor);
      hop = still ? 0 : tossHop(s.tossT, spinFor);
      const done = s.tossT > spinFor + (still ? 0 : LOBBY_TIMING.tossHold);
      if (done) goal = 0;
      if (done && s.fill <= 0 && !s.landed) {
        s.landed = true;
        landedRef.current(toss);
      }
      moving = !s.landed;
    }
    const before = s.fill;
    const rate = still ? 1 / 0.15 : 1 / (toss ? LOBBY_TIMING.tossBurn : LOBBY_TIMING.fill);
    s.fill = toward(s.fill, goal, dt * rate);
    const h = s.hover;
    s.hover = toward(s.hover, hovered && !toss ? 1 : 0, dt * HOVER_RATE);
    if (root.current) root.current.visible = s.fill > 0;
    if (spin.current) spin.current.rotation.y = angle;
    if (lift.current) lift.current.position.y = hop + PIECE_LIFT.hover * smooth(s.hover);
    for (const m of halves) {
      m.uniforms.uCut.value = cutForFill(s.fill);
      m.uniforms.uHover.value = smooth(s.hover);
    }
    if (moving || s.fill !== before || s.hover !== h) invalidate();
  });

  const canPick = !!pick && shown && !toss;
  return (
    <group ref={root} position={[0, FLOOR_Y, 0]}>
      <group scale={KING_SCALE}>
        <group ref={lift}>
          <group ref={spin}>
            {halves.map((m, i) => (
              <mesh
                key={i}
                geometry={wholePiece(PieceType.King)}
                material={m}
                raycast={noRaycast}
              />
            ))}
          </group>
        </group>
        {canPick && pick && (
          <mesh position={[0, KING_TOP / 2, 0]} {...pickHandlers(pick, true)} visible={false}>
            <cylinderGeometry args={[0.33, 0.33, KING_TOP + 0.2, 12]} />
          </mesh>
        )}
      </group>
    </group>
  );
};
