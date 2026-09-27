import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  EquirectangularReflectionMapping,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Float32BufferAttribute,
  BackSide,
} from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import { FLOOR_Y, ROOM_HALF, ROOM_HEIGHT, TRAY_HALF } from './layout';
import { ROOM } from './palette';

// The lab round the tower: a semiconductor cleanroom bay, bright and hushed.
//
// - The room is a shell of three procedural shaders (no textures): a raised
//   floor of perforated air-return tiles that faintly mirrors the ceiling's
//   light panels; walls of modular panels with glass bands (a warm,
//   yellow-filtered lithography bay behind one wall, a cool corridor behind
//   another), grilles, kick plates and status LEDs; a ceiling of filter
//   units and light panels.
// - Equipment stands along the walls, all round, as soft pale silhouettes:
//   robot arms holding wafers, wafer stockers full of carriers, process tools
//   with signal towers, and an overhead transport track. It is one merged
//   mesh, lit flat and hazed by fog, so it reads as depth, never as detail
//   that competes with the board.
// - The pieces reflect the same room (an environment painted to match).
//
// Nothing here moves: the lab is still while nobody plays.

export const FOG_RANGE: [number, number] = [8, 95];
const CEILING_Y = FLOOR_Y + ROOM_HEIGHT;

// --- Shared GLSL -----------------------------------------------------------------------

const header = /* glsl */ `
  uniform vec3 uFog;
  uniform vec2 uFogRange;
  varying vec3 vWorld;

  float hash2(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  // Coverage of a line of half-width w at distance d (world units), given the
  // size of a pixel there: lines thinner than a pixel fade instead of breaking up.
  float line(float d, float w, float px) {
    float hw = max(w, px * 0.5);
    return (1.0 - smoothstep(hw - px * 0.5, hw + px * 0.5, d)) * min(1.0, w / (px * 0.5));
  }
  // 1 inside the rectangle lo..hi, antialiased
  float rect(vec2 p, vec2 lo, vec2 hi, float px) {
    vec2 a = smoothstep(lo - px * 0.5, lo + px * 0.5, p) *
      (1.0 - smoothstep(hi - px * 0.5, hi + px * 0.5, p));
    return a.x * a.y;
  }
  float dot2(vec2 p, vec2 c, float r, float px) {
    return 1.0 - smoothstep(r - px * 0.5, r + px * 0.5, length(p - c));
  }
  vec3 fogged(vec3 c) {
    float k = smoothstep(uFogRange.x, uFogRange.y, distance(cameraPosition, vWorld));
    return mix(c, uFog, k);
  }
`;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const color = (hex: string) => ({ value: new Color(hex) });
const fogUniforms = () => ({ uFog: color(ROOM.fog), uFogRange: { value: FOG_RANGE } });

// --- Floor ---------------------------------------------------------------------------

