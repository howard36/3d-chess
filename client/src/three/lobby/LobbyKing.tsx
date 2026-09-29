import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { Group, ShaderMaterial } from 'three';
import { LAYER } from '../scene/layers';
import { PieceType } from '../../engine/pieces';
import { prefersReducedMotion } from '../motion';
import { noRaycast } from '../noRaycast';
import { PIECE_LIFT } from '../pieceMotion';
import { smooth, toward } from '../scene/ease';
import { wholePiece } from '../scene/occlusion';
import { usePieceMaterial } from '../scene/pieces';
import { SelectionLight, selectState, stepSelection } from '../scene/selection';
import { NEON_WHOLE, neonGeometry, neonMaterial, REVEAL_SOFT } from '../scene/stage';
import {
  breath,
  formForFill,
  FLOOR_Y,
  KING_SCALE,
  KING_TOP,
  LOBBY_TIMING,
  outlineForFill,
  seatOpening,
  tossAngle,
  tossGlide,
  kingEntrance,
  tossHop,
  tossLanded,
  LOBBY_MAX_STEP,
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
/** How fast a king's height closes on its goal (per second): most of the way in a third of a second. */
const LIFT_EASE = 9;
/** Setting a chosen king down on its square: a touch quicker than lifting. */
const SET_DOWN_EASE = 13;
/** `from` eased toward `to` over `dt` seconds at `rate`, landing on it once within a hair. */
const settle = (from: number, to: number, dt: number, rate: number) => {
  const next = to + (from - to) * Math.exp(-rate * dt);
  return Math.abs(next - to) < 1e-4 ? to : next;
};

/** Pointer handlers for a king that can be picked (the choosing screen). */
export interface Pickable {
  onOver?: () => void;
  onOut?: () => void;
  onPick?: () => void;
}

/**
 * Where a lobby king draws among the see-through layers: after the glass and
 * its edges, so while it fades (blended) the glass behind it is already there
 * to show through, rather than a king-shaped hole of night.
 */
const FADING_ORDER = LAYER.label + 1;

/** The pointer on a king; `ready` says whether it has formed (none is picked while forming). */
const pickHandlers = (p: Pickable, ready: () => boolean) => ({
  onPointerOver: (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (ready()) p.onOver?.();
  },
  onPointerOut: () => p.onOut?.(),
  onClick: (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (ready()) p.onPick?.();
  },
});

/**
 * What the two lobby kings share: their fills, and at the start, how long it
 * has been under way and how long both have been filled.
 */
export interface KingPair {
  white: number;
  black: number;
  started: number;
  both: number;
}

/** How long a king takes to fill (to the 0.9 its light waits for), from the start of the arrival. */
const FILLED_BY = LOBBY_TIMING.fill * 0.9;

/** The body's shine, lift and light, eased toward their goals each frame. */
const useKingMotion = () =>
  useRef({ fill: 1, fade: 1, outline: 0, lift: 0, hover: 0, hold: 0, gone: 0 });

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
  veiled = false,
  enter,
}: {
  color: Side;
  x: number;
  /** Its seat is taken: the king in its material (else its neon outline). */
  present: boolean;
  /** Leaving for the game: the king and its outline go up in light. */
  gone: boolean;
  hovered: boolean;
  /** The player's own king (or, at the start, both): in the column of light. */
  lit: boolean;
  /** The free seat breathes while it waits. */
  breathing: boolean;
  /** Taken at once, with no forming: the tossed coin has landed here and is this king. */
  snap?: boolean;
  pick?: Pickable;
  /** Both kings' fills, shared, written by each king every frame. */
  fills?: RefObject<KingPair>;
  /** Its entrance when the lobby first shows: when it starts to form (seconds from the first frame). */
  enter?: number;
  /** The game starting: lit, it lifts once both kings have filled, with the other. */
  together?: boolean;
  /**
   * Its outline held back: the opponent's seat on a named pick drains to
   * nothing, as the coin beside it does, and its outline comes up once this
   * is lifted, with the invitation.
   */
  veiled?: boolean;
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
  // Seconds since its first frame, for its entrance (none under reduced motion)
  const entrance = useRef(enter === undefined || still ? Infinity : 0);
  // Its outline's strength: a king that forms on the entrance shows none
  // (it comes out of nothing, as the coin does), and gets it once solid; a
  // free seat's outline comes up with the entrance
  const neonGate = useRef(entrance.current < Infinity ? 0 : 1);
  // Seconds since its veil lifted (Infinity: none, or its outline fully up)
  const opened = useRef(Infinity);
  useEffect(() => invalidate(), [present, gone, hovered, lit, breathing, snap, veiled, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, LOBBY_MAX_STEP);
    const m = motion.current;
    const fillGoal = present ? 1 : 0;
    // Entering, its outline comes up, then it forms from the foot
    const entering = entrance.current < Infinity;
    const shown = entering ? kingEntrance(entrance.current, enter ?? 0) : null;
    if (entering) {
      entrance.current += dt;
      if (shown!.forming && shown!.outline >= 1) entrance.current = Infinity;
    }
    if (first.current || (snap && fillGoal === 1)) {
      m.fill = first.current && entering ? 0 : fillGoal;
      m.fade = 1;
      first.current = false;
      // The coin that slid in here is the player's king, in its light at once
      if (snap && lit) m.hold = 1;
    }
    const before = { ...m };
    const rate = still ? 1 / 0.15 : 1 / LOBBY_TIMING.fill;
    // Taken, it forms from the foot up; let go, it fades where it stands,
    // stepping back into the dark rather than draining, and once faded is
    // empty again (to form anew, should its seat be taken again)
    if (!present && m.fill > 0 && !gone) {
      m.fade = toward(m.fade, 0, dt * (still ? 1 / 0.15 : 1 / LOBBY_TIMING.fade));
      if (m.fade <= 0) {
        m.fill = 0;
        m.fade = 1;
      }
    } else {
      m.fade = toward(m.fade, 1, dt * rate);
      if (!shown || shown.forming) m.fill = toward(m.fill, fillGoal, dt * rate);
    }
    // Gone, the outline fades with the body; else it answers what shows of
    // the body (fading, the two cross: the solid king gives way to its outline)
    m.outline = gone ? toward(m.outline, 0, dt * rate) : outlineForFill(m.fill * smooth(m.fade));
    m.hover = toward(m.hover, hovered && !lit && present ? 1 : 0, dt * HOVER_RATE);
    // The start: from both kings filled, their columns come on together,
    // then the two lift together (White's king keeps the shared time). A
    // king already filled before the start (the guest's, filled on the click)
    // waits as long as a fresh fill would: the same beat on both pages
    const pair = fills?.current;
    if (pair) {
      pair[color] = m.fill;
      if (color === 'white') {
        pair.started = together ? pair.started + dt : 0;
        pair.both = together && Math.min(pair.white, pair.black) > 0.9 ? pair.both + dt : 0;
      }
    }
    const since =
      together && pair ? (still ? Infinity : Math.min(pair.both, pair.started - FILLED_BY)) : 0;
    const waiting = together && since < LOBBY_TIMING.arriveLift;
    // Its column of light as soon as it is the player's and filled (a king
    // already in its light keeps it); at the start, with the other's
    const lightOn =
      lit && m.fill > 0.9 && (!together || m.hold > 0 || since >= LOBBY_TIMING.arriveLight);
    m.hold = toward(m.hold, lightOn ? 1 : 0, dt * (still ? 1 / 0.15 : LIFT_RATE));
    const rising = together && since >= LOBBY_TIMING.arriveLift;
    // Leaving: each king rises, in its own column of light, and is taken up
    // into it from the foot, faster as it goes
    m.gone = gone ? toward(m.gone, 1, dt / (still ? 0.15 : LOBBY_TIMING.leaveBurn)) : 0;
    // One height: a hover lifts it (picked up); chosen, it is set down on its
    // square, a little quicker; at the start it rises with the other
    const liftGoal =
      lit && rising ? PIECE_LIFT.selected : hovered && present && !lit ? PIECE_LIFT.hover : 0;
    m.lift = still
      ? liftGoal
      : settle(m.lift, liftGoal, dt, liftGoal < m.lift ? SET_DOWN_EASE : LIFT_EASE);
    const up = m.lift + GONE_RISE * m.gone * m.gone;
    if (lift.current) lift.current.position.y = up;

    const u = body.uniforms;
    u.uForm.value = formForFill(m.fill);
    u.uGone.value = m.gone * m.gone;
    u.uFade.value = smooth(m.fade);
    // Blended only while it fades: solid, it draws with the opaque pieces
    body.transparent = m.fade < 0.999;
    u.uHover.value = smooth(m.hover);
    u.uHold.value = smooth(m.hold) * held.current.strength;

    if (breathing && !still) breathClock.current += dt;
    else breathClock.current = 0;
    const inBreath = breathing && !still && breathClock.current < 60;
    if (shown) neonGate.current = present ? 0 : shown.outline;
    else if (neonGate.current < 1 && (!present || m.outline < 0.01)) neonGate.current = 1;
    // Veiled, no outline; unveiled, it is drawn up from the foot, a soft
    // edge of light rising up its height (at once under reduced motion)
    const opening = !veiled && opened.current < Infinity;
    if (veiled) opened.current = 0;
    else if (opening) {
      opened.current = still ? Infinity : opened.current + dt;
      if (seatOpening(opened.current) >= 1) opened.current = Infinity;
    }
    const open = veiled ? 0 : seatOpening(opened.current);
    // (from just under its foot, whose ring lights first, to over its cross)
    neon.material.uniforms.uReveal.value =
      open >= 1 ? NEON_WHOLE : FLOOR_Y - 0.08 + open * (KING_TOP * KING_SCALE + REVEAL_SOFT + 0.16);
    neon.material.uniforms.uIntensity.value =
      1.15 * m.outline * (inBreath ? breath(breathClock.current) : 1) * neonGate.current;

    const column = gone ? m.fill > 0.5 && m.gone < 0.85 : m.hold > 0.02 && lit;
    const showing = stepSelection(held.current, column, dt * 1000, still);
    if (showing !== showLight) setShowLight(showing);
    const moving =
      m.fill !== before.fill ||
      m.outline !== before.outline ||
      m.hover !== before.hover ||
      m.hold !== before.hold ||
      m.lift !== before.lift ||
      m.fade !== before.fade ||
      m.gone !== before.gone;
    if (moving || showing || inBreath || waiting || entering || opening) invalidate();
  });

  const top = KING_TOP;
  const canPick = !!pick && present && !gone;
  return (
    <group position={[x, FLOOR_Y, 0]}>
      <group scale={KING_SCALE}>
        {showLight && <SelectionLight state={held} top={top} />}
        <group ref={lift}>
          {/* Drawn after the glass, so fading it shows the glass behind */}
          <mesh
            geometry={wholePiece(PieceType.King)}
            material={body}
            raycast={noRaycast}
            renderOrder={FADING_ORDER}
          />
        </group>
        {/* A still stand-in to point at: the body lifts under the pointer */}
        {canPick && pick && (
          <mesh
            position={[0, top / 2, 0]}
            {...pickHandlers(pick, () => motion.current.fill >= 0.999)}
            visible={false}
          >
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
  material.uniforms.uFade = { value: 1 };
  // (once: React may build the memo twice over the same material)
  if (material.fragmentShader.includes('uGone')) return material;
  material.fragmentShader = material.fragmentShader
    .replace('0.09 * noise(vLocal * 16.0)', '0.0')
    .replace('void main() {', 'uniform float uGone;\n  uniform float uFade;\n  void main() {')
    .replace('gl_FragColor = vec4(col, 1.0);', 'gl_FragColor = vec4(col, uFade);')
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
  enter,
}: {
  shown: boolean;
  hovered: boolean;
  toss: Side | null;
  /** Where the seat it lands on stands. */
  landX: number;
  pick?: Pickable;
  onGlide: () => void;
  onLanded: (side: Side) => void;
  /** Its entrance when the lobby first shows: when it starts to form (seconds from the first frame). */
  enter?: number;
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
  // Starts as it is first shown (forming, on its entrance): a page that opens
  // without it never shows it
  const entering = enter !== undefined && !still;
  const state = useRef({
    fill: shown && !entering ? 1 : 0,
    wait: entering ? enter : 0,
    fade: 1,
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
    const dt = Math.min(delta, LOBBY_MAX_STEP);
    const s = state.current;
    const before = { fill: s.fill, hover: s.hover };
    let angle = 0;
    let hop = 0;
    let x = 0;
    let moving = false;
    if (toss && s.tossT >= 0 && !s.landed) {
      s.tossT = still ? Infinity : s.tossT + dt;
      angle = tossAngle(s.tossT, toss);
      // Thrown up spinning, down in the middle, then slid along the glass
      // into its seat's outline
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
      if (s.wait > 0) {
        s.wait -= dt;
        moving = true;
      } else if (!shown && s.fill > 0) {
        // Not chosen, it fades where it stands, as the side kings do
        s.fade = toward(s.fade, 0, dt * (still ? 1 / 0.15 : 1 / LOBBY_TIMING.fade));
        moving = true;
        if (s.fade <= 0) {
          s.fill = 0;
          s.fade = 1;
        }
      } else {
        s.fade = toward(s.fade, 1, dt * rate);
        s.fill = toward(s.fill, shown ? 1 : 0, dt * rate);
      }
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
      m.uniforms.uFade.value = smooth(s.fade);
      m.transparent = s.fade < 0.999;
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
                  renderOrder={FADING_ORDER}
                />
              ))}
            </group>
          </group>
          {canPick && pick && (
            <mesh
              position={[0, KING_TOP / 2, 0]}
              {...pickHandlers(pick, () => state.current.fill >= 0.999 && state.current.wait <= 0)}
              visible={false}
            >
              <cylinderGeometry args={[0.33, 0.33, KING_TOP + 0.2, 12]} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
};
