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
// Picked up, a column of cool white light grows gently up round the piece
// out of the glass, nearly straight (it narrows only a little): as high as
// the held piece is lifted, and then a share of the piece's own height (a
// pawn's is short, a king's taller). It eases out to that height and its
// light comes up to a quiet glow; neither ever overshoots and falls back. A
// thin circle of the same light lies round the piece's foot (a setting can
// have a glint draw it in, once round, or keep circling it); one ring of
// light spreads out from it and fades, answering the click. A few faint
// motes drift up round the column, now and then glimmering. Put down, or
// when another piece is picked up, the column sinks back into the glass and
// the circle fades; every new pick-up plays the whole entrance again.
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

/**
 * The column grows up out of the glass in RISE_MS, easing out to its height
 * (never past it: it never shrinks back), as its light comes up to a calm
 * glow over GLOW_MS.
 */
const RISE_MS = 700;
const GLOW_MS = 420;
/** The glint draws the circle in, once round, in DRAW_MS. */
const DRAW_MS = 640;
/** Circling (a setting), it then slows to one lap in CIRCLE_MS, on round for as long as the piece is held. */
const CIRCLE_MS = 3000;
/** How quickly the glint slows from its first lap's pace to the circling pace (ms). */
const SLOW_MS = 450;
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
  /** Its brightness, 0–1 (comes up to SETTLED). */
  strength: number;
  /** The circle's presence, 0–1. */
  circle: number;
  /** How far round the glint has drawn the circle, 0–1. */
  draw: number;
  /** Laps the glint has run (circling goes on past 1). */
  spin: number;
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
  circle: 0,
  draw: 1,
  spin: 0,
  pulse: -1,
  clock: 0,
  fall: 0,
  from: { rise: 0, strength: 0, circle: 0 },
});

/** The column's calm brightness (Meridian's settled at 0.6). */
const SETTLED = 0.5;

/** Laps the glint has run `t` ms after the pick-up: one in DRAW_MS, then easing to CIRCLE_MS a lap. */
export const glintLaps = (t: number) => {
  if (t <= DRAW_MS) return t / DRAW_MS;
  const fast = 1 / DRAW_MS;
  const slow = 1 / CIRCLE_MS;
  const after = t - DRAW_MS;
  return 1 + slow * after + (fast - slow) * SLOW_MS * (1 - Math.exp(-after / SLOW_MS));
};

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
    const t = still ? RISE_MS + GLOW_MS : s.since;
    // Both only ever grow while held, from wherever a release left them:
    // the column's height and light come up and stay (Lumina's gentle entrance)
    s.rise = Math.max(s.rise, easeOut(clamp01(t / RISE_MS)));
    s.strength = Math.max(s.strength, SETTLED * smooth(clamp01(t / GLOW_MS)));
    s.circle = Math.max(s.circle, smooth(clamp01(t / 220)));
    s.spin = still ? 0 : glintLaps(t);
    s.draw = still ? 1 : Math.min(s.spin, 1);
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

/**
 * The column's height (piece units): the held piece's lift, then a share of
 * the piece's own height (times the setting), so a pawn's is shorter; never
 * as tall as the gap to the level above.
 */
export const COLUMN_SCALE = 0.9;
const COLUMN_MAX = 1.55;
export const columnHeight = (top: number, heldLift: number, setting: number) =>
  Math.min(heldLift + COLUMN_SCALE * setting * top, COLUMN_MAX);

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
    // Seen from above its walls would ring the piece: they give way there
    float side = 1.0 - 0.94 * smoothstep(0.6, 0.88, abs(v.y));
    float a = ((0.035 + 0.85 * edge) * fade * bands + skirt) * uStrength * side * reach;
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
  uniform float uHead;
  uniform float uHeadAmt;
  uniform float uTail;
  uniform float uBase;
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
    // The circle is lit behind the glint as it draws it in, faint ahead
    float behind = step(along, uDraw);
    // The glint: a bright point with a short fading tail behind it (circling,
    // it goes on round)
    float gap = fract(uHead - along + 1.0);
    float near = min(gap, 1.0 - gap);
    float head = uHeadAmt * (exp(-near * near / 0.0012) + 0.6 * exp(-gap / uTail));
    float ring = line(r - uRadius, 0.0075) * (0.25 + 0.75 * behind) * (uBase + head * 2.2);
    float halo = exp(-pow((r - uRadius) / 0.03, 2.0)) * (0.06 + 0.4 * head);
    // and a small soft spark of light where it is
    vec2 at = uRadius * vec2(sin(uHead * TAU), -cos(uHead * TAU));
    float spark = exp(-dot(vP - at, vP - at) / 0.0011) * uHeadAmt * 0.55;
    // A faint pool inside, clearer from above where the column gives way
    float pool = (1.0 - smoothstep(0.0, uRadius, r)) * (0.015 + 0.1 * above) * uStrength;
    float light = (ring + halo + spark) * uCircle + pool;
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
  const heldLift =
    usePieceSetting<number>('piece.hoverLift') + usePieceSetting<number>('piece.heldGap');
  useEffect(
    () => invalidate(),
    [heightScale, brightness, particles, shimmer, heldLift, invalidate],
  );

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
        uHead: { value: 0 },
        uHeadAmt: { value: 0 },
        uTail: { value: 0.06 },
        uBase: { value: 0.62 },
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
    const height = columnHeight(top, heldLift, heightScale);
    const c = columnMaterial.uniforms;
    c.uTime.value = s.clock;
    c.uRise.value = s.rise;
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
    // The glint: none; once round, drawing the circle in; or on round, a
    // comet of light with a long tail on a quieter circle
    const circling = shimmer === 'slow' && !still;
    f.uTail.value = circling ? 0.16 : 0.06;
    f.uBase.value = circling ? 0.4 : 0.62;
    if (shimmer === 'off' || still) {
      f.uDraw.value = 1;
      f.uHeadAmt.value = 0;
    } else {
      f.uDraw.value = s.draw;
      f.uHead.value = s.spin % 1;
      f.uHeadAmt.value =
        shimmer === 'slow'
          ? s.spin < 1
            ? 1
            : 0.8
          : // once: it fades as it closes the circle
            smooth(clamp01((1 - s.spin) / 0.12));
    }
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