const floorFragment = /* glsl */ `
  ${header}
  uniform vec3 uFloor;
  uniform vec3 uPerf;
  uniform vec3 uHole;
  uniform vec3 uSeam;
  uniform vec3 uMark;
  uniform vec3 uPanel;
  uniform float uBase;
  uniform float uRoom;
  uniform float uCeiling;

  // The ceiling's light panels, as the glossy floor mirrors them: soft-edged
  float panels(vec2 q) {
    const float C = 2.4;
    vec2 cell = floor(q / C);
    vec2 f = abs(q - (cell + 0.5) * C);
    float lit = step(0.5, hash2(cell * 1.7 + 3.1));
    vec2 k = smoothstep(vec2(C * 0.5 - 0.1), vec2(C * 0.5 - 0.55), f);
    return lit * k.x * k.y;
  }

  void main() {
    vec2 p = vWorld.xz;
    vec2 fw = fwidth(p);
    float px = max(max(fw.x, fw.y), 1e-5);
    const float T = 1.6;
    vec2 cell = floor(p / T);
    vec2 f = p - (cell + 0.5) * T;
    vec2 e = T * 0.5 - abs(f);
    float seam = line(min(e.x, e.y), 0.011, px);

    // Air-return tiles (perforated) scattered over the bay; solid round the tool
    float ring = max(abs(p.x), abs(p.y));
    float perf = step(hash2(cell), 0.36) * step(uBase + 1.7, ring);
    vec3 col = mix(uFloor, uPerf, perf) * (0.985 + 0.03 * hash2(cell + 17.0));
    vec2 g = (f + T * 0.5 - 0.2) / ((T - 0.4) / 6.0);
    vec2 inside = step(vec2(-0.5), g) * step(g, vec2(6.5));
    float holeSize = (T - 0.4) / 6.0;
    float hole = dot2(fract(g + 0.5) - 0.5, vec2(0.0), 0.2, px / holeSize) * inside.x * inside.y;
    float far = smoothstep(0.012, 0.05, px);
    col = mix(col, uHole, perf * mix(hole * 0.4, 0.08, far));
    col = mix(col, uSeam, seam * 0.45);

    // The tool's keep-out line, a pale painted border
    float keep = uBase + 1.15;
    col = mix(col, uMark, line(abs(ring - keep), 0.03, px) * 0.6);

    // Soft occlusion round the tool's base and along the walls
    float outside = max(ring - uBase, 0.0);
    col *= 1.0 - 0.22 * exp(-outside / 0.55);
    col *= 1.0 - 0.12 * exp(-(uRoom - ring) / 2.5);

    // A glossy floor: the ceiling's panels, mirrored and softened
    vec3 view = normalize(cameraPosition - vWorld);
    vec3 r = reflect(-view, vec3(0.0, 1.0, 0.0));
    float t = (uCeiling - vWorld.y) / max(r.y, 0.05);
    float glint = panels(vWorld.xz + r.xz * t);
    float fres = 0.05 + 0.2 * pow(1.0 - view.y, 4.0);
    col = mix(col, uPanel, glint * fres);
    col = mix(col, uPanel, 0.35 * pow(1.0 - view.y, 6.0));

    gl_FragColor = vec4(fogged(col), 1.0);
    #include <colorspace_fragment>
  }`;

// --- Walls ---------------------------------------------------------------------------

