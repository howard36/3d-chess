import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  PlaneGeometry,
  PointsMaterial,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Mesh, Points } from 'three';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';

import type { MarkerProps } from '../types';
import { claimed, useHoldAt } from './claims';
import { PALETTE, RING_RADIUS } from './palette';
import { usePieceSetting } from './settings-pieces';

// The held piece's light, after Meridian's column of starlight, calmer.
//
// Picked up, a column of cool white light rises gently round the piece from
// the glass, nearly straight (it narrows only a little), its height in
// proportion to the piece's own (a pawn's is short, a king's about his
// height), bright at its rising front and settling to a quiet glow. A thin
// circle of the same light lies round the piece's foot, drawn in by a glint
// that runs round it once; one ring of light spreads out from it and fades,
// answering the click. A few faint motes drift up round the column, now and
// then glimmering. Put down, or when another piece is picked up, the column
// sinks back into the glass and the circle fades; every new pick-up plays
// the whole entrance again.
//
// PieceBody (pieces.tsx) owns the timeline (so the release plays after the
// Selection marker has gone) and mounts SelectionLight in its floor group,
// which stays on the glass while the piece lifts. The Selection marker only
// says where the held piece stands (claims.ts), for the markers.
//
// Seen from above, the column's walls would lie round the piece as another
// ring: it gives way there, and the circle and a faint pool inside it say
// which piece is held. Everything is additive light, drawn over the glass
// and behind the piece (depth-tested), never over the piece.

/** Notes where the held piece stands (claims.ts); its light is the piece's own. */
export const Selection = ({ floor }: MarkerProps) => {
  useHoldAt(floor);
  return null;
};

// --- The timeline ---------------------------------------------------------------------------

/** The column rises in RISE_MS, bright at its front, then settles over SETTLE_MS. */
const RISE_MS = 520;
const SETTLE_MS = 560;
/** The glint runs once round the circle in DRAW_MS. */
const DRAW_MS = 640;
/** The click's ring spreads and fades in PULSE_MS. */
const PULSE_MS = 700;
/** Put down, everything sinks and fades in FALL_MS. */
const FALL_MS = 300;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

/** The held light's state, advanced by stepSelection and read by SelectionLight. */
export interface SelectState {
  /** ms since the piece was picked up, or -1 while it is not held. */
  since: number;
  /** How far the column has risen, 0–1 of its height. */
  rise: number;
  /** Its brightness, 0–1 (settles at SETTLED). */
  strength: number;
  /** The soft swell of light at its rising front. */
  front: number;
  /** The circle's presence, 0–1. */
  circle: number;
  /** How far round the glint has drawn the circle, 0–1. */
  draw: number;
  /** ms since the click's ring set out, or -1 when it has faded. */
  pulse: number;
  /** Seconds of drift (the motes and the column's bands). */
  clock: number;
  /** The release under way: 1 down to 0, and where each part stood as it began. */
  fall: number;
  from: { rise: number; strength: number; circle: number };
}

export const selectState = (): SelectState => ({
  since: -1,
  rise: 0,
  strength: 0,
  front: 0,
  circle: 0,
  draw: 1,
  pulse: -1,
  clock: 0,
  fall: 0,
  from: { rise: 0, strength: 0, circle: 0 },
});

/** The column's calm brightness once settled (Meridian's settled at 0.6). */
const SETTLED = 0.5;

/**
 * Advances the held light by `dt` ms; `pulse` false leaves out the click's
 * ring. Returns whether anything is still showing (the light is mounted
 * while it is).
 */
