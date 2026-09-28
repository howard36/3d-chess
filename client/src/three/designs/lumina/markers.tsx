import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { claim, claimAt, mate } from './claims';
import { HEX, LEVEL_COLORS, LIFT, MOTION, PALETTE, PIECE_SCALE, levelAt } from './palette';
import { HEXAGON_SDF } from './pieces';
import { leads, steepness } from './plates';

// The marker language: light projected onto the pane, every mark a hexagon,
// the shape every piece stands in. Each is one quad shaded by signed
// distances, crisp at any angle and distance.
//
// - A legal move: a soft gold hexagon, a little smaller than a piece's, with
//   a slight gold fill and a small hexagon of the level's colour at its
//   heart. Under the pointer it grows a little and its fill gathers weight
//   and depth (eased, never a jump); its outline does not brighten.
// - A capture: the same hexagon in coral, taking over the victim's own
//   hexagon (the piece's steps aside, claims.ts, so no two outlines stack),
//   with one small mote of light travelling slowly round its rim.
// - The selection: the projector's cone of light and the hexagon's spark
//   (pieces.tsx). The marker itself only says where the held piece is.
// - The last move: an ice hexagon round the piece where it landed (again
//   taking over the piece's own), the same hexagon smaller where it left,
//   and a thin ice line between them with a slow flow.
// - Check: the king's hexagon turns to a platform of red light edged with
//   small teeth, breathing, and a crown of red light floats over the king,
//   turning very slowly. Check arrives with one strong pulse outward.

const MODE = { quiet: 0, capture: 1, trace: 2, check: 3, wave: 4 } as const;
type Mode = keyof typeof MODE;