const wallFragment = /* glsl */ `
  ${header}
  uniform vec3 uWall;
  uniform vec3 uShade;
  uniform vec3 uSeam;
  uniform vec3 uKick;
  uniform vec3 uGlass;
  uniform vec3 uAmber;
  uniform vec3 uPanel;
  uniform float uFloorY;
  uniform float uHeight;

  void main() {
    vec3 w = vWorld;
    float v = w.y - uFloorY;
    // Which wall (0 north, 1 east, 2 south, 3 west) and the distance along it,
    // left to right as seen from inside the room
    float wall;
    float u;
    if (abs(w.z) > abs(w.x)) {
      wall = w.z < 0.0 ? 0.0 : 2.0;
      u = w.z < 0.0 ? w.x : -w.x;
    } else {
      wall = w.x > 0.0 ? 1.0 : 3.0;
      u = w.x > 0.0 ? w.z : -w.z;
    }
    float px = max(max(fwidth(u), fwidth(v)), 1e-5);
    px = min(px, 0.5);

    const float M = 3.0;
    float mi = floor(u / M);
    float mf = u - (mi + 0.5) * M;
    vec3 col = mix(uShade, uWall, smoothstep(0.0, uHeight * 0.7, v));
    float seam = line(M * 0.5 - abs(mf), 0.016, px);

    // Kick plate
    col = mix(col, uKick, 1.0 - smoothstep(0.55 - px, 0.55 + px, v));
    seam = max(seam, line(abs(v - 0.55), 0.012, px));

    // Glass: a long band to the yellow bay (north), a corridor (south), and
    // pass-through hatches on the other walls
    float hasWin;
    float lo = 1.5;
    float hi = 5.9;
    if (wall == 0.0) {
      hasWin = step(0.5, mod(mi, 4.0));
      hi = 6.6;
    } else if (wall == 2.0) {
      hasWin = 1.0 - step(2.5, mod(mi, 3.0));
    } else {
      hasWin = 1.0 - step(0.5, abs(mod(mi, 5.0) - 2.0));
      lo = 3.2;
      hi = 4.6;
    }
    if (hasWin > 0.5) {
      float inset = 0.16;
      vec2 q = vec2(mf, v);
      float win = rect(q, vec2(-M * 0.5 + inset, lo), vec2(M * 0.5 - inset, hi), px);
      float frame = rect(q, vec2(-M * 0.5 + inset - 0.07, lo - 0.07), vec2(M * 0.5 - inset + 0.07, hi + 0.07), px) - win;
      float y = (v - lo) / (hi - lo);
      vec3 beyond;
      if (wall == 0.0) {
        // The lithography bay under yellow light: tools as darker shapes,
        // a row of lamps along its ceiling
        float h = hash2(vec2(mi, 3.0));
        beyond = mix(uAmber * 0.93, uAmber * 1.06, smoothstep(0.1, 1.0, y));
        float tool = rect(q, vec2(-0.9 + h * 0.6, lo), vec2(0.2 + h * 0.9, lo + 1.3 + h * 0.8), px);
        beyond = mix(beyond, uAmber * 0.8, tool * 0.7);
        beyond = mix(beyond, vec3(1.0, 0.97, 0.86), line(abs(v - hi + 0.35), 0.06, px) * 0.8);
      } else {
        // A corridor: its far wall, a handrail, doors
        beyond = mix(uGlass * 0.96, uGlass, smoothstep(0.0, 1.0, y));
        beyond = mix(beyond, uShade, line(abs(v - lo - 1.0), 0.03, px) * 0.8);
        float door = rect(q, vec2(0.15, lo), vec2(1.0, min(hi, lo + 3.4)), px) * step(0.5, hash2(vec2(mi, wall)));
        beyond = mix(beyond, uShade * 1.02, door * 0.5);
      }
      // Reflections on the glass: a faint diagonal sheen
      beyond = mix(beyond, vec3(1.0), 0.12 * smoothstep(0.3, 0.0, abs(fract((mf + v) * 0.12) - 0.5)));
      col = mix(col, beyond, win);
      col = mix(col, uKick, frame * 0.8);
    }

    // Return-air grilles along the lower wall and a band up high
    float grilleLo = rect(vec2(mf, v), vec2(-1.1, 0.75), vec2(1.1, 1.25), px) * (1.0 - hasWin);
    float grilleHi = rect(vec2(mf, v), vec2(-1.35, 8.0), vec2(1.35, 8.8), px);
    float slats = 0.5 + 0.5 * cos(v * 6.2831853 / 0.1);
    float slatFade = 1.0 - smoothstep(0.02, 0.06, px);
    col = mix(col, uShade * 0.95, (grilleLo + grilleHi) * mix(0.35, slats * 0.7, slatFade));

    // Status lights, one per module above the kick plate: pale, so no hue in
    // the room can be read as a level's
    float h = hash2(vec2(mi, wall + 9.0));
    vec3 led = h < 0.8 ? vec3(0.86, 0.95, 0.93) : vec3(0.93, 0.9, 1.0);
    float ledR = 0.055;
    float ledOn = dot2(vec2(mf, v), vec2(M * 0.5 - 0.42, 1.0), max(ledR, px * 0.7), px);
    col = mix(col, led, ledOn * min(1.0, ledR / (px * 0.7)));

    // A light cove where the walls meet the ceiling
    col = mix(col, uPanel, smoothstep(uHeight - 0.9, uHeight - 0.2, v) * 0.9);

    col = mix(col, uSeam, seam * 0.75);
    gl_FragColor = vec4(fogged(col), 1.0);
    #include <colorspace_fragment>
  }`;

// --- Ceiling -------------------------------------------------------------------------