export const stepSelection = (
  s: SelectState,
  selected: boolean,
  dt: number,
  { still, pulse }: { still: boolean; pulse: boolean },
): boolean => {
  if (!still) s.clock += dt / 1000;
  if (selected) {
    if (s.since < 0) {
      // Picked up: the entrance plays again from the start, the column
      // rising from wherever a release left it
      s.since = 0;
      s.fall = 0;
      s.draw = 0;
      s.pulse = pulse && !still ? 0 : -1;
    } else s.since += dt;
    const t = still ? RISE_MS + SETTLE_MS : s.since;
    s.rise = Math.max(s.rise, easeOut(clamp01(t / RISE_MS)));
    const settle = smooth(clamp01((t - RISE_MS * 0.55) / SETTLE_MS));
    // In gently (Lumina's), a brighter moment as it rises, then calm
    s.strength = smooth(clamp01(t / 260)) * (0.9 - (0.9 - SETTLED) * settle);
    s.front = still ? 0 : 0.22 * Math.sin(Math.PI * clamp01(t / RISE_MS));
    s.circle = Math.max(s.circle, smooth(clamp01(t / 220)));
    s.draw = still ? 1 : clamp01(t / DRAW_MS);
  } else {
    if (s.since >= 0) {
      // Put down: the release eases from wherever the entrance had got to
      s.since = -1;
      s.fall = 1;
      s.from = { rise: s.rise, strength: s.strength, circle: s.circle };
    }
    if (s.fall > 0) {
      s.fall = Math.max(0, s.fall - dt / FALL_MS);
      const e = smooth(s.fall);
      // The column sinks into the glass as it fades
      s.rise = s.from.rise * (0.35 + 0.65 * e);
      s.strength = s.from.strength * e;
      s.circle = s.from.circle * e;
      s.front = 0;
      if (s.fall === 0) s.rise = 0;
    }
  }
  if (s.pulse >= 0) {
    s.pulse += dt;
    if (s.pulse >= PULSE_MS) s.pulse = -1;
  }
  return selected || s.fall > 0 || s.pulse >= 0;
};

// --- The column -----------------------------------------------------------------------------

// Unit height: each piece scales it to its own
const COLUMN_BOTTOM = RING_RADIUS * 0.96;
const columnGeometry = new CylinderGeometry(
  COLUMN_BOTTOM * 0.86,
  COLUMN_BOTTOM,
  1,
  32,
  1,
  true,
).translate(0, 0.5, 0);

/** The column's height over the piece's (a little above its head, lifted). */
export const COLUMN_SCALE = 1.1;

