import { useEffect, useMemo, useRef } from 'react';
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
import { LAYER } from '../kit/layers';
import { FloorMarker } from '../kit/markers';
import { noRaycast } from '../kit/noRaycast';
import { LastMoveLine } from '../kit/line';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { FRAME, MOTION, PALETTE } from './shared';

// Markers: targeting brackets flat on the glass, one family throughout, each
// drawn over a thin dark underlay so it holds on bright glass and frames.
// - A move: green brackets. Under the pointer they brighten, thicken and fill.
// - A capture: the same brackets in red, with teeth pointing in.
// - The last move: violet brackets on both squares (set a little wider, so
//   they nest round a move bracket on the same square), joined by a thin
//   dashed course, straight from square to square, whose dashes drift gently
//   toward the destination.
// - Check: bold red brackets, a ring and a short column of red light.
// - The selection is the one place with lively motion: a bezel that locks on
//   and sweeps like sonar, and a soft column of light through every level
//   with a small cross where it meets each platform, so the squares directly
//   above and below the piece are easy to find.

const { pitch } = FRAME;
const MAX_FRAME = 1 / 30;

// --- Brackets ----------------------------------------------------------------------

const markerVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const bracketFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uUnder;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uHalf;
  uniform float uLine;
  uniform float uRadius;
  uniform float uBracket;
  uniform float uTick;
  uniform float uCapture;
  uniform float uHover;
  uniform float uUnderWidth;
  uniform float uUnderAlpha;
  uniform float uBreath;
  varying vec2 vP;

  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  // Paints top over bottom (straight alpha)
  vec4 over(vec4 top, vec4 bottom) {
    float a = top.a + bottom.a * (1.0 - top.a);
    vec3 c = (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / max(a, 1e-4);
    return vec4(c, a);
  }

  void main() {
    vec2 q = abs(vP);
    float line = uLine * (1.0 + 0.4 * uHover);
    float box = roundBox(vP, uHalf, uRadius);
    // Corner brackets: the outline only where both coordinates near a corner
    float stroke = max(abs(box) - line * 0.5, uBracket - min(q.x, q.y));
    if (uCapture > 0.5) {
      // Teeth pointing in from the middle of each side: the same marker, as a target
      float t = min(
        segment(q, vec2(uHalf - uTick, 0.0), vec2(uHalf + line * 0.5, 0.0)),
        segment(q, vec2(0.0, uHalf - uTick), vec2(0.0, uHalf + line * 0.5))
      ) - line * 0.5;
      stroke = min(stroke, t);
    }
    float aa = max(fwidth(stroke), 1e-4);
    float core = 1.0 - smoothstep(-aa, aa, stroke);
    float under = 1.0 - smoothstep(-aa, aa, stroke - uUnderWidth);
    float ia = max(fwidth(box), 1e-4);
    float inside = 1.0 - smoothstep(-ia, ia, box);
    vec4 c = vec4(uColor, (uFill + 0.2 * uHover) * inside * uBreath);
    c = over(vec4(uUnder, under * uUnderAlpha), c);
    float strength = min(uOpacity * uBreath * (1.0 + 0.5 * uHover), 1.0);
    c = over(vec4(mix(uColor, vec3(1.0), 0.3 * uHover), core * strength), c);
    if (c.a < 0.003) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }`;

const markerPlanes = new Map<number, PlaneGeometry>();
const markerPlane = (size: number) => {
  let g = markerPlanes.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size);
    markerPlanes.set(size, g);
  }
  return g;
};

interface BracketStyle {
  color: string;
  opacity?: number;
  fill?: number;
  /** Distance of the outline inside the square's edge, as a fraction of the pitch. */
  inset?: number;
  /** Stroke width, as a fraction of the pitch. */
  lineWidth?: number;
  /** Length of each bracket's arms, as a fraction of the outline's half side. */
  bracketLength?: number;
  capture?: boolean;
  hovered?: boolean;
  /** Depth of a slow opacity breathe (0 = still). */
  breathe?: number;
  breathePeriod?: number;
}

// Every breathing bracket reads the same clock
const breathClock = { t: 0 };

/** Corner brackets flat on the floor of a square, over a thin dark underlay. */
const Brackets = ({
  floor,
  color,
  opacity = 0.95,
  fill = 0,
  inset = 0.1,
  lineWidth = 0.08,
  bracketLength = 0.5,
  capture = false,
  hovered = false,
  breathe = 0,
  breathePeriod = 2.8,
  lift = 0.012,
}: BracketStyle & { floor: Vec3; lift?: number }) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uColor: { value: new Color() },
          uUnder: { value: new Color(PALETTE.underlay) },
          uOpacity: { value: 1 },
          uFill: { value: 0 },
          uHalf: { value: 0.4 },
          uLine: { value: 0.08 },
          uRadius: { value: 0.05 },
          uBracket: { value: 0.2 },
          uTick: { value: 0.1 },
          uCapture: { value: 0 },
          uHover: { value: 0 },
          uUnderWidth: { value: 0.014 * pitch },
          uUnderAlpha: { value: 0.72 },
          uBreath: { value: 1 },
        },
        vertexShader: markerVertex,
        fragmentShader: bracketFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const line = lineWidth * pitch;
  const half = pitch / 2 - inset * pitch - line / 2;
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  u.uOpacity.value = opacity;
  u.uFill.value = fill;
  u.uHalf.value = half;
  u.uLine.value = line;
  u.uRadius.value = 0.06 * pitch;
  u.uBracket.value = half * (1 - bracketLength);
  u.uTick.value = 0.1 * pitch;
  u.uCapture.value = capture ? 1 : 0;
  u.uHover.value = hovered ? 1 : 0;
  useFrame((state) => {
    if (breathe <= 0) return;
    breathClock.t = state.clock.elapsedTime;
    const k = Math.cos((2 * Math.PI * breathClock.t) / breathePeriod);
    u.uBreath.value = 1 - breathe * 0.5 + breathe * 0.5 * k;
    invalidate();
  });
  return (
    <mesh
      geometry={markerPlane(pitch)}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

const MOVE = { color: PALETTE.move, inset: 0.1, lineWidth: 0.08, bracketLength: 0.5 };

export const Quiet = ({ floor, hovered }: MarkerProps) => (
  <Brackets floor={floor} {...MOVE} fill={0.04} hovered={hovered} />
);

export const Capture = ({ floor, hovered }: MarkerProps) => (
  <Brackets floor={floor} {...MOVE} color={PALETTE.capture} fill={0.08} capture hovered={hovered} />
);

// --- Selection -------------------------------------------------------------------

const bezelVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// A bezel: a solid ring with notches at the compass points reaching in and
// out through a dashed outer ring that turns slowly, and inside it a sonar
// sweep going round over a pool of light.
const bezelFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTurn;
  uniform float uSweep;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float ang = atan(vP.y, vP.x);
    float fr = max(fwidth(r), 1e-4);
    float ring = 1.0 - smoothstep(0.024 - fr, 0.024 + fr, abs(r - 0.355));
    // Notches at the compass points, from inside the ring out past the dashes
    vec2 q = abs(vP);
    float across = min(q.x, q.y);
    float notch = (1.0 - smoothstep(0.018 - fr, 0.018 + fr, across))
      * smoothstep(0.25 - fr, 0.25 + fr, r) * (1.0 - smoothstep(0.49 - fr, 0.49 + fr, r));
    // Dashed outer ring
    float a = ang + uTurn;
    float dash = step(0.45, fract(a / 6.2831853 * 28.0));
    float outer = (1.0 - smoothstep(0.014 - fr, 0.014 + fr, abs(r - 0.44))) * dash;
    float pool = exp(-r * r / 0.06) * 0.42;
    // The sweep: bright at the beam, fading round behind it
    float behind = fract((uSweep - ang) / 6.2831853);
    float sweep = exp(-behind * 7.0) * 0.5 * (1.0 - smoothstep(0.32, 0.345, r));
    pool = max(pool, sweep);
    float s = max(max(ring, notch), outer * 0.85);
    float alpha = max(s, pool) * uAlpha;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(uColor * (1.0 + 0.25 * s), alpha);
    #include <colorspace_fragment>
  }`;

const bezelPlane = new PlaneGeometry(1, 1);

// A column of light through every level: a soft additive glow, brightest down
// its middle and round the selected piece, gone at the top and bottom.
const columnVertex = /* glsl */ `
  varying float vY;
  varying float vFace;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vY = w.y;
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vFace = abs(dot(n, normalize(cameraPosition - w.xyz)));
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const columnFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uHome;
  uniform float uBottom;
  uniform float uTop;
  uniform float uGrow;
  varying float vY;
  varying float vFace;
  void main() {
    // Grows up and down from the selected level
    float reach = uGrow * (uTop - uBottom);
    if (abs(vY - uHome) > reach) discard;
    float ends = smoothstep(uBottom, uBottom + 1.2, vY) * (1.0 - smoothstep(uTop - 1.6, uTop, vY));
    // Brightest round the piece itself
    float home = exp(-abs(vY - uHome - 0.35) * 1.8);
    // Soft sides: light gathers down the middle, never a hard vertical edge
    float soft = vFace * vFace;
    float a = (0.07 + 0.14 * home) * soft * ends * uAlpha;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

// A small cross where the column meets each other platform: the square
// directly above or below the piece, marked without looking like a move.
const crossFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vP;
  void main() {
    vec2 q = abs(vP);
    float d = max(min(q.x, q.y) - 0.012, max(q.x, q.y) - 0.1);
    float aa = max(fwidth(d), 1e-4);
    float a = (1.0 - smoothstep(-aa, aa, d)) * uAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const COLUMN_RADIUS = 0.3;
const columnBottom = FRAME.levelY[0] - 0.4;
const columnTop = FRAME.levelY[4] + 1.5;
const columnGeometry = new CylinderGeometry(1, 1, 1, 32, 1, true);
const crossPlane = new PlaneGeometry(0.3, 0.3);

const INTRO = 0.26; // seconds for the lock-on

/** The selected piece: a bezel that locks on, a column of light, and its square on every other level. */
export const Selection = ({ floor }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const bezel = useRef<Group>(null);
  const t = useRef(0);
  const { bezelMaterial, columnMaterial, crossMaterial } = useMemo(
    () => ({
      bezelMaterial: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uColor: { value: new Color(PALETTE.select) },
          uAlpha: { value: 0 },
          uTurn: { value: 0 },
          uSweep: { value: 0 },
        },
        vertexShader: bezelVertex,
        fragmentShader: bezelFragment,
      }),
      columnMaterial: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color(PALETTE.select) },
          uAlpha: { value: 0 },
          uHome: { value: 0 },
          uBottom: { value: columnBottom },
          uTop: { value: columnTop },
          uGrow: { value: 0 },
        },
        vertexShader: columnVertex,
        fragmentShader: columnFragment,
      }),
      crossMaterial: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: { uColor: { value: new Color(PALETTE.select) }, uAlpha: { value: 0 } },
        vertexShader: markerVertex,
        fragmentShader: crossFragment,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      bezelMaterial.dispose();
      columnMaterial.dispose();
      crossMaterial.dispose();
    },
    [bezelMaterial, columnMaterial, crossMaterial],
  );
  columnMaterial.uniforms.uHome.value = floor[1];
  // A new selection locks on afresh (Board passes a fresh array every render)
  const where = floor.join(',');
  useEffect(() => {
    t.current = 0;
    invalidate();
  }, [where, invalidate]);

  useFrame((_, delta) => {
    t.current += Math.min(delta, MAX_FRAME);
    const k = Math.min(t.current / INTRO, 1);
    // Lock-on: in from wide with a little overshoot, then a slow turn
    const back = 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;
    const g = bezel.current;
    if (g) g.scale.setScalar(pitch * (1.9 - 0.9 * back));
    bezelMaterial.uniforms.uAlpha.value = Math.min(k * 1.6, 1);
    bezelMaterial.uniforms.uTurn.value = t.current * 0.35;
    bezelMaterial.uniforms.uSweep.value = t.current * 2.1;
    columnMaterial.uniforms.uAlpha.value = Math.min(k * 1.2, 1);
    columnMaterial.uniforms.uGrow.value = Math.min(t.current / 0.45, 1);
    crossMaterial.uniforms.uAlpha.value = 0.3 * Math.min(Math.max(t.current - 0.15, 0) / 0.3, 1);
    invalidate();
  });

  const others = FRAME.levelY.filter((y) => Math.abs(y - floor[1]) > 0.01);
  return (
    <>
      <group ref={bezel} position={[floor[0], floor[1] + 0.014, floor[2]]}>
        <mesh
          geometry={bezelPlane}
          material={bezelMaterial}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={LAYER.marker}
          raycast={noRaycast}
        />
      </group>
      <mesh
        geometry={columnGeometry}
        material={columnMaterial}
        position={[floor[0], (columnBottom + columnTop) / 2, floor[2]]}
        scale={[COLUMN_RADIUS, columnTop - columnBottom, COLUMN_RADIUS]}
        renderOrder={LAYER.trace}
        raycast={noRaycast}
      />
      {others.map((y) => (
        <mesh
          key={y}
          geometry={crossPlane}
          material={crossMaterial}
          position={[floor[0], y + 0.012, floor[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={LAYER.marker}
          raycast={noRaycast}
        />
      ))}
    </>
  );
};

// --- Last move ---------------------------------------------------------------------

const LAST = { color: PALETTE.lastMove, inset: 0.03, lineWidth: 0.07, bracketLength: 0.42 };

/**
 * The last move: violet brackets on both squares and the course plotted
 * between them, a thin dashed line straight from square to square whose
 * dashes, bright at their fronts, drift gently toward the destination. A
 * live move's course is plotted as the piece lands (its own streak of light
 * flies the path first): the brackets lock on and the line shoots from source
 * to target. A replayed or rejoined move is simply there.
 */
export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => {
  const group = useRef<Group>(null);
  const since = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const land = MOTION.durationMs * 0.8;
  useEffect(() => {
    if (fresh) invalidate();
  }, [fresh, invalidate]);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g || g.visible) return;
    since.current += Math.min(delta, MAX_FRAME) * 1000;
    g.visible = since.current >= land;
    invalidate();
  });
  return (
    <>
      <group ref={group} visible={!fresh}>
        <Brackets floor={from.floor} {...LAST} opacity={0.75} fill={0.04} />
        <Brackets floor={to.floor} {...LAST} opacity={1} fill={0.06} />
      </group>
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={PALETTE.lastMove}
        pulseColor={PALETTE.lastMoveGlint}
        pattern="dashed"
        radius={0.018}
        spacing={0.2}
        dash={0.62}
        pulse={0.85}
        flowSpeed={0.3}
        drawInMs={fresh ? 260 : 0}
        drawInDelayMs={land}
      />
    </>
  );
};

// --- Check ---------------------------------------------------------------------------

const beaconGeometry = new CylinderGeometry(1, 1, 1, 32, 1, true);
const CHECK_PERIOD = 2.8;

/** A short red column of light standing on the checked king's square, breathing slowly. */
const CheckBeacon = ({ floor }: { floor: MarkerProps['floor'] }) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: { uColor: { value: new Color(PALETTE.check) }, uBreath: { value: 1 } },
        vertexShader: /* glsl */ `
          varying float vH;
          varying float vRim;
          void main() {
            vH = uv.y;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vec3 n = normalize(mat3(modelMatrix) * normal);
            vRim = 1.0 - abs(dot(n, normalize(cameraPosition - w.xyz)));
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uBreath;
          varying float vH;
          varying float vRim;
          void main() {
            float a = pow(1.0 - vH, 1.4) * (0.25 + 0.75 * vRim) * 0.55 * uBreath;
            gl_FragColor = vec4(uColor, a);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    material.uniforms.uBreath.value = 0.8 + 0.2 * Math.cos((2 * Math.PI * t) / CHECK_PERIOD);
    invalidate();
  });
  return (
    <mesh
      geometry={beaconGeometry}
      material={material}
      position={[floor[0], floor[1] + 0.55, floor[2]]}
      scale={[0.4, 1.1, 0.4]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
    />
  );
};

/**
 * A king in check: bold red brackets round its square, a ring at its base
 * and a short column of red light, all breathing slowly together.
 */
export const Check = ({ floor }: MarkerProps) => (
  <>
    <CheckBeacon floor={floor} />
    <Brackets
      floor={floor}
      color={PALETTE.check}
      opacity={1}
      fill={0.14}
      inset={0.03}
      lineWidth={0.09}
      bracketLength={0.5}
      breathe={0.3}
      breathePeriod={CHECK_PERIOD}
    />
    <FloorMarker
      floor={floor}
      pitch={pitch}
      shape="ring"
      color={PALETTE.check}
      opacity={0.9}
      lineWidth={0.045}
      ringRadius={0.4}
      breathe={0.3}
      breathePeriod={CHECK_PERIOD}
    />
  </>
);