const ceilingFragment = /* glsl */ `
  ${header}
  uniform vec3 uCeiling;
  uniform vec3 uPanel;
  uniform vec3 uSeam;
  void main() {
    vec2 p = vWorld.xz;
    vec2 fw = fwidth(p);
    float px = max(max(fw.x, fw.y), 1e-5);
    const float C = 2.4;
    vec2 cell = floor(p / C);
    vec2 f = p - (cell + 0.5) * C;
    vec2 e = C * 0.5 - abs(f);
    float lit = step(0.5, hash2(cell * 1.7 + 3.1));
    vec3 col = uCeiling;
    // Filter units: a round fan grille
    float fan = line(abs(length(f) - 0.62), 0.03, px) * (1.0 - lit);
    col = mix(col, uSeam, fan * 0.35);
    // Light panels, a touch brighter at their centre
    vec3 panel = mix(uPanel * 0.97, uPanel, smoothstep(C * 0.5, 0.0, max(abs(f.x), abs(f.y))));
    col = mix(col, panel, lit * rect(f, vec2(-C * 0.5 + 0.12), vec2(C * 0.5 - 0.12), px));
    col = mix(col, uSeam, line(min(e.x, e.y), 0.05, px) * 0.8);
    gl_FragColor = vec4(fogged(col), 1.0);
    #include <colorspace_fragment>
  }`;

const roomMaterials = () => ({
  floor: new ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uFloor: color(ROOM.floor),
      uPerf: color(ROOM.floorPerf),
      uHole: color(ROOM.floorHole),
      uSeam: color(ROOM.seam),
      uMark: color('#b3bcc6'),
      uPanel: color(ROOM.panel),
      uBase: { value: TRAY_HALF + 0.35 },
      uRoom: { value: ROOM_HALF },
      uCeiling: { value: CEILING_Y },
    },
    vertexShader: vertex,
    fragmentShader: floorFragment,
  }),
  walls: new ShaderMaterial({
    side: BackSide,
    uniforms: {
      ...fogUniforms(),
      uWall: color(ROOM.wall),
      uShade: color(ROOM.wallShade),
      uSeam: color(ROOM.seam),
      uKick: color(ROOM.kick),
      uGlass: color(ROOM.glass),
      uAmber: color(ROOM.amber),
      uPanel: color(ROOM.panel),
      uFloorY: { value: FLOOR_Y },
      uHeight: { value: ROOM_HEIGHT },
    },
    vertexShader: vertex,
    fragmentShader: wallFragment,
  }),
  ceiling: new ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uCeiling: color(ROOM.ceiling),
      uPanel: color(ROOM.panel),
      uSeam: color(ROOM.seam),
    },
    vertexShader: vertex,
    fragmentShader: ceilingFragment,
  }),
});

// --- Equipment -----------------------------------------------------------------------

type Tone = 'body' | 'shade' | 'dark' | 'glass' | 'wafer';
const TONES: Record<Tone, string> = {
  body: ROOM.equipment,
  shade: ROOM.equipmentShade,
  dark: '#a9b2bc',
  glass: '#d3dbe3',
  wafer: '#b7bfd3',
};

// Status lights in the room are near-white: a coloured dot seen through a
// tray could be read as part of that level
const LED_WHITE = '#e4fbf2';

interface Led {
  at: [number, number, number];
  color: string;
  size?: number;
}

/**
 * Builds the equipment as one mesh: parts are placed in a scene graph (so a
 * robot's joints compose), then baked into a single vertex-coloured geometry.
 */