const columnVertex = /* glsl */ `
  varying float vH;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vH = position.y;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const columnFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uRise;
  uniform float uFront;
  uniform float uStrength;
  varying float vH;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    // Risen this far: soft at its rising top, so it grows up out of the
    // glass rather than climbing as a rim
    float reach = 1.0 - smoothstep(uRise - 0.3, uRise + 0.02, vH);
    if (reach < 0.002) discard;
    vec3 v = normalize(cameraPosition - vW);
    float facing = abs(dot(normalize(vN), v));
    // A soft band of light just inside its outline, never a hard edge: a
    // beam, not a glass; clear in front of the piece
    float edge = pow(1.0 - facing, 1.3) * smoothstep(0.0, 0.35, facing);
    float fade = pow(1.0 - vH, 1.9);
    // Faint bands of light rising slowly
    float bands = 0.84 + 0.16 * sin((vH * 3.2 - uTime * 0.28) * 6.2831853);
    float skirt = exp(-vH / 0.05) * 0.1;
    // The rising front of the entrance: a soft swell of light, not a rim
    float front = exp(-pow((vH - uRise + 0.14) / 0.16, 2.0)) * uFront * (0.2 + edge);
    // Seen from above its walls would ring the piece: they give way there
    float side = 1.0 - 0.94 * smoothstep(0.6, 0.88, abs(v.y));
    float a = ((0.035 + 0.85 * edge) * fade * bands + skirt + front * 0.6) * uStrength * side * reach;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

// --- The circle, its pool and the click's ring --------------------------------------------

const floorVertex = /* glsl */ `
  varying vec2 vP;
  varying vec3 vW;
  void main() {
    vP = position.xz;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const floorFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uCircle;
  uniform float uDraw;
  uniform float uShimmer;
  uniform float uTime;
  uniform float uPulse;
  uniform float uPulseR;
  uniform float uStrength;
  varying vec2 vP;
  varying vec3 vW;
  const float TAU = 6.2831853;
  float line(float d, float w) {
    float fw = max(fwidth(d), 1e-4);
    float ww = max(w, fw * 0.75);
    return (1.0 - smoothstep(ww - fw, ww + fw, abs(d))) * min(w / ww, 1.0);
  }
  void main() {
    float r = length(vP);
    vec3 v = normalize(cameraPosition - vW);
    float above = smoothstep(0.55, 0.92, abs(v.y));
    // How far round the circle this point lies (0–1)
    float along = fract(atan(vP.x, -vP.y) / TAU + 1.0);
    // The glint that draws the circle in: lit behind it, faint ahead
    float gap = uDraw - along;
    float behind = step(along, uDraw);
    float head = exp(-gap * gap / 0.0014) * step(0.0, gap) * step(uDraw, 0.999);
    // Circling (a setting): a soft brighter arc going slowly round
    float arc = fract(along - uTime / 7.0);
    float drift = uShimmer * exp(-pow(min(arc, 1.0 - arc) / 0.07, 2.0)) * step(0.999, uDraw);
    float ring = line(r - uRadius, 0.0075) * (0.25 + 0.75 * behind) * (0.62 + head * 1.3 + drift * 0.5);
    float halo = exp(-pow((r - uRadius) / 0.03, 2.0)) * (0.06 + 0.22 * head);
    // A faint pool inside, clearer from above where the column gives way
    float pool = (1.0 - smoothstep(0.0, uRadius, r)) * (0.015 + 0.1 * above) * uStrength;
    float light = (ring + halo) * uCircle + pool;
    // The click: one ring spreading out and fading
    light += line(r - uPulseR, 0.009 + 0.006 * (1.0 - uPulse)) * uPulse * 0.7;
    light += exp(-pow((r - uPulseR) / 0.045, 2.0)) * uPulse * 0.12;
    if (light < 0.003) discard;
    gl_FragColor = vec4(uColor * light, 1.0);
    #include <colorspace_fragment>
  }`;

// Wide enough for the click's ring at its widest (piece units)
const PULSE_REACH = 1.62;
const floorPlane = new PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2);

// --- The motes ------------------------------------------------------------------------------

const MOTES = 12;
let moteMap: ReturnType<typeof dotTexture> | null = null;

// --- The light ------------------------------------------------------------------------------

const view = new Vector3();
const at = new Vector3();

/**
 * The held piece's light: its column, circle, click ring and motes, drawn
 * from `state` (advanced by the piece). `top` is the piece's height; the
 * circle steps aside for a check marker on the same floor.
 */
export const SelectionLight = ({
  state,
  top,
  still,
}: {
  state: React.RefObject<SelectState>;
  top: number;
  still: boolean;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const heightScale = usePieceSetting<number>('piece.columnHeight');
  const brightness = usePieceSetting<number>('piece.columnBrightness');
  const particles = usePieceSetting<boolean>('piece.particles');
  const shimmer = usePieceSetting<string>('piece.shimmer');
  useEffect(() => invalidate(), [heightScale, brightness, particles, shimmer, invalidate]);

  const column = useRef<Mesh>(null);
  const floor = useRef<Mesh>(null);
  const points = useRef<Points>(null);
  const { columnMaterial, floorMaterial, motes, moteMaterial, seeds } = useMemo(() => {
    const color = new Color(PALETTE.select);
    const columnMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: color },
        uTime: { value: 0 },
        uRise: { value: 0 },
        uFront: { value: 0 },
        uStrength: { value: 0 },
      },
      vertexShader: columnVertex,
      fragmentShader: columnFragment,
    });
    const floorMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: color },
        uRadius: { value: RING_RADIUS },
        uCircle: { value: 0 },
        uDraw: { value: 1 },
        uShimmer: { value: 0 },
        uTime: { value: 0 },
        uPulse: { value: 0 },
        uPulseR: { value: RING_RADIUS },
        uStrength: { value: 0 },
      },
      vertexShader: floorVertex,
      fragmentShader: floorFragment,
    });
    const random = rng(11);
    const seeds = Array.from({ length: MOTES }, () => ({
      angle: random() * Math.PI * 2,
      // Round the column's wall, a few just inside it or out
      radius: COLUMN_BOTTOM * (0.55 + random() * 0.6),
      phase: random(),
      speed: 0.07 + random() * 0.06,
      spin: (random() < 0.5 ? -1 : 1) * (0.15 + random() * 0.2),
      glint: random() * Math.PI * 2,
      rate: 0.8 + random() * 1.4,
    }));
    const motes = new BufferGeometry();
    motes.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    motes.setAttribute('color', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    moteMap ??= dotTexture(0.85, 32);
    const moteMaterial = new PointsMaterial({
      size: 0.12,
      map: moteMap,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    return { columnMaterial, floorMaterial, motes, moteMaterial, seeds };
  }, []);
  useEffect(
    () => () => {
      columnMaterial.dispose();
      floorMaterial.dispose();
      motes.dispose();
      moteMaterial.dispose();
    },
    [columnMaterial, floorMaterial, motes, moteMaterial],
  );
  const tint = useMemo(() => new Color(PALETTE.select), []);

  useFrame(({ camera }) => {
    const s = state.current;
    if (!s) return;
    const height = top * COLUMN_SCALE * heightScale;
    const c = columnMaterial.uniforms;
    c.uTime.value = s.clock;
    c.uRise.value = s.rise;
    c.uFront.value = s.front;
    c.uStrength.value = s.strength * brightness;
    if (column.current) {
      column.current.scale.set(1, height, 1);
      column.current.visible = s.strength > 0.002 && s.rise > 0.002;
    }
    const f = floorMaterial.uniforms;
    // Where a check marker lies round the king, the circle steps aside for it
    let circle = s.circle;
    if (floor.current) {
      floor.current.getWorldPosition(at);
      if (claimed(at, ['check'])) circle = 0;
    }
    f.uCircle.value = circle * Math.min(1, 0.55 + 0.45 * brightness);
    f.uDraw.value = shimmer === 'off' ? 1 : s.draw;
    f.uShimmer.value = shimmer === 'slow' && !still ? 1 : 0;
    f.uTime.value = s.clock;
    f.uStrength.value = s.strength * brightness;
    const p = s.pulse >= 0 ? s.pulse / PULSE_MS : 1;
    f.uPulse.value = s.pulse >= 0 ? (1 - p) ** 1.6 : 0;
    f.uPulseR.value = RING_RADIUS * (1 + (PULSE_REACH - 1) * easeOut(p));
    // The motes drift up round the column, fading from above (seen end-on
    // they would be specks scattered round the piece)
    const show = particles && s.strength > 0.002;
    if (points.current) points.current.visible = show;
    if (show) {
      camera.getWorldDirection(view);
      const side = 1 - smooth(clamp01((-view.y - 0.62) / 0.25));
      const pos = motes.getAttribute('position') as BufferAttribute;
      const col = motes.getAttribute('color') as BufferAttribute;
      const t = s.clock;
      seeds.forEach((m, i) => {
        const h = (m.phase + t * m.speed) % 1;
        const a = m.angle + t * m.spin;
        const r = m.radius * (1 - 0.18 * h);
        pos.setXYZ(i, Math.cos(a) * r, h * height * 0.92 * s.rise, Math.sin(a) * r);
        // Faint, and now and then a brief glimmer
        const glimmer = Math.pow(0.5 + 0.5 * Math.sin(t * m.rate * 2.4 + m.glint), 8);
        const b = Math.sin(Math.PI * h) * (0.4 + 1.1 * glimmer) * s.strength * brightness * side;
        col.setXYZ(i, tint.r * b, tint.g * b, tint.b * b);
      });
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  });

  return (
    <>
      <mesh
        ref={floor}
        geometry={floorPlane}
        material={floorMaterial}
        position={[0, 0.007, 0]}
        renderOrder={LAYER.shadow + 0.3}
        raycast={noRaycast}
      />
      <mesh
        ref={column}
        geometry={columnGeometry}
        material={columnMaterial}
        renderOrder={LAYER.trace + 0.5}
        raycast={noRaycast}
        visible={false}
      />
      <points
        ref={points}
        geometry={motes}
        material={moteMaterial}
        renderOrder={LAYER.trace + 0.6}
        raycast={noRaycast}
        frustumCulled={false}
        visible={false}
      />
    </>
  );
};
