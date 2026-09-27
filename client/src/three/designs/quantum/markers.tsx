import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { prefersReducedMotion } from '../../motion';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { MOTION, PALETTE, PITCH } from './palette';

// Markers in the language of a qubit, lying on the wafer. A move you may make
// is a qubit: a bright dot inside a tilted orbit, with its electron. A capture
// is the same glyph collapsed round the victim: the orbit falls into a red
// ring. The held piece stands in a gold ring. The move just made leaves a
// small mint orbit where it started and a mint ring where it landed, joined by
// a thin mint line with a slow photon flowing along it. Check is a red
// interference ripple round the king's base.

export type GlyphKind = 'quiet' | 'capture' | 'select' | 'from' | 'to' | 'check' | 'pulse';

const KIND_ID: Record<GlyphKind, number> = {
  quiet: 0,
  capture: 1,
  select: 2,
  from: 3,
  to: 4,
  check: 5,
  pulse: 6,
};

const vertexShader = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    // Local position in pitches, x across and y into the board, centred
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform int uKind;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uGrow;
  uniform float uTime;
  uniform float uTurn;
  varying vec2 vP;

  float stroke(float d, float w) {
    float aa = max(fwidth(d), 1e-4) * 0.9;
    return 1.0 - smoothstep(w - aa, w + aa, abs(d));
  }
  float disc(float d) {
    float aa = max(fwidth(d), 1e-4) * 0.9;
    return 1.0 - smoothstep(-aa, aa, d);
  }
  // Distance to an ellipse outline (first-order: exact enough for a hairline)
  float ellipse(vec2 p, vec2 ab) {
    vec2 q = p / ab;
    float k = length(q);
    vec2 grad = p / (ab * ab);
    return (k - 1.0) * k / max(length(grad), 1e-4);
  }
  vec2 rot(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  void main() {
    // Grow in from a little smaller on appearing
    vec2 p = vP / mix(0.7, 1.0, uGrow);
    float r = length(p);
    float a = 0.0;
    float fill = 0.0;
    if (uKind == 0) {
      // A qubit: dot, tilted orbit, electron
      float dotR = 0.1 + 0.015 * uHover;
      a = max(a, disc(r - dotR));
      vec2 q = rot(p, uTurn);
      vec2 ab = vec2(0.34, 0.14) * (1.0 + 0.06 * uHover);
      float orbit = ellipse(q, ab);
      a = max(a, stroke(orbit, 0.016 + 0.005 * uHover) * 0.9);
      vec2 e = vec2(cos(0.9), sin(0.9)) * ab;
      a = max(a, disc(length(q - e) - 0.038));
      fill = disc(orbit) * (0.1 + 0.1 * uHover);
    } else if (uKind == 1) {
      // Collapsed: the orbit falls into a ring round the victim's base, the
      // electron stays on it, and the old orbit lingers faintly outside
      float ring = 0.425;
      a = max(a, stroke(r - ring, 0.02 + 0.005 * uHover));
      vec2 q = rot(p, uTurn);
      a = max(a, disc(length(q - vec2(ring, 0.0)) - 0.034));
      a = max(a, disc(length(q + vec2(ring, 0.0)) - 0.034));
      float orbit = stroke(ellipse(q, vec2(0.47, 0.2)), 0.009) * step(ring + 0.02, r);
      a = max(a, orbit * 0.7);
      fill = disc(r - ring) * (0.09 + 0.08 * uHover);
    } else if (uKind == 2) {
      // The held piece: a gold ring with two electrons opposite
      float ring = 0.43;
      a = max(a, stroke(r - ring, 0.018));
      vec2 q = rot(p, uTurn);
      a = max(a, disc(length(q - vec2(0.0, ring)) - 0.03));
      a = max(a, disc(length(q + vec2(0.0, ring)) - 0.03));
      fill = disc(r - ring) * 0.12;
    } else if (uKind == 3) {
      // Where the last move started: a small, emptied orbit
      vec2 q = rot(p, uTurn);
      a = max(a, stroke(ellipse(q, vec2(0.25, 0.1)), 0.012) * 0.9);
      a = max(a, stroke(r - 0.06, 0.012) * 0.9);
      fill = disc(r - 0.3) * 0.06;
    } else if (uKind == 4) {
      // Where it landed: a ring round the base, with its electron
      float ring = 0.42;
      a = max(a, stroke(r - ring, 0.016));
      vec2 q = rot(p, uTurn);
      a = max(a, disc(length(q - vec2(ring, 0.0)) - 0.028));
      fill = disc(r - ring) * 0.07;
    } else if (uKind == 5) {
      // Check: an interference ripple, two sources beating round the base
      float k = 62.0;
      float w = uTime * 2.2;
      vec2 s = vec2(0.07, 0.0);
      float i1 = cos(k * length(p - s) - w);
      float i2 = cos(k * length(p + s) - w);
      float wave = smoothstep(0.9, 1.7, i1 + i2);
      float band = smoothstep(0.27, 0.31, r) * (1.0 - smoothstep(0.42, 0.49, r));
      a = max(a, wave * band * 0.85);
      a = max(a, stroke(r - 0.285, 0.014));
      // The square itself, outlined, so the check reads from any distance
      vec2 b = abs(p) - vec2(0.45);
      float sq = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0);
      a = max(a, stroke(sq, 0.012) * 0.8);
      fill = (1.0 - smoothstep(0.0, 0.01, sq)) * 0.12;
    } else {
      // A ripple pulse (landing, capture): one ring, uTime its radius
      a = stroke(r - uTime, 0.02) * (1.0 - smoothstep(0.2, 0.55, uTime));
    }
    float alpha = max(a * uOpacity * (1.0 + 0.35 * uHover), fill * uOpacity) * uGrow;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(uColor * (1.0 + 0.25 * uHover), min(alpha, 1.0));
    #include <colorspace_fragment>
  }`;

const planes = new Map<number, PlaneGeometry>();
const planeFor = (size: number) => {
  let g = planes.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    planes.set(size, g);
  }
  return g;
};

// Orbits are tilted the same way everywhere, like a printed symbol
const TURN = 0.6;

export interface GlyphProps {
  floor: Vec3;
  kind: GlyphKind;
  color: string;
  opacity?: number;
  hovered?: boolean;
  /** Grow in over this long when mounted (0: at once). */
  growMs?: number;
  delayMs?: number;
  /** Size of the quad, in pitches. */
  quad?: number;
  lift?: number;
  renderOrder?: number;
  /** Animate the check ripple (keeps frames coming while it is up). */
  ripple?: boolean;
}

/** One glyph of the qubit language, flat on the wafer at a cell's floor. */
export const Glyph = ({
  floor,
  kind,
  color,
  opacity = 1,
  hovered = false,
  growMs = 160,
  delayMs = 0,
  quad = 1,
  lift = 0.012,
  renderOrder = LAYER.marker,
  ripple = false,
}: GlyphProps) => {
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
          uKind: { value: KIND_ID[kind] },
          uColor: { value: new Color(color) },
          uOpacity: { value: opacity },
          uHover: { value: 0 },
          uGrow: { value: growMs > 0 ? 0 : 1 },
          uTime: { value: 0 },
          uTurn: { value: TURN },
          uQuad: { value: quad * PITCH },
        },
        vertexShader,
        fragmentShader,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; uniforms follow the props below
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  u.uKind.value = KIND_ID[kind];
  (u.uColor.value as Color).set(color);
  u.uOpacity.value = opacity;
  u.uHover.value = hovered ? 1 : 0;
  u.uQuad.value = quad * PITCH;

  const age = useRef(-delayMs);
  const still = prefersReducedMotion();
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20) * 1000;
    let moving = false;
    if (u.uGrow.value < 1) {
      age.current += dt;
      const k = growMs > 0 ? Math.min(Math.max(age.current / growMs, 0), 1) : 1;
      u.uGrow.value = 1 - (1 - k) ** 3;
      moving = true;
    }
    if (ripple && !still) {
      u.uTime.value += dt / 1000;
      moving = true;
    }
    if (moving) invalidate();
  });

  return (
    <mesh
      geometry={planeFor(quad * PITCH)}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      renderOrder={renderOrder}
      raycast={noRaycast}
    />
  );
};

// --- The marker set -------------------------------------------------------------------

export const Quiet = ({ floor, hovered }: MarkerProps) => (
  <Glyph floor={floor} kind="quiet" color={PALETTE.move} opacity={0.95} hovered={hovered} />
);

export const Capture = ({ floor, hovered }: MarkerProps) => (
  <Glyph
    floor={floor}
    kind="capture"
    color={PALETTE.capture}
    opacity={1}
    hovered={hovered}
    quad={1.1}
  />
);

export const Selection = ({ floor }: MarkerProps) => (
  <Glyph floor={floor} kind="select" color={PALETTE.select} opacity={0.95} growMs={220} />
);

/**
 * The last move: a small emptied orbit where it started, a ring round the
 * piece where it landed, and the thin mint line between their centres. A
 * live move draws its line in behind the gliding piece; a replayed one shows
 * whole.
 */
export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
  <>
    <Glyph floor={from.floor} kind="from" color={PALETTE.lastMove} opacity={0.9} growMs={0} />
    <Glyph
      floor={to.floor}
      kind="to"
      color={PALETTE.lastMove}
      opacity={0.95}
      growMs={fresh ? 200 : 0}
      delayMs={fresh ? MOTION.durationMs * 0.85 : 0}
    />
    <LastMoveLine
      from={from.floor}
      to={to.floor}
      arc={arc}
      color={PALETTE.lastMove}
      pulseColor="#eafff4"
      radius={0.012}
      opacity={0.9}
      pulse={0.75}
      pulseLength={0.22}
      flowSpeed={0.55}
      spacing={1.8}
      shade={0.3}
      drawInMs={fresh ? 360 : 0}
      drawInDelayMs={fresh ? MOTION.durationMs * 0.25 : 0}
    />
  </>
);

export const Check = ({ floor }: MarkerProps) => (
  <Glyph floor={floor} kind="check" color={PALETTE.check} opacity={1} growMs={240} ripple />
);