const buildEquipment = () => {
  const root = new Group();
  const leds: Led[] = [];
  const random = rng(7);
  const box = new BoxGeometry(1, 1, 1);
  const cyl = new CylinderGeometry(1, 1, 1, 14);
  const put = (
    parent: Object3D,
    geometry: BufferGeometry,
    tone: Tone,
    size: [number, number, number],
    at: [number, number, number] = [0, 0, 0],
    rot: [number, number, number] = [0, 0, 0],
  ) => {
    const m = new Mesh(geometry);
    m.userData.tone = tone;
    m.scale.set(...size);
    m.position.set(...at);
    m.rotation.set(...rot);
    parent.add(m);
    return m;
  };
  const node = (
    parent: Object3D,
    at: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
  ) => {
    const g = new Group();
    g.position.set(...at);
    g.rotation.set(...rot);
    parent.add(g);
    return g;
  };
  const worldOf = (o: Object3D, local: [number, number, number]): [number, number, number] => {
    o.updateWorldMatrix(true, false);
    const v = o.localToWorld(new Vector3(...local));
    return [v.x, v.y, v.z];
  };

  /** A six-axis wafer-handling robot on a pedestal, holding a wafer. */
  const robot = (x: number, z: number, yaw: number, shoulder: number, elbow: number) => {
    const base = node(root, [x, FLOOR_Y, z], [0, yaw, 0]);
    put(base, box, 'shade', [1.8, 1.3, 1.8], [0, 0.65, 0]);
    put(base, cyl, 'body', [0.75, 0.35, 0.75], [0, 1.48, 0]);
    put(base, cyl, 'body', [0.52, 1.0, 0.52], [0, 2.15, 0]);
    const s = node(base, [0, 2.75, 0], [shoulder, 0, 0]);
    put(s, cyl, 'shade', [0.5, 1.15, 0.5], [0, 0, 0], [0, 0, Math.PI / 2]);
    put(s, box, 'body', [0.55, 3.0, 0.62], [0.05, 1.5, 0]);
    const e = node(s, [0, 3.0, 0], [elbow, 0, 0]);
    put(e, cyl, 'shade', [0.4, 0.9, 0.4], [0, 0, 0], [0, 0, Math.PI / 2]);
    put(e, box, 'body', [0.42, 2.5, 0.46], [0, 1.25, 0]);
    const wr = node(e, [0, 2.55, 0], [-0.5 - shoulder - elbow + Math.PI / 2, 0, 0]);
    put(wr, cyl, 'shade', [0.28, 0.5, 0.28], [0, 0.1, 0]);
    put(wr, box, 'dark', [0.7, 0.06, 1.1], [0, 0.38, 0.4]);
    put(wr, cyl, 'wafer', [0.62, 0.025, 0.62], [0, 0.43, 0.55]);
    leds.push({ at: worldOf(base, [0.72, 1.1, 0.91]), color: LED_WHITE });
  };

  /** A wafer stocker: open shelving full of wafer carriers. */
  const stocker = (x: number, z: number, yaw: number, bays: number) => {
    const g = node(root, [x, FLOOR_Y, z], [0, yaw, 0]);
    const w = bays * 1.25 + 0.4;
    put(g, box, 'shade', [w, 9, 0.3], [0, 4.5, -1.2]);
    put(g, box, 'body', [0.25, 9.2, 2.6], [-w / 2, 4.6, 0]);
    put(g, box, 'body', [0.25, 9.2, 2.6], [w / 2, 4.6, 0]);
    put(g, box, 'body', [w + 0.3, 0.5, 2.7], [0, 9.3, 0]);
    put(g, box, 'body', [w + 0.3, 0.8, 2.7], [0, 0.4, 0]);
    for (let row = 0; row < 6; row++) {
      const y = 1.2 + row * 1.35;
      put(g, box, 'shade', [w, 0.07, 2.2], [0, y, -0.05]);
      for (let b = 0; b < bays; b++) {
        if (random() < 0.18) continue;
        const bx = -w / 2 + 0.2 + 0.62 + b * 1.25;
        put(g, box, 'body', [0.95, 0.85, 1.0], [bx, y + 0.46, 0]);
        put(g, box, 'glass', [0.8, 0.6, 0.05], [bx, y + 0.46, 0.52]);
      }
      if (row % 2 === 0)
        leds.push({ at: worldOf(g, [w / 2 - 0.05, y + 0.2, 1.32]), color: LED_WHITE });
    }
    leds.push({ at: worldOf(g, [-w / 2 + 0.2, 9.3, 1.37]), color: LED_WHITE });
  };

  /** A process tool: a cabinet with a window, a touch screen and a signal tower. */
  const tool = (x: number, z: number, yaw: number, w: number) => {
    const g = node(root, [x, FLOOR_Y, z], [0, yaw, 0]);
    put(g, box, 'body', [w, 3.6, 3.2], [0, 1.8, 0]);
    put(g, box, 'shade', [w * 0.7, 0.9, 2.6], [0, 4.05, -0.2]);
    put(g, box, 'glass', [w * 0.55, 1.4, 0.06], [-w * 0.1, 2.2, 1.61]);
    put(g, box, 'shade', [w + 0.05, 0.35, 3.25], [0, 0.18, 0]);
    // Touch screen on an arm
    put(g, cyl, 'shade', [0.06, 1.0, 0.06], [w / 2 - 0.3, 3.3, 1.7], [0.6, 0, 0]);
    put(g, box, 'dark', [0.9, 0.6, 0.08], [w / 2 - 0.3, 3.75, 2.05], [-0.25, 0, 0]);
    // Signal tower: green lit, amber and red dark
    const tx = -w / 2 + 0.35;
    put(g, cyl, 'shade', [0.05, 0.5, 0.05], [tx, 3.85, 1.2]);
    put(g, cyl, 'shade', [0.14, 0.18, 0.14], [tx, 4.2, 1.2]);
    put(g, cyl, 'shade', [0.14, 0.18, 0.14], [tx, 4.4, 1.2]);
    leds.push({ at: worldOf(g, [tx, 4.62, 1.2]), color: LED_WHITE, size: 0.16 });
    leds.push({ at: worldOf(g, [w * 0.3, 1.2, 1.62]), color: LED_WHITE });
  };

  const R = ROOM_HALF;
  const edge = R - 3.2;
  // North: the tools before the yellow bay, a robot between them
  tool(-9, -edge, 0, 5);
  tool(8.5, -edge, 0, 6);
  robot(0.5, -edge + 0.6, 0.3, 0.55, 0.9);
  tool(-20, -edge, 0, 4.5);
  stocker(19, -edge + 0.4, 0, 6);
  // East: stockers
  stocker(edge, -8, -Math.PI / 2, 9);
  stocker(edge, 6, -Math.PI / 2, 8);
  robot(edge - 1.5, 17, -Math.PI / 2 - 0.4, 0.3, 1.2);
  // South: a robot cell and tools
  robot(-6, edge - 0.6, Math.PI + 0.2, 0.7, 0.7);
  robot(4, edge - 0.6, Math.PI - 0.5, 0.2, 1.3);
  tool(14, edge, Math.PI, 5.5);
  tool(-17, edge, Math.PI, 5);
  // West: tools and a stocker
  tool(-edge, 9, Math.PI / 2, 6);
  tool(-edge, -2, Math.PI / 2, 5);
  stocker(-edge + 0.4, -14, Math.PI / 2, 7);
  robot(-edge + 1.5, 19, Math.PI / 2 + 0.3, 0.45, 1.0);

  // The overhead transport track: a loop of rail on hangers, with carriers
  const track = node(root, [0, CEILING_Y - 3.2, 0]);
  const L = 21;
  for (const s of [-1, 1]) {
    put(track, box, 'shade', [L * 2 + 0.4, 0.35, 0.45], [0, 0, s * L]);
    put(track, box, 'shade', [0.45, 0.35, L * 2 + 0.4], [s * L, 0, 0]);
    for (let k = -L; k <= L; k += 6) {
      put(track, box, 'shade', [0.08, 3.2, 0.08], [k, 1.6, s * L]);
      put(track, box, 'shade', [0.08, 3.2, 0.08], [s * L, 1.6, k]);
    }
  }
  for (const [cx, cz] of [
    [-6, -L],
    [L, 9],
    [11, L],
    [-L, -13],
  ]) {
    const along = Math.abs(cz) === L;
    put(track, box, 'body', along ? [1.3, 1.0, 1.0] : [1.0, 1.0, 1.3], [cx, -0.7, cz]);
  }

  // Bake
  root.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  const c = new Color();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const g = (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    g.deleteAttribute('uv');
    c.set(TONES[o.userData.tone as Tone]);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('aTone', new Float32BufferAttribute(colors, 3));
    parts.push(g);
  });
  const geometry = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  box.dispose();
  cyl.dispose();
  return { geometry, leds };
};

