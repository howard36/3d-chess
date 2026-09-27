import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { LAYER } from './layers';
import { markerMetrics, ribbonData, SHAPE_ID, tracePath } from './markerGeometry';
import type { MarkerMetricsOptions, MarkerShape, TracePathOptions } from './markerGeometry';
import { noRaycast } from './noRaycast';
import type { ComponentType } from 'react';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';

// Markers that lie flat on a platform, where a piece stands, instead of
// floating in the cell: a legal destination, a capture (the same marker with a
// capture cue), the selection, the check, and the last move's squares joined
// by a trace with an arrowhead. Each is one quad shaded by a signed-distance
// function, so strokes stay crisp and antialiased at any angle and any
// distance, even under a software renderer. They are drawn after every
// platform (see LAYER), so they read through the platforms above them.

export type { MarkerShape } from './markerGeometry';

export interface FloorMarkerStyle extends MarkerMetricsOptions {
  shape?: MarkerShape;
  color?: string;
  /** Stroke opacity. */
  opacity?: number;
  /** Opacity of a faint fill inside the outline (0 for none). */
  fill?: number;
  /** Add the capture cue: `captureColor` and four inward ticks. */
  capture?: boolean;
  captureColor?: string;
  /** Brighten, as under the pointer. */
  hovered?: boolean;
  /**
   * Depth of a very slow opacity breathe (0 = static). Anything but 0 keeps
   * the frame loop running while the marker is up.
   */
  breathe?: number;
  /** Seconds per breath. */
  breathePeriod?: number;
  /** Height above the floor (keeps it off the platform surface). */
  lift?: number;
}