const vertexShader = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform int uMode;
  uniform vec3 uColor;
  uniform vec3 uFillColor;
  uniform vec3 uGem;
  uniform float uGemR;
  uniform float uR;
  uniform float uWidth;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uHover;
  uniform float uTime;
  uniform float uPhase;
  uniform float uPulse;
  uniform float uShow;
  varying vec2 vP;
  ${HEXAGON_SDF}
  // A hexagon with softly rounded corners
  float softHex(vec2 p, float r, float round) {
    return hexagon(p, r - round) - round;
  }
  float cover(float d, float fw) {
    return 1.0 - smoothstep(-fw, fw, d);
  }
  // A thin stroke on the zero of d, never thinner than about a pixel (it
  // fades instead)
  float stroke(float d, float w) {
    float fw = max(fwidth(d), 1e-5);
    float draw = max(w, fw * 0.8);
    return (1.0 - smoothstep(draw - fw, draw + fw, abs(d))) * min(w / draw, 1.0);
  }
  // The hexagon's boundary radius at angle a (flat sides facing +-y)
  float hexRadius(float a, float r) {
    float k = floor((a - 0.5235988) / 1.0471976 + 0.5);
    float n = 0.5235988 + k * 1.0471976;
    return r / cos(a - n);
  }

  void main() {
    // The quad lies flat; its y is the board's -z. Flat sides face the ranks.
    vec2 p = vP;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float R = uR * (1.0 + 0.12 * uHover);
    float d = softHex(p, R, R * 0.12);
    float fw = max(fwidth(d), 1e-5);
    float inside = cover(d, fw);
    vec3 col = uColor;
    float a = 0.0;

    if (uMode == 0 || uMode == 1) {
      // The outline, steady under the pointer
      float line = stroke(d, uWidth);
      float halo = exp(-max(d, 0.0) * max(d, 0.0) / (0.03 * 0.03)) * 0.25 * (1.0 - inside);
      // The fill: slight at rest, gathered toward the rim like light caught
      // in glass; under the pointer it gains weight and reaches in
      float depth = mix(0.45, 1.0, smoothstep(0.0, R, r * (1.0 - 0.4 * uHover)));
      float fill = inside * uFill * (1.0 + 2.4 * uHover) * depth;
      float lineA = max(line * 0.9, halo) * uOpacity;
      a = lineA + fill * (1.0 - lineA);
      col = (uColor * lineA + uFillColor * fill * (1.0 - lineA)) / max(a, 1e-4);
      // The level's own colour at the heart: a small hexagon of it
      float gd = hexagon(p, uGemR * (1.0 + 0.12 * uHover));
      float gem = cover(gd, max(fwidth(gd), 1e-5)) * step(1e-4, uGemR) * 0.95;
      float ga = gem + a * (1.0 - gem);
      col = (uGem * gem + col * a * (1.0 - gem)) / max(ga, 1e-4);
      a = ga;
      if (uMode == 1) {
        // One small mote of light travelling slowly round the rim, a short
        // tail of light behind it
        float ma = uTime * 1.3 + uPhase;
        float mr = hexRadius(mod(ma, 6.2831853), R) - R * 0.02;
        vec2 m = mr * vec2(cos(ma), sin(ma));
        float md = length(p - m);
        float mote = exp(-md * md / (0.022 * 0.022));
        float behind = mod(ma - ang, 6.2831853);
        float tail = line * exp(-behind / 0.7) * 0.9;
        float l = max(mote, tail);
        col = mix(col, vec3(1.0, 0.93, 0.85), clamp(l / max(a + l, 1e-4), 0.0, 1.0));
        a = a + l * (1.0 - a);
      }
    } else if (uMode == 2) {
      // The last move's hexagon: a crisp ice outline, a faint fill
      float line = stroke(d, uWidth);
      float halo = exp(-d * d / (0.035 * 0.035)) * 0.2;
      a = (max(line, halo) + inside * uFill) * uOpacity;
    } else if (uMode == 3) {
      // Check: a platform of red light in the king's hexagon, its edge set
      // with small teeth; the teeth and the light breathe
      float breath = 0.5 + 0.5 * sin(6.2831853 * uTime / 2.8);
      float hd = hexagon(p, R);
      float b = hexRadius(ang < 0.0 ? ang + 6.2831853 : ang, R);
      // A saw edge: teeth side by side all round, three to a side, so the
      // hexagon and its teeth are one figure
      float teeth = 1.0 - abs(fract(ang / 6.2831853 * 18.0) - 0.5) * 2.0;
      float reach = (0.045 + 0.02 * breath) * teeth;
      float sd = r - b - reach;
      float sfw = max(fwidth(sd), 1e-4);
      float spike = step(b - 0.01, r) * (1.0 - smoothstep(-sfw, sfw, sd)) * (0.55 + 0.45 * teeth);
      float line = stroke(hd, uWidth);
      float halo = exp(-max(hd, 0.0) * max(hd, 0.0) / (0.05 * 0.05)) * (0.25 + 0.15 * breath);
      float fill = cover(hd, fw) * (0.16 + 0.08 * breath + 0.5 * uPulse);
      a = max(max(line, spike), max(halo, fill)) * uOpacity;
    } else {
      // Check's arrival: one strong wave of red light running outward
      float w = abs(hexagon(p, R));
      a = exp(-w * w / (0.055 * 0.055)) * uOpacity;
    }
    a *= uShow;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const plane = new PlaneGeometry(1.2, 1.2);
const wavePlane = new PlaneGeometry(2.4, 2.4);

interface MarkOptions {
  mode: Mode;
  color: string;
  fillColor?: string;
  /** The level cue at the heart: a small hexagon of this colour, `gemRadius` across. */
  gem?: string;
  gemRadius?: number;
  radius: number;
  width?: number;
  opacity?: number;
  fill?: number;
  phase?: number;
  additive?: boolean;
}

const makeMark = (o: MarkOptions) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: o.additive ? AdditiveBlending : undefined,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uMode: { value: MODE[o.mode] },
      uColor: { value: new Color(o.color) },
      uFillColor: { value: new Color(o.fillColor ?? o.color) },
      uGem: { value: new Color(o.gem ?? o.color) },
      uGemR: { value: o.gemRadius ?? 0 },
      uR: { value: o.radius },
      uWidth: { value: o.width ?? 0.0065 },
      uOpacity: { value: o.opacity ?? 1 },
      uFill: { value: o.fill ?? 0 },
      uHover: { value: 0 },
      uTime: { value: 0 },
      uPhase: { value: o.phase ?? 0 },
      uPulse: { value: 0 },
      uShow: { value: 1 },
    },
    vertexShader,
    fragmentShader,
  });