/**
 * Soft, flat shading for the far equipment: tops a little lighter than sides,
 * never a hard shadow, and an extra veil of haze, so it reads as pale
 * silhouettes in the bay rather than as objects to look at.
 */
const equipmentMaterial = () =>
  new ShaderMaterial({
    uniforms: { ...fogUniforms(), uVeil: { value: 0.22 } },
    vertexShader: /* glsl */ `
      attribute vec3 aTone;
      varying vec3 vTone;
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        vTone = aTone;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${header}
      uniform float uVeil;
      varying vec3 vTone;
      varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        float lit = 0.84 + 0.12 * n.y + 0.05 * dot(n, normalize(vec3(0.4, 0.2, 0.9)));
        vec3 c = vTone * lit;
        float k = smoothstep(uFogRange.x, uFogRange.y, distance(cameraPosition, vWorld));
        gl_FragColor = vec4(mix(c, uFog, uVeil + (1.0 - uVeil) * k), 1.0);
        #include <colorspace_fragment>
      }`,
  });

const Equipment = () => {
  const { geometry, leds, material, ledMesh } = useMemo(() => {
    const { geometry, leds } = buildEquipment();
    const material = equipmentMaterial();
    const ledMesh = new InstancedMesh(
      new SphereGeometry(1, 6, 4),
      new MeshBasicMaterial({ toneMapped: false, fog: false }),
      leds.length,
    );
    const m = new Matrix4();
    const c = new Color();
    leds.forEach((l, i) => {
      const s = l.size ?? 0.09;
      m.makeScale(s, s, s).setPosition(...l.at);
      ledMesh.setMatrixAt(i, m);
      ledMesh.setColorAt(i, c.set(l.color));
    });
    ledMesh.raycast = noRaycast;
    return { geometry, leds, material, ledMesh };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      ledMesh.geometry.dispose();
      (ledMesh.material as MeshBasicMaterial).dispose();
    },
    [geometry, material, ledMesh],
  );
  return (
    <>
      <mesh geometry={geometry} material={material} raycast={noRaycast} />
      {leds.length > 0 && <primitive object={ledMesh} />}
    </>
  );
};

