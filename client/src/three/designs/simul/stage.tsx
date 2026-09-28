import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { prefersReducedMotion } from '../../motion';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
import { rng } from '../kit/textures';
import { TOWER_MASK } from './mask';
import { FRAME, PALETTE, TABLE_Y } from './palette';
import { rig } from './pieces';
import { steepness } from './plates';

// The hall. The tower stands in the open middle of an endless, dark
// tournament hall, abstracted into light: a square of tables close round it,
// as for a simultaneous exhibition, and beyond them long rows of tables
// receding into the gloom in every direction. On each table lies a small
// board, drawn only as a faint 8×8 grid of warm light over a soft pool of
// lamp light, with a chess clock glowing beside it: two tiny faces, the
// running one lit. Now and then, somewhere in the hall, a clock is pressed
// and its light eases over to the other face. Overhead, long thin strips of
// light run the length of the hall (seen only from low down, far off).
//
// All of it is dim, warm, far below the tower and fading with distance, so
// it reads as a place and never as part of the game: the tables keep clear
// of the ground under the tower (seen from above, there is only darkness
// through the platforms), and whatever lies behind the tower, seen through
// its platforms from wherever the camera is, is held down to nothing by the
// tower mask (mask.ts), so nothing that flickers ever sits behind it.
//
// The whole hall is one geometry of flat quads drawn by one shader (the
// review machine renders in software): each quad knows what it is (a board,
// a clock or a table), and the mask and the distance fade are worked out per
// vertex.

// --- Layout ---------------------------------------------------------------------------

/** Side of a board on a table (world units). */
const BOARD = 0.9;
/** The quad drawn for a board: the board and the pool of lamp light round it. */
const BOARD_QUAD = 2.2;
/** How far the simul's square of tables stands from the tower's centre. */
const SIMUL = 8.6;
/** Tables in the rows start beyond this square round the tower. */
const CLEAR = 12;
/** Distance between the rows, and how far they run. */
const ROW_GAP = 3.6;
const REACH = 54;

interface Item {
  kind: number;
  x: number;
  z: number;
  /** Heading of the item's local x axis (radians about y). */
  angle: number;
  /** Half extents of the quad (world units). */
  hx: number;
  hz: number;
  /** Local units per world unit (boards are drawn in board units). */
  unit: number;
  seed: number;
  /** Quads along the local x axis (long tables are split, for the per-vertex mask). */
  segments?: number;
  /** Height (world), when not on a table. */
  y?: number;
}

const KIND = { board: 0, clock: 1, table: 2, strip: 3 } as const;

/**
 * The hall's overhead strips hang this high: above the camera in the
 * opening view, so they show only from low down, far off under the ceiling
 * (and fade away as the camera rises toward them).
 */
const STRIP_Y = FRAME.levelY[4] + 4;

/** Every table, board and clock in the hall. */
const hallItems = (): Item[] => {
  const random = rng(7);
  const items: Item[] = [];
  // A board, and its clock to the right of it (seen by the player facing it)
  const board = (x: number, z: number, angle: number) => {
    items.push({
      kind: KIND.board,
      x,
      z,
      angle,
      hx: BOARD_QUAD / 2,
      hz: BOARD_QUAD / 2,
      unit: 1 / BOARD,
      seed: random(),
    });
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const off = BOARD / 2 + 0.3;
    items.push({
      kind: KIND.clock,
      x: x + c * off,
      z: z - s * off,
      angle: angle + Math.PI / 2,
      hx: 0.2,
      hz: 0.1,
      unit: 1 / 0.2,
      seed: random(),
    });
  };
  const table = (x: number, z: number, angle: number, length: number) =>
    items.push({
      kind: KIND.table,
      x,
      z,
      angle,
      hx: length / 2,
      hz: 0.55,
      unit: 1,
      seed: random(),
      segments: Math.max(1, Math.round(length / 2)),
    });

  // The simul: a square of tables round the tower, the boards facing in
  for (let side = 0; side < 4; side++) {
    const angle = (side * Math.PI) / 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Local x runs along the side, local z points out from the centre
    const along = (u: number, out: number): [number, number] => [c * u + s * out, -s * u + c * out];
    const [tx, tz] = along(0, SIMUL);
    table(tx, tz, angle, SIMUL * 2 - 1.6);
    for (let i = -4; i <= 4; i++) {
      const [bx, bz] = along(i * 1.75, SIMUL);
      board(bx, bz, angle);
    }
  }

  // The rows: long tables of three boards, beyond the simul, as far as the eye goes
  const LENGTH = 5.6;
  const PERIOD = 7.2;
  for (let row = -Math.floor(REACH / ROW_GAP); row <= Math.floor(REACH / ROW_GAP); row++) {
    const z = row * ROW_GAP;
    // Each row slides a little, so the tables do not line up into columns
    const shift = (random() - 0.5) * PERIOD;
    for (let x = -REACH + shift; x <= REACH; x += PERIOD) {
      if (Math.abs(x) < CLEAR + LENGTH / 2 && Math.abs(z) < CLEAR) continue;
      if (Math.hypot(x, z) > REACH + 4) continue;
      // Players on both sides of a row: every other row faces the other way
      const angle = row % 2 === 0 ? 0 : Math.PI;
      table(x, z, angle, LENGTH);
      for (let k = -1; k <= 1; k++) board(x + k * 1.9, z, angle);
    }
  }
  // Overhead, long thin strips of light run the length of the hall
  for (let z = -REACH + 3.6; z <= REACH - 3.6; z += ROW_GAP * 3) {
    items.push({
      kind: KIND.strip,
      x: 0,
      z,
      angle: 0,
      hx: REACH + 8,
      hz: 0.25,
      unit: 1,
      seed: random(),
      segments: 40,
      y: STRIP_Y,
    });
  }
  return items;
};

