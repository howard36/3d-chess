import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
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
  formForFill,
  FLOOR_Y,
  KING_SCALE,
  KING_TOP,
  LOBBY_TIMING,
  outlineForFill,
  tossAngle,
  tossGlide,
  tossHop,
  tossLanded,
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
const useKingMotion = () => useRef({ fill: 1, outline: 0, lift: 0, hover: 0, hold: 0, gone: 0 });

export const LobbyKing = ({
  color,
  x,
  present,
  gone,
  hovered,
  lit,
  breathing,
  snap = false,
  pick,
  fills,
  together = false,
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
  /** Taken at once, with no forming: the tossed coin has landed here and is this king. */
  snap?: boolean;
  pick?: Pickable;
  /** Both kings' fills, shared, written by each king every frame. */
  fills?: RefObject<Record<Side, number>>;
  /** Lit and not yet lifted, it waits for both kings to fill, and lifts with the other. */
  together?: boolean;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const still = useMemo(prefersReducedMotion, []);
  const piece = usePieceMaterial(color, PieceType.King, 0);
  const body = useMemo(() => lobbyGlaze(piece), [piece]);
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
        dim: { value: 1 },
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
  useEffect(() => invalidate(), [present, gone, hovered, lit, breathing, snap, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const m = motion.current;
    const fillGoal = present ? 1 : 0;
    if (first.current || (snap && fillGoal === 1)) {
      first.current = false;
      m.fill = fillGoal;
    }
    const before = { ...m };
    const rate = still ? 1 / 0.15 : 1 / LOBBY_TIMING.fill;
    m.fill = toward(m.fill, fillGoal, dt * rate);
    // Gone, the outline fades with the body; else it answers the fill
    m.outline = gone ? toward(m.outline, 0, dt * rate) : outlineForFill(m.fill);
    m.hover = toward(m.hover, hovered && !lit && present ? 1 : 0, dt * HOVER_RATE);
    if (fills?.current) fills.current[color] = m.fill;
    // One already lifted stays; the rest start together once both have filled
    const filled =
      together && fills?.current && m.hold === 0
        ? Math.min(fills.current.white, fills.current.black) > 0.9
        : m.fill > 0.9;
    m.hold = toward(m.hold, lit && filled ? 1 : 0, dt * (still ? 1 / 0.15 : LIFT_RATE));
    // Leaving: each king rises, in its own column of light, and is taken up
    // into it from the foot, faster as it goes
    m.gone = gone ? toward(m.gone, 1, dt / (still ? 0.15 : LOBBY_TIMING.leaveBurn)) : 0;
    const up =
      PIECE_LIFT.hover * smooth(m.hover) +
      PIECE_LIFT.selected * smooth(m.hold) +
      GONE_RISE * m.gone * m.gone;
    if (lift.current) lift.current.position.y = up;

    const u = body.uniforms;
    u.uForm.value = formForFill(m.fill);
    u.uGone.value = m.gone * m.gone;
    u.uHover.value = smooth(m.hover);
    u.uHold.value = smooth(m.hold) * held.current.strength;

    if (breathing && !still) breathClock.current += dt;
    else breathClock.current = 0;
    const inBreath = breathing && !still && breathClock.current < 60;
    neon.material.uniforms.uIntensity.value =
      1.15 * m.outline * (inBreath ? breath(breathClock.current) : 1);

    const column = gone ? m.fill > 0.5 && m.gone < 0.85 : m.hold > 0.02 && lit;
    const showing = stepSelection(held.current, column, dt * 1000, still);
    if (showing !== showLight) setShowLight(showing);
    const moving =
      m.fill !== before.fill ||
      m.outline !== before.outline ||
      m.hover !== before.hover ||
      m.hold !== before.hold ||
      m.gone !== before.gone;
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

/** How far a king rises as it leaves for the game (piece units). */
const GONE_RISE = 0.5;

/**
 * The lobby's kings in the piece glaze, with a clean edge: the forming line
 * (uForm) runs level, without the entrance's grain, and `uGone` takes the
 * king up from the foot behind the same thin line of light.
 */
const lobbyGlaze = (material: ShaderMaterial) => {
  material.uniforms.uGone = { value: 0 };
  // (once: React may build the memo twice over the same material)
  if (material.fragmentShader.includes('uGone')) return material;
  material.fragmentShader = material.fragmentShader
    .replace('0.09 * noise(vLocal * 16.0)', '0.0')
    .replace('void main() {', 'uniform float uGone;\n  void main() {')
    .replace(
      'vec3 n = normalize(vN);',
      `if (uGone > 0.0) {
      float eg = h - uGone * 1.12 + 0.06;
      if (eg < 0.0) discard;
      burn = min(burn, smoothstep(0.0, 0.03, eg));
    }
    vec3 n = normalize(vN);`,
    );
  material.needsUpdate = true;
  return material;
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
 * the right. Tossed, it is thrown up spinning like a coin, lands showing one
 * face, and glides onto that side's seat (`onGlide` as it sets off), where `onLanded` hands it over to
 * the seat's own king (seen from the front, the coin showing a face is that
 * king). Not chosen, it drains away.
 */
export const CoinKing = ({
  shown,
  hovered,
  toss,
  landX,
  pick,
  onGlide,
  onLanded,
}: {
  shown: boolean;
  hovered: boolean;
  toss: Side | null;
  /** Where the seat it lands on stands. */
  landX: number;
  pick?: Pickable;
  onGlide: () => void;
  onLanded: (side: Side) => void;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const still = useMemo(prefersReducedMotion, []);
  const whiteBody = usePieceMaterial('white', PieceType.King, 0);
  const blackBody = usePieceMaterial('black', PieceType.King, 0);
  const halves = useMemo(
    () => [halve(lobbyGlaze(whiteBody), -1), halve(lobbyGlaze(blackBody), 1)] as const,
    [whiteBody, blackBody],
  );
  const root = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const lift = useRef<Group>(null);
  // Starts as it is first shown: a page that opens without it never shows it
  const state = useRef({
    fill: shown ? 1 : 0,
    hover: 0,
    tossT: -1,
    gliding: false,
    landed: false,
  });
  const told = useRef({ onGlide, onLanded });
  useEffect(() => {
    told.current = { onGlide, onLanded };
  });
  useEffect(() => {
    state.current.tossT = toss ? 0 : -1;
    state.current.gliding = false;
    state.current.landed = false;
    invalidate();
  }, [toss, invalidate]);
  useEffect(() => invalidate(), [shown, hovered, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = state.current;
    const before = { fill: s.fill, hover: s.hover };
    let angle = 0;
    let hop = 0;
    let x = 0;
    let moving = false;
    if (toss && s.tossT >= 0 && !s.landed) {
      s.tossT = still ? Infinity : s.tossT + dt;
      angle = tossAngle(s.tossT, toss);
      hop = still ? 0 : tossHop(s.tossT);
      const glide = tossGlide(s.tossT);
      x = landX * glide;
      s.fill = 1;
      moving = true;
      if (!s.gliding && (glide > 0 || tossLanded(s.tossT))) {
        s.gliding = true;
        told.current.onGlide();
      }
      if (tossLanded(s.tossT)) {
        s.landed = true;
        s.fill = 0;
        told.current.onLanded(toss);
      }
    } else if (!toss) {
      const rate = still ? 1 / 0.15 : 1 / LOBBY_TIMING.fill;
      s.fill = toward(s.fill, shown ? 1 : 0, dt * rate);
    }
    s.hover = toward(s.hover, hovered && !toss ? 1 : 0, dt * HOVER_RATE);
    if (root.current) {
      root.current.visible = s.fill > 0;
      root.current.position.x = x;
    }
    if (spin.current) spin.current.rotation.y = angle;
    if (lift.current) lift.current.position.y = hop + PIECE_LIFT.hover * smooth(s.hover);
    for (const m of halves) {
      m.uniforms.uForm.value = formForFill(s.fill);
      m.uniforms.uHover.value = smooth(s.hover);
    }
    if (moving || s.fill !== before.fill || s.hover !== before.hover) invalidate();
  });

  const canPick = !!pick && shown && !toss;
  return (
    <group position={[0, FLOOR_Y, 0]}>
      <group ref={root}>
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
    </group>
  );
};