// --- Room ----------------------------------------------------------------------------

/**
 * The four walls: a box seen from inside, without its top and bottom (the
 * bottom would fight the floor, and the ceiling is its own plane).
 */
const wallsGeometry = (size: number) => {
  const box = new BoxGeometry(size, ROOM_HEIGHT, size).translate(0, FLOOR_Y + ROOM_HEIGHT / 2, 0);
  const index = box.index!.array;
  const keep: number[] = [];
  for (const g of box.groups) {
    // Groups in order +x, -x, +y, -y, +z, -z
    if (g.materialIndex === 2 || g.materialIndex === 3) continue;
    for (let i = g.start; i < g.start + g.count; i++) keep.push(index[i]);
  }
  box.setIndex(keep);
  box.clearGroups();
  return box;
};

const Room = () => {
  const { materials, walls, floor, ceiling } = useMemo(() => {
    const size = ROOM_HALF * 2;
    return {
      materials: roomMaterials(),
      walls: wallsGeometry(size),
      floor: new PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(0, FLOOR_Y, 0),
      // Faces down: seen from inside, culled when the camera looks in from above
      ceiling: new PlaneGeometry(size, size).rotateX(Math.PI / 2).translate(0, CEILING_Y, 0),
    };
  }, []);
  useEffect(
    () => () => {
      Object.values(materials).forEach((m) => m.dispose());
      [walls, floor, ceiling].forEach((g) => g.dispose());
    },
    [materials, walls, floor, ceiling],
  );
  return (
    <group name="cleanroom">
      <mesh geometry={floor} material={materials.floor} raycast={noRaycast} />
      <mesh geometry={walls} material={materials.walls} raycast={noRaycast} />
      <mesh geometry={ceiling} material={materials.ceiling} raycast={noRaycast} />
    </group>
  );
};