const markerVertex = /* glsl */ `
  varying vec2 vP;
  uniform float uQuad;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const markerFragment = /* glsl */ `
  uniform int uShape;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uHalf;
  uniform float uLine;
  uniform float uRing;
  uniform float uDot;
  uniform float uRadius;
  uniform float uBracket;
  uniform float uTick;
  uniform float uCapture;
  uniform float uHover;
  uniform float uBreathe;
  uniform float uPeriod;
  uniform float uTime;
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

  void main() {
    vec2 p = vP;
    vec2 q = abs(p);
    float stroke;   // signed distance to the stroke (negative inside it)
    float inside;   // signed distance to the area the outline encloses
    float edge;     // where the capture ticks start from
    if (uShape == 2) {
      stroke = abs(length(p) - uRing) - uLine * 0.5;
      inside = length(p) - uRing;
      edge = uRing;
    } else if (uShape == 3) {
      stroke = length(p) - uDot;
      inside = stroke;
      edge = uRing;
    } else {
      float box = roundBox(p, uHalf, uRadius);
      stroke = abs(box) - uLine * 0.5;
      inside = box;
      edge = uHalf;
      if (uShape == 1) {
        // Corner brackets: the outline, only where both coordinates are
        // near a corner
        stroke = max(stroke, uBracket - min(q.x, q.y));
      }
    }
    if (uCapture > 0.5) {
      float t;
      if (uShape == 2) {
        // A capture ring: four ticks pointing out toward the corners, so the
        // cue shows round the victim's base rather than under it
        vec2 d = vec2(0.70710678);
        float r = edge + uLine * 0.5;
        t = segment(q, d * r, d * (r + uTick)) - uLine * 0.5;
      } else {
        // Four ticks pointing inward from the middle of each side: the same
        // marker, turned into a target
        t = min(
          segment(q, vec2(edge - uTick, 0.0), vec2(edge + uLine * 0.5, 0.0)),
          segment(q, vec2(0.0, edge - uTick), vec2(0.0, edge + uLine * 0.5))
        ) - uLine * 0.5;
      }
      stroke = min(stroke, t);
    }
    float aa = max(fwidth(stroke), 1e-4);
    float line = 1.0 - smoothstep(-aa, aa, stroke);
    float ia = max(fwidth(inside), 1e-4);
    float area = 1.0 - smoothstep(-ia, ia, inside);
    float breath = 1.0 - uBreathe * 0.5 + uBreathe * 0.5 * cos(6.2831853 * uTime / uPeriod);
    float strength = uOpacity * breath * (1.0 + 0.45 * uHover);
    float fill = (uFill + 0.12 * uHover) * breath;
    float a = max(line * strength, area * fill);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * (1.0 + 0.25 * uHover), min(a, 1.0));
    #include <colorspace_fragment>
  }`;

// One plane serves every marker: markers of a design share one pitch.
const planes = new Map<number, PlaneGeometry>();
const planeFor = (size: number) => {
  let g = planes.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size);
    planes.set(size, g);
  }
  return g;
};

// Every breathing marker reads the same clock
const clock = { value: 0 };

/**
 * A flat marker lying on the platform at a cell's floor: an inset
 * rounded-square outline, corner brackets, a ring where a piece stands, or a
 * dot. `capture` composes the capture cue onto the same shape; `hovered`
 * brightens it. Static unless `breathe` is set.
 */
export const FloorMarker = ({
  floor,
  pitch = 1,
  shape = 'square',
  color = '#ffd166',
  opacity = 0.85,
  fill = 0,
  capture = false,
  captureColor = '#ff6b5e',
  hovered = false,
  breathe = 0,
  breathePeriod = 3.2,
  lift = 0.012,
  ...metricsOptions
}: FloorMarkerStyle & { floor: Vec3; pitch?: number }) => {
  const m = markerMetrics(pitch, metricsOptions);
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
          uShape: { value: 0 },
          uColor: { value: new Color() },
          uOpacity: { value: 1 },
          uFill: { value: 0 },
          uQuad: { value: 1 },
          uHalf: { value: 0.4 },
          uLine: { value: 0.06 },
          uRing: { value: 0.34 },
          uDot: { value: 0.1 },
          uRadius: { value: 0.1 },
          uBracket: { value: 0.2 },
          uTick: { value: 0.1 },
          uCapture: { value: 0 },
          uHover: { value: 0 },
          uBreathe: { value: 0 },
          uPeriod: { value: 3 },
          uTime: clock,
        },
        vertexShader: markerVertex,
        fragmentShader: markerFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const u = material.uniforms;
  u.uShape.value = SHAPE_ID[shape];
  (u.uColor.value as Color).set(capture ? captureColor : color);
  u.uOpacity.value = opacity;
  u.uFill.value = fill;
  u.uQuad.value = m.quad;
  u.uHalf.value = m.half;
  u.uLine.value = m.lineWidth;
  const captureRing = capture && shape === 'ring';
  u.uRing.value = captureRing ? m.captureRing : m.ringRadius;
  u.uDot.value = m.dotRadius;
  u.uRadius.value = m.cornerRadius;
  u.uBracket.value = m.bracketStart;
  u.uTick.value = captureRing ? m.captureTick : m.tickLength;
  u.uCapture.value = capture ? 1 : 0;
  u.uHover.value = hovered ? 1 : 0;
  u.uBreathe.value = breathe;
  u.uPeriod.value = breathePeriod;

  useFrame((state) => {
    if (breathe <= 0) return;
    clock.value = state.clock.elapsedTime;
    invalidate();
  });

  return (
    <mesh
      geometry={planeFor(m.quad)}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

export interface TraceStyle extends TracePathOptions {
  color?: string;
  /** Colour of the thin outline that keeps the trace legible on any background. */
  edgeColor?: string;
  opacity?: number;
  /** Full width of the trace (world units). */
  width?: number;
  headLength?: number;
  headWidth?: number;
  /** Chevrons along the trace pointing the way the piece went (0 for none). */
  chevrons?: number;
  /** Speed the chevrons drift toward the destination, world units a second (0 = still). */
  flowSpeed?: number;
  /**
   * Draw the trace in from its source over this long when it mounts (0 = all
   * at once). Pass it only for a fresh move (LastMoveMarkerProps.fresh), so
   * a replayed or rejoined game shows the trace whole.
   */
  drawInMs?: number;
}

const traceVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aHalf;
  attribute float aAlong;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 t = normalize(mat3(modelMatrix) * aTangent);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec3 across = cross(t, toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(1.0, 0.0, 0.0);
    world.xyz += across * aSide * aHalf;
    vAcross = aSide * aHalf;
    vHalf = aHalf;
    vAlong = aAlong;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const traceFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uOpacity;
  uniform float uEdgeWidth;
  uniform float uChevron;
  uniform float uShaftEnd;
  uniform float uFlow;
  uniform float uTime;
  uniform float uReveal;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  void main() {
    if (vAlong > uReveal) discard;
    float d = abs(vAcross);
    float aa = max(fwidth(vAcross), 1e-4);
    float body = 1.0 - smoothstep(vHalf - aa, vHalf + aa * 0.5, d);
    float rim = smoothstep(vHalf - uEdgeWidth - aa, vHalf - uEdgeWidth + aa, d);
    vec3 col = uColor;
    if (uChevron > 0.0 && vAlong < uShaftEnd - uChevron * 0.4) {
      // Chevrons: bands along the path bent back at the edges, pointing ahead
      float phase = fract((vAlong - d * 1.2 - uTime * uFlow) / uChevron);
      float ab = max(fwidth(phase), 1e-4);
      float band = smoothstep(0.0, ab, phase) * (1.0 - smoothstep(0.34 - ab, 0.34, phase));
      col = mix(col, uEdge, band * 0.55);
    }
    col = mix(col, uEdge, rim);
    float a = body * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const traceClock = { value: 0 };
// A reveal past any trace's length: the whole trace
const ALL = 1e6;

/**
 * The last move's path from `from` to `to` (cell floors): straight along a
 * platform, a gentle arc between levels, ending in an arrowhead beside the
 * piece that moved. A camera-facing ribbon of real world-space width with a
 * contrasting outline, optionally with chevrons (drifting if `flowSpeed`).
 */
export const LastMoveTrace = ({
  from,
  to,
  color = '#4cc9f0',
  edgeColor = '#0b1320',
  opacity = 0.95,
  width = 0.1,
  headLength = 0.3,
  headWidth = 0.3,
  chevrons = 0.42,
  flowSpeed = 0,
  drawInMs = 0,
  ...pathOptions
}: TraceStyle & { from: Vec3; to: Vec3 }) => {
  const invalidate = useThree((s) => s.invalidate);
  // How much of the trace is drawn, from its source (world units)
  const revealed = useRef(drawInMs > 0 ? 0 : ALL);
  const key = JSON.stringify([from, to, width, headLength, headWidth, pathOptions]);
  const { geometry, shaftEnd, length } = useMemo(() => {
    const data = ribbonData(tracePath(from, to, pathOptions), { width, headLength, headWidth });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.position, 3));
    g.setAttribute('aTangent', new BufferAttribute(data.tangent, 3));
    g.setAttribute('aSide', new BufferAttribute(data.side, 1));
    g.setAttribute('aHalf', new BufferAttribute(data.halfWidth, 1));
    g.setAttribute('aAlong', new BufferAttribute(data.along, 1));
    g.setIndex(data.index);
    g.computeBoundingSphere();
    return {
      geometry: g,
      shaftEnd: data.length - Math.min(headLength, data.length * 0.6),
      length: data.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color() },
          uEdge: { value: new Color() },
          uOpacity: { value: 1 },
          uEdgeWidth: { value: 0.02 },
          uChevron: { value: 0 },
          uShaftEnd: { value: 1 },
          uFlow: { value: 0 },
          uTime: traceClock,
          uReveal: { value: ALL },
        },
        vertexShader: traceVertex,
        fragmentShader: traceFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  (u.uEdge.value as Color).set(edgeColor);
  u.uOpacity.value = opacity;
  u.uEdgeWidth.value = Math.min(width * 0.22, 0.03);
  u.uChevron.value = chevrons;
  u.uShaftEnd.value = shaftEnd;
  u.uFlow.value = flowSpeed;

  useEffect(() => {
    if (drawInMs > 0) invalidate();
  }, [drawInMs, invalidate]);
  u.uReveal.value = revealed.current;
  useFrame((state, delta) => {
    if (revealed.current < length) {
      revealed.current += (Math.min(delta, 1 / 20) * length * 1000) / drawInMs;
      if (revealed.current >= length) revealed.current = ALL;
      u.uReveal.value = revealed.current;
      invalidate();
    }
    if (flowSpeed === 0) return;
    traceClock.value = state.clock.elapsedTime;
    invalidate();
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/**
 * The square of a king in check: a bold red outline with a faint red floor
 * and a ring round the king's base. Calm (static unless `breathe`), but
 * unmistakable from any angle.
 */
export const CheckMarker = ({
  floor,
  pitch = 1,
  color = '#ff3b3b',
  breathe = 0,
}: {
  floor: Vec3;
  pitch?: number;
  color?: string;
  breathe?: number;
}) => (
  <>
    <FloorMarker
      floor={floor}
      pitch={pitch}
      shape="square"
      color={color}
      opacity={1}
      fill={0.2}
      lineWidth={0.08}
      inset={0.05}
      breathe={breathe}
    />
    <FloorMarker
      floor={floor}
      pitch={pitch}
      shape="ring"
      color={color}
      opacity={0.9}
      lineWidth={0.05}
      breathe={breathe}
    />
  </>
);

export interface ClarityMarkerOptions {
  /** Distance between neighbouring cell centres (see towerFrame). */
  pitch: number;
  /** Shape of the legal-destination marker (and, by default, the last move's squares). */
  shape?: MarkerShape;
  /** Legal destinations. */
  color?: string;
  opacity?: number;
  fill?: number;
  /** The capture cue's tint. */
  captureColor?: string;
  /** The selected piece's ring. */
  selectColor?: string;
  lastMoveColor?: string;
  lastMoveShape?: MarkerShape;
  checkColor?: string;
  /** Anything else for the destination markers (line width, inset, breathe…). */
  marker?: FloorMarkerStyle;
  /** Anything else for the last-move trace. */
  trace?: TraceStyle;
  /** Breathe the check marker (0 = static). */
  checkBreathe?: number;
}

export interface ClarityMarkers {
  Quiet: ComponentType<MarkerProps>;
  Capture: ComponentType<MarkerProps>;
  Selection: ComponentType<MarkerProps>;
  LastMove: ComponentType<LastMoveMarkerProps>;
  Check: ComponentType<MarkerProps>;
}

/**
 * The whole marker set of a design in one call, ready for `Design.markers`:
 * destinations and captures in one family, the selection ring, the last
 * move's squares and trace, and the check.
 */
export const clarityMarkers = ({
  pitch,
  shape = 'square',
  color = '#ffd166',
  opacity = 0.85,
  fill = 0.06,
  captureColor = '#ff6b5e',
  selectColor = '#ffe8a3',
  lastMoveColor = '#4cc9f0',
  lastMoveShape,
  checkColor = '#ff3b3b',
  marker = {},
  trace = {},
  checkBreathe = 0,
}: ClarityMarkerOptions): ClarityMarkers => {
  const base = { pitch, shape, color, opacity, fill, captureColor, ...marker };
  const Quiet = ({ floor, hovered }: MarkerProps) => (
    <FloorMarker floor={floor} {...base} hovered={hovered} />
  );
  const Capture = ({ floor, hovered }: MarkerProps) => (
    <FloorMarker floor={floor} {...base} capture hovered={hovered} />
  );
  const Selection = ({ floor }: MarkerProps) => (
    <FloorMarker
      floor={floor}
      pitch={pitch}
      shape="ring"
      color={selectColor}
      opacity={0.95}
      fill={0.16}
      lineWidth={0.07}
    />
  );
  // A fresh move draws its trace in when `trace.drawInMs` is set; a replayed
  // one (history, a rejoin) shows it whole
  const LastMove = ({ from, to, fresh = false }: LastMoveMarkerProps) => (
    <>
      {[from, to].map((m, i) => (
        <FloorMarker
          key={i}
          floor={m.floor}
          {...base}
          shape={lastMoveShape ?? shape}
          color={lastMoveColor}
          fill={i === 0 ? 0.1 : 0.06}
        />
      ))}
      <LastMoveTrace
        from={from.floor}
        to={to.floor}
        color={lastMoveColor}
        {...trace}
        drawInMs={fresh ? (trace.drawInMs ?? 0) : 0}
      />
    </>
  );
  const Check = ({ floor }: MarkerProps) => (
    <CheckMarker floor={floor} pitch={pitch} color={checkColor} breathe={checkBreathe} />
  );
  return { Quiet, Capture, Selection, LastMove, Check };
};
