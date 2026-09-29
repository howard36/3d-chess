import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import type { Mesh, PerspectiveCamera } from 'three';
import { prefersReducedMotion } from '../motion';
import { noRaycast } from '../noRaycast';
import { platformStack } from '../scene/mask';
import { PALETTE } from '../scene/palette';
import { Stage } from '../scene/stage';
import { LAYER } from '../scene/layers';
import { CoinKing, LobbyKing } from './LobbyKing';
import { Levels } from '../scene/plates';
import { IntroContext } from '../intro/clock';
import type { IntroClock } from '../intro/clock';
import { introPlan } from '../intro/timeline';
import { setLensShift } from '../viewOffset';
import {
  arrivalRing,
  blendPose,
  FLOOR_Y,
  KING_SCALE,
  KING_TOP,
  LOBBY_TIMING,
  lobbyPose,
  cardBeside,
  gameOpening,
  posePosition,
  seatX,
} from './lobbyMotion';
import type { CameraPose, Side } from './lobbyMotion';

// The lobby: one glass platform in the night garden and the two kings on
// it. What it shows is declared by the screens over it (LobbyView); how it
// moves from one picture to the next is its own business, on r3f's clock.

export type LobbyBeat = 'choose' | 'wait' | 'invited' | 'arrive' | 'leave';
export type Choice = Side | 'random';

export interface LobbyView {
  beat: LobbyBeat;
  /** The seats that are taken: their kings in material, the others in neon. */
  taken: Record<Side, boolean>;
  /** This player's seat once they have one: lifted into the column of light. */
  mine: Side | null;
  /**
   * The player's king stands on the glass, not lifted, until the game starts
   * (a side left to chance: the coin slid into it along the glass).
   */
  grounded?: boolean;
  /** Choosing: the king under the pointer or keyboard focus. */
  hover: Choice | null;
  /** Choosing "Random": the side the coin will land on. */
  toss: Side | null;
  /** The side this player will see the board from (where the camera leaves to). */
  seat: Side;
  /** Arriving: the seat just taken, answered by a ring of light across the glass. */
  arriving?: Side;
  onHover?: (choice: Choice | null) => void;
  onPick?: (choice: Choice) => void;
  /** Choosing "Random": the tossed coin has left the middle for its seat. */
  onGlide?: () => void;
  /** Choosing: the pick has played out (the coin landed, the light has risen). */
  onSettled?: () => void;
  /** Arriving: the free seat has filled and the moment has been held. */
  onArrived?: () => void;
  /** Leaving: the lobby's picture begins to fade over the game (the game's entrance may begin). */
  onReveal?: () => void;
  /** Leaving: the lobby's picture has faded out over the game. */
  onLeft?: () => void;
}

/** The screen positions of the seats, for the page's labels (CSS pixels). */
export interface SeatAnchors {
  white: { x: number; head: number; foot: number };
  coin: { x: number; head: number; foot: number };
  black: { x: number; head: number; foot: number };
}

/** A lobby king's foot, with its rim's glow, from its axis (world units). */
const KING_FOOT_RADIUS = 0.3;

// --- The ring of light when a seat is taken ------------------------------------------------

const ringGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

const SeatRing = ({ x, playing }: { x: number; playing: boolean }) => {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useRef<Mesh>(null);
  const t = useRef(-1);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.select) },
          uRadius: { value: 0 },
          uStrength: { value: 0 },
          uCentre: { value: [0, 0] },
        },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() {
            vP = (modelMatrix * vec4(position, 1.0)).xz;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uRadius;
          uniform float uStrength;
          uniform vec2 uCentre;
          varying vec2 vP;
          void main() {
            float r = length(vP - uCentre);
            float band = exp(-pow((r - uRadius) / 0.05, 2.0));
            float inner = exp(-pow((r - uRadius * 0.7) / 0.18, 2.0)) * 0.15;
            float a = (band + inner) * uStrength;
            // Only on the glass
            vec2 q = abs(vP);
            a *= 1.0 - smoothstep(2.45, 2.55, max(q.x, q.y));
            if (a < 0.002) discard;
            gl_FragColor = vec4(uColor * a, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.uniforms.uCentre.value = [x, 0];
  }, [material, x]);
  useEffect(() => {
    if (playing) {
      t.current = 0;
      invalidate();
    }
  }, [playing, invalidate]);
  useFrame((_, delta) => {
    if (t.current < 0) return;
    t.current += Math.min(delta, 1 / 20);
    const { radius, strength } = arrivalRing(t.current);
    material.uniforms.uRadius.value = radius;
    material.uniforms.uStrength.value = strength;
    if (mesh.current) mesh.current.visible = strength > 0.002;
    if (strength > 0.002) invalidate();
    else t.current = -1;
  });
  return (
    <mesh
      ref={mesh}
      geometry={ringGeometry}
      material={material}
      scale={[5.2, 1, 5.2]}
      position={[0, FLOOR_Y + 0.004, 0]}
      renderOrder={LAYER.shadow}
      visible={false}
      raycast={noRaycast}
    />
  );
};