// --- Reflections ---------------------------------------------------------------------

/**
 * The room as the glossy pieces see it: a pale bay, rows of light panels
 * overhead, the yellow bay's glow low in the north, a grey floor. Painted
 * once on an equirectangular canvas.
 */
const envTexture = (() => {
  let t: CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const W = 512;
    const H = 256;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#dde2e8');
    g.addColorStop(0.3, '#e2e6ea');
    g.addColorStop(0.47, '#e9ecef');
    g.addColorStop(0.5, '#d9dee4');
    g.addColorStop(0.53, '#b9c0c8');
    g.addColorStop(1, '#7d8792');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Column of a world azimuth (three's equirect mapping), row of an elevation
    const column = (x: number, z: number) => ((Math.atan2(z, x) / (2 * Math.PI) + 0.5) % 1) * W;
    const row = (deg: number) => (0.5 - deg / 180) * H;
    // The yellow bay, low in the north
    const amber = ctx.createLinearGradient(0, row(14), 0, row(2));
    amber.addColorStop(0, 'rgba(241, 214, 140, 0)');
    amber.addColorStop(0.5, 'rgba(239, 226, 176, 0.8)');
    amber.addColorStop(1, 'rgba(241, 214, 140, 0)');
    ctx.fillStyle = amber;
    const north = column(0, -1);
    ctx.fillRect(north - W * 0.12, row(14), W * 0.24, row(2) - row(14));
    // Rows of ceiling panels
    ctx.fillStyle = '#ffffff';
    for (const [el, n, w, h] of [
      [22, 20, 7, 5],
      [34, 16, 9, 7],
      [50, 12, 13, 9],
      [68, 8, 20, 10],
    ]) {
      for (let i = 0; i < n; i++) {
        const x = ((i + (el % 2) * 0.5) / n) * W;
        ctx.fillRect(x - w / 2, row(el) - h / 2, w, h);
      }
    }
    // A broad soft key overhead, toward the players
    const key = ctx.createRadialGradient(
      column(0.3, 0.5),
      row(62),
      0,
      column(0.3, 0.5),
      row(62),
      60,
    );
    key.addColorStop(0, 'rgba(255,255,255,0.9)');
    key.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = key;
    ctx.fillRect(0, 0, W, H);
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    tex.mapping = EquirectangularReflectionMapping;
    t = tex;
    return tex;
  };
})();

const Atmosphere = () => {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const previous = {
      environment: scene.environment,
      fog: scene.fog,
      background: scene.background,
    };
    scene.environment = envTexture();
    scene.fog = new Fog(ROOM.fog, FOG_RANGE[0], FOG_RANGE[1]);
    scene.background = new Color(ROOM.fog);
    return () => {
      scene.environment = previous.environment;
      scene.fog = previous.fog;
      scene.background = previous.background;
    };
  }, [scene]);
  return null;
};

// --- Stage ---------------------------------------------------------------------------

export const Stage = () => (
  <>
    <Atmosphere />
    {/* Light panels overhead: a broad sky, a key from above the players, a cool edge from behind */}
    <hemisphereLight args={['#ffffff', '#a9b2bc', 1.35]} />
    <directionalLight position={[4, 12, 7]} intensity={1.5} />
    <directionalLight position={[-5, 7, -9]} intensity={0.9} color="#e6efff" />
    <Room />
    <Equipment />
  </>
);