/** The hall as one geometry: a quad (or a strip of them) per item. */
const hallGeometry = (): BufferGeometry => {
  const items = hallItems();
  const positions: number[] = [];
  const locals: number[] = [];
  const infos: number[] = [];
  const index: number[] = [];
  for (const it of items) {
    const n = it.segments ?? 1;
    const c = Math.cos(it.angle);
    const s = Math.sin(it.angle);
    const base = positions.length / 3;
    for (let i = 0; i <= n; i++) {
      const u = -it.hx + (2 * it.hx * i) / n;
      for (const v of [-it.hz, it.hz]) {
        // Local (u, v) to world: x axis heading `angle` about y
        positions.push(it.x + c * u + s * v, it.y ?? TABLE_Y, it.z - s * u + c * v);
        locals.push(u * it.unit, v * it.unit);
        infos.push(it.kind, it.seed, it.hx * it.unit, it.hz * it.unit);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('aLocal', new BufferAttribute(new Float32Array(locals), 2));
  g.setAttribute('aInfo', new BufferAttribute(new Float32Array(infos), 4));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
};

// --- The shader -------------------------------------------------------------------------

const hallVertex = /* glsl */ `
  attribute vec2 aLocal;
  attribute vec4 aInfo;
  uniform float uSteep;
  varying vec2 vLocal;
  varying vec4 vInfo;
  varying float vFade;
  varying float vDist;
  ${TOWER_MASK}
  void main() {
    vLocal = aLocal;
    vInfo = aInfo;
    vec4 w = modelMatrix * vec4(position, 1.0);
    float d = length(w.xz);
    vDist = d;
    // Dim with distance into the gloom, and held down to nothing behind the tower
    // The simul's square close round the tower is the nearest to any
    // camera, so it is drawn quieter than the rows beyond
    float far = exp(-max(d - 9.0, 0.0) / 17.0) * (0.5 + 0.5 * smoothstep(9.5, 13.0, d));
    if (aInfo.x > 2.5) {
      // A strip: seen from far off; gone as the camera rises toward it
      far = exp(-max(d - 30.0, 0.0) / 24.0) * (1.0 - smoothstep(${(STRIP_Y - 3).toFixed(2)}, ${(STRIP_Y - 0.8).toFixed(2)}, cameraPosition.y));
    }
    vFade = far * (1.0 - towerCover(w.xyz)) * (1.0 - 0.72 * uSteep);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const hallFragment = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uClockOn;
  uniform vec3 uClockOff;
  uniform vec3 uStrip;
  uniform float uTime;
  uniform float uWave;
  varying vec2 vLocal;
  varying vec4 vInfo;
  varying float vFade;
  varying float vDist;

  // Coverage of lines at whole numbers of x, of width w (in x's units):
  // lines thinner than a pixel fade rather than alias, so a far board
  // settles into a soft glow
  float lines(float x, float w) {
    float d = abs(fract(x + 0.5) - 0.5);
    float fw = max(fwidth(x), 1e-5);
    float draw = max(w, fw);
    float a = 1.0 - smoothstep(draw * 0.5 - fw * 0.5, draw * 0.5 + fw * 0.5, d);
    return a * min(w / draw, 1.0);
  }
  float roundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    if (vFade < 0.004) discard;
    float kind = vInfo.x;
    float seed = vInfo.y;
    vec2 p = vLocal;
    vec3 col;
    if (kind < 0.5) {
      // A board: an 8×8 grid of warm light with a faint checker, on a soft
      // pool of lamp light (p in board units: the board is -0.5 to 0.5)
      float on = step(max(abs(p.x), abs(p.y)), 0.5);
      vec2 g = (p + 0.5) * 8.0;
      float grid = max(lines(g.x, 0.07), lines(g.y, 0.07)) * on;
      vec2 sq = floor(g);
      float lightSq = mod(sq.x + sq.y, 2.0) * on;
      float pool = exp(-dot(p, p) / 0.3);
      float glow = pool * 0.016 + lightSq * 0.014 + grid * 0.068;
      col = uLight * glow;
    } else if (kind < 1.5) {
      // A chess clock: two small faces in a faint case, the running one lit.
      // In about a third of the games, now and then (each at its own slow
      // pace), the clock is pressed: the light eases over to the other face
      float live = step(seed, 0.35);
      float period = 20.0 + fract(seed * 13.7) * 40.0;
      float t = uTime + seed * 97.0;
      float turn = live * mod(floor(t / period), 2.0);
      float since = live > 0.5 ? mod(t, period) : 99.0;
      float ease = smoothstep(0.0, 0.5, since);
      float side = mix(1.0 - turn, turn, ease) * 2.0 - 1.0;
      vec2 q = p - vec2(0.45 * side, 0.0);
      vec2 o = p + vec2(0.45 * side, 0.0);
      float on = exp(-dot(q, q) / 0.05);
      float off = exp(-dot(o, o) / 0.05);
      float box = abs(roundBox(p, vec2(0.95, 0.45), 0.2));
      float fw = max(fwidth(box), 1e-4);
      float frame = (1.0 - smoothstep(0.03, 0.03 + fw * 1.5, box)) * 0.12;
      float press = exp(-since / 0.4) * 0.15;
      col = uClockOn * on * (0.4 + press) + uClockOff * (off * 0.1 + frame * 0.5);
    } else if (kind > 2.5) {
      // An overhead strip: a thin line of warm light, softly haloed
      float d = abs(p.y);
      float fw = max(fwidth(d), 1e-4);
      float core = (1.0 - smoothstep(0.035, 0.035 + fw * 1.5, d)) * min(0.035 / fw, 1.0);
      col = uStrip * (core * 0.22 + exp(-d * d / 0.012) * 0.05);
    } else {
      // A table: its dark top only catches a little of the lamps' light,
      // most along its middle where the boards stand
      float across = abs(p.y) / vInfo.w;
      float along = abs(p.x) / vInfo.z;
      float top = (1.0 - smoothstep(0.7, 1.0, across)) * (1.0 - smoothstep(0.96, 1.0, along));
      col = uLight * top * 0.007;
    }
    // At a mate, a slow wave of light runs out through the hall once
    if (uWave >= 0.0) {
      float front = 6.0 + uWave * 16.0;
      col *= 1.0 + 1.4 * exp(-pow((vDist - front) / 4.0, 2.0)) * (1.0 - smoothstep(2.5, 3.5, uWave));
    }
    gl_FragColor = vec4(col * vFade, 1.0);
    #include <colorspace_fragment>
  }`;

/** The time since the mate, for the wave through the hall (below zero: none). Set by the Celebration. */
export const hallWave = { value: -1 };

const Hall = () => {
  const invalidate = useThree((s) => s.invalidate);
  const { geometry, material } = useMemo(() => {
    const geometry = hallGeometry();
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // The strips are seen from below
      side: DoubleSide,
      uniforms: {
        uLight: { value: new Color(PALETTE.hallLight) },
        uClockOn: { value: new Color(PALETTE.clockOn) },
        uClockOff: { value: new Color(PALETTE.clockOff) },
        uStrip: { value: new Color(PALETTE.strip) },
        uTime: { value: 0 },
        uWave: hallWave,
        uSteep: steepness,
      },
      vertexShader: hallVertex,
      fragmentShader: hallFragment,
    });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const still = useRef(prefersReducedMotion());
  useFrame((_, delta) => {
    // The clocks keep time on r3f's clock; the hall asks for frames only
    // while they run (never with reduced motion)
    if (still.current) return;
    material.uniforms.uTime.value += Math.min(delta, 1 / 10);
    invalidate();
  });
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-900}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Lights -------------------------------------------------------------------------------

const UP = new Vector3(0, 1, 0);
const forward = new Vector3();
const right = new Vector3();
const origin = new Vector3();
const scratch = new Vector3();

const place = (
  out: Vector3,
  camera: Camera,
  target: Vector3,
  back: number,
  side: number,
  up: number,
) => {
  forward.copy(target).sub(camera.position).normalize();
  right.crossVectors(forward, UP).normalize();
  return out
    .copy(target)
    .addScaledVector(forward, -back)
    .addScaledVector(right, side)
    .addScaledVector(UP, up)
    .sub(target)
    .normalize();
};

/**
 * The pieces' light rig rides with the camera (a soft key over its left
 * shoulder, a dim fill low on its right), so the armies are modelled the
 * same way from every side and both seats.
 */
const CameraRig = () => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;
  useFrame(() => {
    const target = controls?.target ?? origin;
    place(scratch, camera, target, 8, -5, 9);
    rig.key.value.copy(scratch);
    place(scratch, camera, target, 6, 7, 1);
    rig.fill.value.copy(scratch);
  });
  return null;
};

export const Stage = () => (
  <>
    <GradientSky
      top={PALETTE.skyTop}
      horizon={PALETTE.skyHorizon}
      bottom={PALETTE.skyBottom}
      exponent={0.55}
    />
    <Hall />
    <CameraRig />
  </>
);