/** One mark's own material, made once for the life of the marker. */
const useMark = (o: MarkOptions) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one material per marker
  const m = useMemo(() => makeMark(o), []);
  useEffect(() => () => m.dispose(), [m]);
  return m;
};

const Flat = ({
  at,
  material,
  lift = 0.012,
  geometry = plane,
  order = LAYER.marker,
}: {
  at: Vec3;
  material: ShaderMaterial;
  lift?: number;
  geometry?: PlaneGeometry;
  order?: number;
}) => (
  <mesh
    geometry={geometry}
    material={material}
    position={[at[0], at[1] + lift, at[2]]}
    rotation={[-Math.PI / 2, 0, 0]}
    renderOrder={order}
    raycast={noRaycast}
  />
);

const HOVER_MS = 200;
const ease = (x: number) => x * x * (3 - 2 * x);

/** Eases a mark's hover weight toward `hovered` over HOVER_MS, on r3f's clock. */
const useHover = (material: ShaderMaterial, hovered: boolean) => {
  const invalidate = useThree((s) => s.invalidate);
  const k = useRef(0);
  useEffect(() => invalidate(), [hovered, invalidate]);
  useFrame((_, delta) => {
    const goal = hovered ? 1 : 0;
    if (k.current === goal) return;
    const step = (Math.min(delta, 1 / 20) * 1000) / HOVER_MS;
    k.current =
      goal > k.current ? Math.min(goal, k.current + step) : Math.max(goal, k.current - step);
    material.uniforms.uHover.value = ease(k.current);
    invalidate();
  });
};

// --- Where the held piece is --------------------------------------------------------------

/** The held piece's floor, while one is held. */
const held = { at: null as Vec3 | null };

/** Whether `floor` lies straight above or below the held piece. */
const overHeld = (floor: Vec3) =>
  !!held.at &&
  Math.abs(held.at[0] - floor[0]) < 0.05 &&
  Math.abs(held.at[2] - floor[2]) < 0.05 &&
  Math.abs(held.at[1] - floor[1]) > 0.1;

/** The selection's light is the piece's own (pieces.tsx); the marker says where it is. */
export const Selection = ({ floor }: MarkerProps) => {
  const [x, y, z] = floor;
  useLayoutEffect(() => {
    const at: Vec3 = [x, y, z];
    held.at = at;
    return () => {
      if (held.at === at) held.at = null;
    };
  }, [x, y, z]);
  return null;
};

// --- Destinations -------------------------------------------------------------------------

const QUIET_R = 0.225;

/**
 * A mark that quietens from high above when it is off the level in play: a
 * little smaller, so the same square on two levels nests as two hexagons,
 * and, straight above or below the held piece, a little wider, so from
 * above it shows round the piece instead of under it.
 */
const useNesting = (material: ShaderMaterial, floor: Vec3, radius: number, stackable: boolean) => {
  const level = levelAt(floor[1]);
  useFrame(() => {
    const s = steepness.value;
    const lead = leads[level].value;
    const k = stackable && overHeld(floor) ? 1 + 0.45 * s : 1 - 0.15 * s * (1 - lead);
    const r = radius * k;
    if (material.uniforms.uR.value !== r) material.uniforms.uR.value = r;
  });
};