/** How bright the garden's sculptures stand behind the lobby's kings (1 in the game). */
const LOBBY_DIM = 0.22;

// --- The camera and the page's anchors ----------------------------------------------------------

const projected = new Vector3();

const LobbyRig = ({
  view,
  clock,
  anchors,
  canvasHost,
  dim,
  onReveal,
  onLeft,
}: {
  view: LobbyView;
  clock: React.RefObject<{ beat: LobbyBeat; since: number }>;
  anchors: React.RefObject<HTMLElement | null>;
  canvasHost: React.RefObject<HTMLElement | null>;
  dim: React.RefObject<number>;
  onReveal: () => void;
  onLeft: () => void;
}) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const still = useMemo(prefersReducedMotion, []);
  const from = useRef<CameraPose | null>(null);
  const current = useRef<CameraPose | null>(null);
  const left = useRef(false);
  const shifted = useRef(false);
  const last = useRef('');
  useEffect(() => invalidate(), [size, view.beat, invalidate]);

  useFrame((_, delta) => {
    const aspect = size.width / Math.max(size.height, 1);
    const { beat, since } = clock.current;
    // (a card is docked under the kings, or beside them, while the host waits)
    const rest = lobbyPose(aspect, beat === 'wait', cardBeside(size.width, size.height));
    let pose = rest;
    let moving = false;
    // From one beat's framing to the next, eased (the card coming in lifts
    // the kings); the first frame takes its place at once
    const prev = current.current;
    if (prev && beat !== 'leave' && !still) {
      const k = 1 - Math.exp(-Math.min(delta, 1 / 20) * 3.2);
      const ease = (a: number, b: number) => a + (b - a) * k;
      const eased: CameraPose = {
        target: [
          ease(prev.target[0], pose.target[0]),
          ease(prev.target[1], pose.target[1]),
          ease(prev.target[2], pose.target[2]),
        ],
        azimuth: ease(prev.azimuth, pose.azimuth),
        elevation: ease(prev.elevation, pose.elevation),
        distance: ease(prev.distance, pose.distance),
      };
      const gap =
        Math.abs(eased.target[1] - pose.target[1]) +
        Math.abs(eased.azimuth - pose.azimuth) +
        Math.abs(eased.distance - pose.distance) * 0.1;
      if (gap > 1e-4) {
        pose = eased;
        moving = true;
      }
    }
    if (beat === 'leave') {
      // Out to where the game's camera stands on its first frame, taking
      // on its lens shift as it goes: the lobby's last picture is the
      // game's first, level A's glass in the same place, and the canvases
      // change hands under it unseen
      from.current ??= current.current ?? rest;
      const opening = gameOpening(view.seat, size.width, size.height);
      const start = still ? 0 : LOBBY_TIMING.leaveBurn * 0.4;
      const span = still ? 0.15 : LOBBY_TIMING.leaveMove;
      const k = Math.min(Math.max((since - start) / span, 0), 1);
      pose = blendPose(from.current, opening.pose, k);
      const eased = k * k * (3 - 2 * k);
      setLensShift(
        camera,
        [opening.shift[0] * eased, opening.shift[1] * eased],
        size.width,
        size.height,
      );
      shifted.current = true;
      // The garden comes back up to the game's brightness on the way
      dim.current = LOBBY_DIM + (1 - LOBBY_DIM) * eased;
      const fade = still ? 0.1 : LOBBY_TIMING.leaveFade;
      const opacity = Math.min(Math.max((start + span + fade - since) / fade, 0), 1);
      if (canvasHost.current) canvasHost.current.style.opacity = String(opacity);
      if (opacity <= 0 && !left.current) {
        left.current = true;
        onReveal();
        onLeft();
      }
      moving = !left.current;
    } else {
      from.current = null;
      left.current = false;
      dim.current = LOBBY_DIM;
      if (shifted.current) {
        shifted.current = false;
        setLensShift(camera, [0, 0], size.width, size.height);
      }
      if (canvasHost.current) canvasHost.current.style.opacity = '1';
    }
    current.current = pose;
    camera.position.set(...posePosition(pose));
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();

    // The seats on screen, for the page's labels and buttons
    const host = anchors.current;
    if (host && beat !== 'leave') {
      const vars: string[] = [];
      const xs: number[] = [];
      for (const seat of ['white', 'coin', 'black'] as const) {
        const x = seatX(seat);
        const at = (y: number, z = 0) => {
          projected.set(x, y, z).project(camera);
          return [(projected.x * 0.5 + 0.5) * size.width, (0.5 - projected.y * 0.5) * size.height];
        };
        const [sx, foot] = at(FLOOR_Y);
        const [, head] = at(FLOOR_Y + KING_TOP * KING_SCALE + 0.08);
        // The near edge of its foot (and the rim's glow), where things hang under it
        const [, front] = at(FLOOR_Y, KING_FOOT_RADIUS);
        vars.push(`--seat-${seat}-x:${sx.toFixed(1)}px`);
        vars.push(`--seat-${seat}-head:${head.toFixed(1)}px`);
        vars.push(`--seat-${seat}-foot:${foot.toFixed(1)}px`);
        vars.push(`--seat-${seat}-front:${front.toFixed(1)}px`);
        xs.push(sx);
        if (seat === 'coin') vars.push(`--king-height:${(foot - head).toFixed(1)}px`);
      }
      // How far apart the seats stand on screen, for the buttons under them
      vars.push(`--seat-pitch:${(xs[1] - xs[0]).toFixed(1)}px`);
      const css = vars.join(';');
      if (css !== last.current) {
        last.current = css;
        for (const v of vars) {
          const [name, value] = v.split(':');
          host.style.setProperty(name, value);
        }
      }
    }
    if (moving) invalidate();
  });
  return null;
};

