import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import { prefersReducedMotion } from '../motion';
import { LAYER } from './layers';
import { pathDistances, tracePath, tubeData } from './markerGeometry';
import type { TracePathOptions } from './markerGeometry';
import { noRaycast } from '../noRaycast';
import type { Vec3 } from '../types';

// The last move's line: a thin tube of real geometry from the centre of the
// source square's floor to the centre of the destination's, straight (or a
// knight's arc, when knights arc), with a calm flow along it from source to
// destination. No arrowhead: the destination's own marker says where the move
// ended. The line is depth-tested like any solid, and drawn after the
// platforms and markers, so pieces hide it where it passes behind them; with
// an `inset` (TracePathOptions) it lands on the destination's floor beside
// the piece standing there rather than running into it.

interface LineStyle extends Omit<TracePathOptions, 'arc'> {
  color?: string;
  /** Colour the flow brightens toward (default: `color` lifted toward white). */
  pulseColor?: string;
  opacity?: number;
  /** Radius of the tube (world units). Thin: the line should not take much room. */
  radius?: number;
  /** Speed of the soft pulse drifting toward the destination, world units a second (0: still). */
  flowSpeed?: number;
  /** Contrast of the pulse, 0–1: how far it brightens the line toward `pulseColor`. */
  pulse?: number;
  /** Length of the pulse (world units). */
  pulseLength?: number;
  /** Distance between pulses (world units). */
  spacing?: number;
  /** How much darker the tube's sides are than its middle, so it reads as round (0: flat). */
  shade?: number;
  /** Vertices round the tube. */
  radialSegments?: number;
  /**
   * Draw the line in from its source over this long when it mounts (0: all
   * at once). Pass it only for a fresh move (LastMoveMarkerProps.fresh).
   */
  drawInMs?: number;
  /** Wait this long after mounting before drawing in. */
  drawInDelayMs?: number;
}

/** The line's defaults. */
const LINE_DEFAULTS = {
  color: '#4cc9f0',
  opacity: 0.95,
  radius: 0.018,
  flowSpeed: 0.6,
  pulse: 0.5,
  pulseLength: 0.3,
  spacing: 1.6,
  shade: 0.35,
} as const satisfies LineStyle;

// A reveal past any line's length: the whole line
const ALL = 1e6;

const tubeGeometry = (points: Vec3[], radius: number, radialSegments: number) => {
  const data = tubeData(points, { radius, radialSegments });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data.position, 3));
  g.setAttribute('normal', new BufferAttribute(data.normal, 3));
  g.setAttribute('aAlong', new BufferAttribute(data.along, 1));
  g.setIndex(new BufferAttribute(data.index, 1));
  g.computeBoundingSphere();
  return g;
};

const lineMaterial = (clock: { value: number }) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color() },
      uPulseColor: { value: new Color() },
      uOpacity: { value: 1 },
      uShade: { value: 0.35 },
      uTime: clock,
      uFlow: { value: 0 },
      uPulse: { value: 0 },
      uPulseLength: { value: 0.3 },
      uSpacing: { value: 1 },
      uReveal: { value: ALL },
    },
    vertexShader,
    fragmentShader,
  });

const vertexShader = /* glsl */ `
  attribute float aAlong;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vAlong = aAlong;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uPulseColor;
  uniform float uOpacity;
  uniform float uShade;
  uniform float uTime;
  uniform float uFlow;
  uniform float uPulse;
  uniform float uPulseLength;
  uniform float uSpacing;
  uniform float uReveal;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    if (vAlong > uReveal) discard;
    // Position within the repeating flow, moving toward the destination
    float f = fract((vAlong - uTime * uFlow) / uSpacing);
    // One soft pulse per period
    float x = (f - 0.5) * uSpacing / max(uPulseLength, 1e-3);
    float glow = uPulse * exp(-x * x * 4.0);
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    vec3 col = uColor * (1.0 - uShade + uShade * facing);
    col = mix(col, uPulseColor, glow);
    gl_FragColor = vec4(col, uOpacity);
    #include <colorspace_fragment>
  }`;

const WHITE = new Color('#ffffff');
/**
 * The last move's line between two cell floors (MarkerProps.floor), with
 * the move's `arc` (LastMoveMarkerProps.arc) so a knight's line follows its
 * arc. See LineStyle for the look; everything has a calm default.
 */
export const LastMoveLine = ({
  from,
  to,
  arc = 0,
  color = LINE_DEFAULTS.color,
  pulseColor,
  opacity = LINE_DEFAULTS.opacity,
  radius = LINE_DEFAULTS.radius,
  flowSpeed = LINE_DEFAULTS.flowSpeed,
  pulse = LINE_DEFAULTS.pulse,
  pulseLength = LINE_DEFAULTS.pulseLength,
  spacing = LINE_DEFAULTS.spacing,
  shade = LINE_DEFAULTS.shade,
  radialSegments = 8,
  drawInMs = 0,
  drawInDelayMs = 0,
  lift,
  segments,
  inset = 0,
  insetSide,
  insetFront,
}: LineStyle & { from: Vec3; to: Vec3; arc?: number }) => {
  const invalidate = useThree((s) => s.invalidate);
  // Clear of the platform, whatever the thickness
  const height = lift ?? radius + 0.012;
  const flow = prefersReducedMotion() ? 0 : flowSpeed;

  const key = JSON.stringify([
    from,
    to,
    arc,
    height,
    segments,
    radius,
    radialSegments,
    inset,
    insetSide,
    insetFront,
  ]);
  const { geometry, length } = useMemo(() => {
    const points = tracePath(from, to, {
      lift: height,
      arc,
      segments,
      inset,
      insetSide,
      insetFront,
    });
    const distances = pathDistances(points);
    const length = distances[distances.length - 1];
    const geometry = tubeGeometry(points, radius, radialSegments);
    return { geometry, length };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // The flow's clock: time on r3f's clock since the line appeared
  const clock = useMemo(() => ({ value: 0 }), []);
  const material = useMemo(() => lineMaterial(clock), [clock]);
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  if (pulseColor) (u.uPulseColor.value as Color).set(pulseColor);
  else (u.uPulseColor.value as Color).set(color).lerp(WHITE, 0.6);
  u.uOpacity.value = opacity;
  u.uFlow.value = flow;
  u.uSpacing.value = spacing;
  u.uShade.value = shade;
  u.uPulse.value = pulse;
  u.uPulseLength.value = pulseLength;

  // How much of the line is drawn, from its source, as time since mounting
  // (below zero while it waits to start)
  const since = useRef(drawInMs > 0 ? -drawInDelayMs : Infinity);
  const reveal = () => {
    if (since.current >= drawInMs) return ALL;
    const k = since.current / drawInMs;
    return k < 0 ? -1 : (1 - (1 - k) ** 2) * length;
  };
  u.uReveal.value = reveal();
  useEffect(() => invalidate(), [invalidate]);

  useFrame((_, delta) => {
    let moving = false;
    if (since.current < drawInMs) {
      since.current += Math.min(delta, 1 / 20) * 1000;
      moving = true;
    }
    if (flow !== 0) {
      // Clamped: the first frame after an idle stretch reports all of it
      clock.value += Math.min(delta, 1 / 20);
      moving = true;
    }
    u.uReveal.value = reveal();
    if (moving) invalidate();
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace + 0.1}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