export const Quiet = ({ floor, hovered = false }: MarkerProps) => {
  const level = levelAt(floor[1]);
  const material = useMark({
    mode: 'quiet',
    color: PALETTE.move,
    gem: LEVEL_COLORS[level],
    gemRadius: 0.055,
    radius: QUIET_R,
    width: 0.008,
    opacity: 0.8,
    fill: 0.1,
  });
  useHover(material, hovered);
  useNesting(material, floor, QUIET_R, true);
  return <Flat at={floor} material={material} />;
};

export const Capture = ({ floor, hovered = false }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMark({
    mode: 'capture',
    color: PALETTE.capture,
    radius: HEX,
    width: 0.01,
    opacity: 0.95,
    fill: 0.12,
    phase: (floor[0] * 1.7 + floor[2] * 2.3 + floor[1]) % 6.28,
  });
  useHover(material, hovered);
  useNesting(material, floor, HEX, false);
  const [x, y, z] = floor;
  useLayoutEffect(() => claim('capture', [x, y, z]), [x, y, z]);
  // The mote travels on r3f's clock
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    invalidate();
  });
  return <Flat at={floor} material={material} />;
};

// --- The last move ------------------------------------------------------------------------

const LEFT_R = 0.17;

export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const left = useMark({
    mode: 'trace',
    color: PALETTE.trace,
    radius: LEFT_R,
    width: 0.009,
    opacity: 0.8,
    fill: 0.06,
  });
  const arrived = useMark({
    mode: 'trace',
    color: PALETTE.trace,
    radius: HEX,
    width: 0.011,
    opacity: 0.9,
    fill: 0.06,
  });
  const [x, y, z] = to.floor;
  // The arrival takes over the moved piece's own hexagon
  useLayoutEffect(() => claim('arrived', [x, y, z]), [x, y, z]);
  // A live move lights its arrival as the piece lands; either hexagon gives
  // way to a capture marker on its square (the capture's hexagon is the one)
  const elapsed = useRef(fresh ? 0 : Infinity);
  const shows = useRef([1, 1]);
  const delay = MOTION.durationMs * 0.75;
  useFrame((_, delta) => {
    elapsed.current += Math.min(delta, 1 / 8) * 1000;
    const t = Math.min(Math.max((elapsed.current - delay) / 220, 0), 1);
    const land = fresh ? t : 1;
    let moving = land < 1;
    [left, arrived].forEach((m, i) => {
      const f = i === 0 ? from.floor : to.floor;
      const goal = claimAt(f[0], f[1], f[2], 'capture') ? 0 : 1;
      const s = shows.current[i];
      const next = goal > s ? Math.min(goal, s + 0.1) : Math.max(goal, s - 0.1);
      shows.current[i] = next;
      if (next !== goal) moving = true;
      m.uniforms.uShow.value = next * (i === 1 ? land : 1);
    });
    if (moving) invalidate();
  });
  return (
    <>
      <Flat at={from.floor} material={left} />
      <Flat at={to.floor} material={arrived} />
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={PALETTE.trace}
        pulseColor="#ffffff"
        opacity={0.8}
        radius={0.011}
        pattern="solid"
        pulse={0.55}
        pulseLength={0.4}
        spacing={1.6}
        flowSpeed={0.35}
        shade={0.3}
        drawInMs={fresh ? 380 : 0}
      />
    </>
  );
};

// --- Check --------------------------------------------------------------------------------

// The crown: a short open band of red light with eight tines, floating over
// the king, turning very slowly. Drawn by its shader on an open cylinder.
const CROWN_R = 0.11;
const CROWN_H = 0.085;
const crownGeometry = new CylinderGeometry(CROWN_R, CROWN_R * 0.92, CROWN_H, 64, 1, true).translate(
  0,
  CROWN_H / 2,
  0,
);

const crownVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const crownFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFlash;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    // Eight tines rising from a band
    float t = 1.0 - abs(fract(vUv.x * 8.0) - 0.5) * 2.0;
    float top = 0.38 + 0.62 * pow(t, 1.6);
    float y = vUv.y;
    float fy = max(fwidth(y), 1e-4);
    float inside = 1.0 - smoothstep(top - fy, top + fy, y);
    // Its edges bright, its body a soft glow
    float edge = exp(-pow((top - y) / 0.06, 2.0)) + exp(-pow(y / 0.07, 2.0));
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vNormal), v));
    float body = 0.25 + 0.35 * (1.0 - facing);
    float a = inside * (body + 0.9 * edge) * uOpacity * (1.0 + uFlash);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const KING_TOP = pieceTop(pieceSet(), PieceType.King) * PIECE_SCALE;
/** Over the king's cross, clear of it even held up. */
const CROWN_Y = KING_TOP + LIFT.selected * PIECE_SCALE + 0.07;

const PULSE_MS = 700;

export const Check = ({ floor }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const platform = useMark({
    mode: 'check',
    color: PALETTE.check,
    radius: HEX,
    width: 0.011,
    opacity: 0.95,
  });
  const wave = useMark({
    mode: 'wave',
    color: PALETTE.check,
    radius: HEX,
    opacity: 0,
    additive: true,
  });
  const crown = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.check) },
          uOpacity: { value: 0 },
          uFlash: { value: 0 },
        },
        vertexShader: crownVertex,
        fragmentShader: crownFragment,
      }),
    [],
  );
  useEffect(() => () => crown.dispose(), [crown]);
  const spin = useRef<Group>(null);
  const [x, y, z] = floor;
  useLayoutEffect(() => claim('check', [x, y, z]), [x, y, z]);
  // Check arrives (or moves to another king's square) with one pulse
  const since = useRef(0);
  const time = useRef(0);
  const fall = useRef(mate.over ? 1 : 0);
  useEffect(() => {
    since.current = 0;
    invalidate();
  }, [x, y, z, invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 8);
    since.current += dt * 1000;
    // At mate the crown sinks away with the king, and the platform holds still
    if (mate.over) fall.current = Math.min(1, fall.current + dt / 0.6);
    else time.current += dt;
    const settled = fall.current >= 1 && since.current > PULSE_MS;
    const f = 1 - (1 - fall.current) ** 2;
    const t = Math.min(since.current / PULSE_MS, 1);
    const e = 1 - (1 - t) ** 3;
    const w = wave.uniforms;
    w.uR.value = HEX * (1 + 1.5 * e);
    w.uOpacity.value = t < 1 ? 1.8 * (1 - t) ** 1.3 : 0;
    const p = platform.uniforms;
    p.uTime.value = time.current;
    p.uPulse.value = (1 - t) ** 2;
    // The crown drops in, flashes, and settles; then turns very slowly
    const c = Math.min(since.current / 450, 1);
    crown.uniforms.uOpacity.value = 0.75 * (1 - (1 - c) ** 2) * (1 - f);
    crown.uniforms.uFlash.value = 1.2 * (1 - t) ** 2;
    if (spin.current) {
      spin.current.rotation.y = time.current * 0.25;
      spin.current.position.y =
        (CROWN_Y + 0.08 * (1 - c) ** 2 + 0.006 * Math.sin(time.current * 1.6)) * (1 - 0.7 * f);
      spin.current.visible = f < 1;
    }
    if (!settled) invalidate();
  });
  return (
    <>
      <Flat at={floor} material={platform} lift={0.013} />
      <Flat at={floor} material={wave} lift={0.015} geometry={wavePlane} order={LAYER.trace} />
      <group position={floor}>
        <group ref={spin} position={[0, CROWN_Y, 0]}>
          <mesh
            geometry={crownGeometry}
            material={crown}
            renderOrder={LAYER.trace}
            raycast={noRaycast}
          />
        </group>
      </group>
    </>
  );
};