// --- The scene ---------------------------------------------------------------------------------

export const LobbyScene = ({
  view,
  anchors,
  canvasHost,
}: {
  view: LobbyView;
  anchors: React.RefObject<HTMLElement | null>;
  canvasHost: React.RefObject<HTMLElement | null>;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const still = useMemo(prefersReducedMotion, []);
  const shade = useMemo(() => platformStack(0, 0), []);
  // The garden's sculptures, quiet behind the kings (LobbyRig raises them as it leaves)
  const dim = useRef(LOBBY_DIM);
  // Seconds into the current beat, on r3f's clock
  const clock = useRef({ beat: view.beat, since: 0 });
  // The coin's result once it has landed (until then the seats wait)
  const [landed, setLanded] = useState<Side | null>(null);
  if (view.toss === null && landed !== null) setLanded(null);
  const tossing = view.toss !== null && landed === null;
  // The picture shown: while the coin is in the air both seats stand open
  const taken = tossing ? { white: false, black: false } : view.taken;
  const mine = tossing ? null : view.mine;
  const settled = useRef<{ mine: Side | null; since: number; told: boolean }>({
    mine: null,
    since: 0,
    told: false,
  });
  const arrived = useRef(false);
  const callbacks = useRef(view);
  useEffect(() => {
    callbacks.current = view;
  });
  useEffect(() => invalidate(), [view, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const c = clock.current;
    if (c.beat !== view.beat) {
      c.beat = view.beat;
      c.since = 0;
      arrived.current = false;
    } else c.since += dt;
    // The choice has played out once its king has filled and lifted into the light
    const s = settled.current;
    if (s.mine !== mine) {
      s.mine = mine;
      s.since = 0;
      s.told = false;
    } else s.since += dt;
    if (view.beat === 'choose' && mine && !s.told) {
      const wait = still ? 0.2 : LOBBY_TIMING.fill * 0.5 + LOBBY_TIMING.settle;
      if (s.since >= wait) {
        s.told = true;
        callbacks.current.onSettled?.();
      } else invalidate();
    }
    if (view.beat === 'arrive' && !arrived.current) {
      const wait = still ? 0.2 : LOBBY_TIMING.fill + LOBBY_TIMING.arriveHold;
      if (c.since >= wait) {
        arrived.current = true;
        callbacks.current.onArrived?.();
      } else invalidate();
    }
  });

  const choosing = view.beat === 'choose' && !view.mine && !view.toss;
  const gone = view.beat === 'leave';
  const pick = (choice: Choice) => ({
    onOver: () => callbacks.current.onHover?.(choice),
    onOut: () => callbacks.current.onHover?.(null),
    onPick: () => callbacks.current.onPick?.(choice),
  });
  // The seat that fills on arrival answers with a ring of light, and its king
  // rises into a column of its own beside the player's: the two stand level
  // before they are taken up together
  const filling = view.beat === 'arrive' || view.beat === 'leave';
  const fills = useRef<Record<Side, number>>({ white: 0, black: 0 });
  const newcomer = view.beat === 'arrive' ? (view.arriving ?? null) : null;

  return (
    <>
      <Stage orientation="white" shade={gone ? undefined : shade} dim={() => dim.current} />
      <LobbyPlatform />
      {(['white', 'black'] as const).map((side) => (
        <LobbyKing
          key={side}
          color={side}
          x={seatX(side)}
          present={taken[side]}
          gone={gone}
          hovered={view.hover === side}
          lit={(mine === side && !view.grounded) || filling}
          fills={fills}
          together={filling}
          breathing={!taken[side] && (view.beat === 'wait' || view.beat === 'invited')}
          snap={landed === side}
          pick={choosing ? pick(side) : undefined}
        />
      ))}
      <CoinKing
        shown={view.beat === 'choose' && (!view.mine || view.toss !== null)}
        hovered={view.hover === 'random'}
        toss={view.toss}
        landX={view.toss ? seatX(view.toss) : 0}
        pick={choosing ? pick('random') : undefined}
        onGlide={() => callbacks.current.onGlide?.()}
        onLanded={setLanded}
      />
      {filling && newcomer && <SeatRing x={seatX(newcomer)} playing={filling} />}
      <LobbyRig
        view={view}
        clock={clock}
        anchors={anchors}
        canvasHost={canvasHost}
        dim={dim}
        onReveal={() => callbacks.current.onReveal?.()}
        onLeft={() => callbacks.current.onLeft?.()}
      />
    </>
  );
};

// --- The glass --------------------------------------------------------------------------------

/** How long the platform takes to draw itself (its edge, lines and glass). */
const PLATFORM_BUILD = 0.7;

/**
 * The glass the kings stand on: level A of the tower, drawing itself as the
 * game's entrance draws each level (its build clock, IntroContext) when the
 * lobby first opens. It stays as the lobby leaves: the game's tower builds
 * on up from it.
 */
const LobbyPlatform = () => {
  const invalidate = useThree((s) => s.invalidate);
  const still = useMemo(prefersReducedMotion, []);
  const clock = useMemo<IntroClock>(
    () => ({
      plan: {
        ...introPlan('full'),
        levels: { start: 0, duration: PLATFORM_BUILD, step: 0 },
      },
      t: still ? PLATFORM_BUILD : 0,
    }),
    [still],
  );
  useFrame((_, delta) => {
    if (clock.t >= PLATFORM_BUILD) return;
    clock.t = Math.min(clock.t + Math.min(delta, 1 / 20), PLATFORM_BUILD);
    invalidate();
  });
  return (
    <IntroContext.Provider value={clock}>
      <Levels focusLevel={null} levels={[0]} />
    </IntroContext.Provider>
  );
};
