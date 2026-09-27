import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  BoxGeometry,
  ClampToEdgeWrapping,
  BufferAttribute,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TorusKnotGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { BufferGeometry, DirectionalLight, IUniform, WebGLRenderer } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noRaycast } from '../kit/noRaycast';
import type { Vec3 } from '../types';
import { paintingAtlas } from './art';
import { rodOffset } from './plates';
import { ROOM } from './palette';
import { ROOM_GLSL, ROOM_RADIUS, SCULPTURE_PHASE, SCULPTURE_RING, SCULPTURES } from './room';

// The world: the tower is the centrepiece of a dark sculpture rotunda after
// hours. It stands on a black plinth on a low round dais, ringed by brass
// stanchions and red velvet rope. Round it, in the gloom, eight sculptures
// stand on their plinths in pools of light; the curved wall is hung with
// paintings under picture lights, broken by two doorways onto dim rooms
// beyond (one with its exit sign's faint green glow), and high up a ring of
// windows lets in the moonlight. The polished concrete floor reflects the
// scallops of light on the walls. Everything is low in contrast and still,
// and the same all the way round, so no angle is the "front".

// --- Lights ------------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * Lights that travel with the camera, so every piece is modelled the same
 * from any orbit and either seat: a warm gallery key over the viewer's left
 * shoulder and a cool moonlit rim from behind the tower.
 */
const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const az = Math.atan2(camera.position.x, camera.position.z);
    const place = (light: DirectionalLight | null, azimuth: number, elevation: number) => {
      light?.position.set(
        Math.sin(azimuth) * Math.cos(elevation) * 12,
        Math.sin(elevation) * 12,
        Math.cos(azimuth) * Math.cos(elevation) * 12,
      );
    };
    place(key.current, az - 50 * DEG, 46 * DEG);
    place(rim.current, az + 180 * DEG + 30 * DEG, 32 * DEG);
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.8} color="#fff1e0" />
      <directionalLight ref={rim} intensity={1.2} color="#c9d8f2" />
    </>
  );
};

// --- Walls and floor ---------------------------------------------------------------
//
// The room is still, so everything but the floor's reflection is painted
// once, when the stage mounts, into textures (the walls into a strip round
// the rotunda, the floor, the dais and the plinth top into squares), and
// drawn each frame with a single lookup. The floor's polish looks up the
// walls' strip, blurred, where the reflected view ray meets them.

/** The walls' height, and the size of every baked texture. */
const WALL_H = 22;
const WALL_TEX: [number, number] = [4096, 768];
const FLOOR_TEX = 2048;

const bakeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

// A texel of the walls' strip: u runs round the room as the cylinder's own
// u does (world angle PI/2 - u * TAU), v up the wall
const wallBake = /* glsl */ `
  ${ROOM_GLSL}
  uniform float uH;
  varying vec2 vUv;
  void main() {
    float theta = mod(1.5707963 - vUv.x * TAU, TAU);
    gl_FragColor = vec4(wallRadiance(theta, vUv.y * uH, 1.0), 1.0);
  }`;

// A texel of the floor: polished concrete, joints, pools of light; the
// polish's cloudiness goes in alpha, for the reflection
const floorBake = /* glsl */ `
  ${ROOM_GLSL}
  uniform vec3 uFloor;
  uniform float uSculptR;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0 * uR;
    float r = length(p);
    float th = atan(p.y, p.x);
    if (th < 0.0) th += TAU;
    // Polished concrete: a slow mottle, a cloudier polish, and aggregate specks
    float mott = f2(p * 0.16);
    float cloud = f2(p * 0.7 + 13.0);
    float speck = n2(p * 21.0);
    vec3 col = uFloor * (0.72 + 0.4 * mott + 0.1 * cloud);
    col *= 1.0 + 0.3 * smoothstep(0.84, 0.97, speck) - 0.2 * smoothstep(0.16, 0.04, speck);
    // Saw-cut joints: rings round the dais, and radial cuts beyond the first
    float ring = 0.0;
    for (int i = 0; i < 4; i++) {
      float rr = 10.0 + float(i) * 6.5;
      float d = abs(r - rr);
      ring = max(ring, 1.0 - smoothstep(0.02, 0.02 + fwidth(r) * 1.5, d));
    }
    float seg = th / TAU * 16.0;
    float dist = abs(fract(seg) - 0.5) * TAU / 16.0 * r;
    float radial = (1.0 - smoothstep(0.02, 0.02 + fwidth(dist) * 1.5, dist)) * step(10.0, r);
    col *= 1.0 - 0.45 * max(ring, radial);
    // Pools of light: the exhibit's round the dais, and each sculpture's
    float pool = 0.1 * exp(-r * r / (2.0 * 9.0 * 9.0));
    for (int j = 0; j < ${SCULPTURES}; j++) {
      float a = ${SCULPTURE_PHASE.toFixed(5)} + float(j) * TAU / ${SCULPTURES}.0;
      vec2 c = vec2(cos(a), sin(a)) * uSculptR;
      vec2 d = p - c;
      pool += 0.12 * exp(-dot(d, d) / (2.0 * 1.6 * 1.6));
    }
    col += uWash * pool * (0.85 + 0.3 * cloud);
    // Darker toward the walls
    col *= mix(1.0, 0.75, smoothstep(22.0, uR, r));
    gl_FragColor = vec4(col, cloud);
  }`;

// A texel of the dais or the plinth top: honed dark stone with a pool of the
// exhibit's light, a soft bevel at the edge, and (the dais) an inlay ring
const topBake = /* glsl */ `
  ${ROOM_GLSL}
  uniform vec3 uBase;
  uniform vec3 uLight;
  uniform float uPool;
  uniform float uPoolR;
  uniform float uHalf;
  uniform float uRound;
  uniform float uInlayR;
  uniform vec3 uInlay;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0 * uHalf;
    float r = length(p);
    float edge = uRound > 0.5 ? uHalf - r : uHalf - max(abs(p.x), abs(p.y));
    vec3 col = uBase * (0.8 + 0.3 * f2(p * 1.1) + 0.08 * (n2(p * 24.0) - 0.5));
    col += uLight * uPool * exp(-r * r / (2.0 * uPoolR * uPoolR));
    // A bevel catching the light along the edge
    col *= 1.0 + 0.7 * smoothstep(0.06, 0.0, edge);
    if (uInlayR > 0.0) {
      float d = abs(r - uInlayR);
      col = mix(col, uInlay, (1.0 - smoothstep(0.025, 0.025 + fwidth(r) * 1.5, d)) * 0.8);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

/**
 * Paints a fragment shader over a whole texture once (sRGB, so the dark
 * room keeps its gradations in 8 bits; mipmapped, so it minifies calmly).
 */
const bake = (
  gl: WebGLRenderer,
  fragmentShader: string,
  uniforms: Record<string, IUniform>,
  [width, height]: [number, number],
  wrap = false,
): WebGLRenderTarget => {
  const target = new WebGLRenderTarget(width, height, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });
  target.texture.colorSpace = SRGBColorSpace;
  target.texture.wrapS = wrap ? RepeatWrapping : ClampToEdgeWrapping;
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: bakeVertex,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  gl.render(scene, BAKE_CAMERA);
  gl.setRenderTarget(previous);
  material.dispose();
  quad.geometry.dispose();
  return target;
};
const BAKE_CAMERA = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uvVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const worldVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

/** The walls: one lookup in their baked strip. */
const wallFragment = /* glsl */ `
  uniform sampler2D uTex;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** A flat top (the dais, the plinth): one lookup by position. */
const topFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uHalf;
  varying vec3 vWorld;
  void main() {
    gl_FragColor = vec4(texture2D(uTex, vWorld.xz / (2.0 * uHalf) + 0.5).rgb, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** The floor: its baked texture, and the walls mirrored softly in its polish. */
const floorFragment = /* glsl */ `
  #define TAU 6.28318530718
  uniform sampler2D uTex;
  uniform sampler2D uWalls;
  uniform float uR;
  uniform float uH;
  uniform float uGloss;
  varying vec3 vWorld;
  void main() {
    vec2 p = vWorld.xz;
    vec4 base = texture2D(uTex, p / (2.0 * uR) + 0.5);
    vec3 dir = normalize(vWorld - cameraPosition);
    vec3 rd = vec3(dir.x, -dir.y, dir.z);
    vec2 v = rd.xz;
    float a2 = max(dot(v, v), 1e-5);
    float b2 = 2.0 * dot(p, v);
    float c2 = dot(p, p) - uR * uR;
    float t = (-b2 + sqrt(max(b2 * b2 - 4.0 * a2 * c2, 0.0))) / (2.0 * a2);
    vec2 hit = p + v * t;
    float h = t * rd.y / uH;
    float u = fract((1.5707963 - atan(hit.y, hit.x)) / TAU);
    // A blurred level of the walls' strip: the polish is not a mirror
    vec3 refl = textureLod(uWalls, vec2(u, clamp(h, 0.0, 1.0)), 4.5).rgb * step(h, 1.0);
    float fres = 0.04 + 0.5 * pow(1.0 - abs(dir.y), 5.0);
    vec3 col = base.rgb + refl * fres * uGloss * (0.55 + 0.6 * base.a);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const roomUniforms = () => ({
  uR: { value: ROOM_RADIUS },
  uWall: { value: new Color(ROOM.wall) },
  uWash: { value: new Color(ROOM.wash).multiplyScalar(0.6) },
  uMoon: { value: new Color(ROOM.moon).multiplyScalar(0.22) },
  uExit: { value: new Color(ROOM.exit) },
  uArt: { value: paintingAtlas() },
});

// --- Props: plinths, sculptures, stanchions ----------------------------------------

interface Light {
  /** A spotlight above: its position and strength. */
  spot: Vector3;
  spotK: number;
  ambient: number;
  /** A glow from the lit exhibit at the centre of the room. */
  glowK?: number;
  /** How far the colour sinks into the room's gloom (0–1, toward the wall's colour). */
  fade?: number;
}

/**
 * Paints a geometry's vertices with its colour under fixed lights (baked,
 * so the room costs nothing to light), placed at `at`, ready to merge.
 */
const baked = (
  geometry: BufferGeometry,
  color: string,
  light: Light,
  at: Vec3 = [0, 0, 0],
): BufferGeometry => {
  const g = (geometry.index ? geometry.toNonIndexed() : geometry).translate(...at);
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const base = new Color(color);
  const colors = new Float32Array(pos.count * 3);
  const p = new Vector3();
  const n = new Vector3();
  const l = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i).normalize();
    l.copy(light.spot).sub(p);
    const d = l.length();
    const spot = Math.max(n.dot(l.normalize()), 0) * light.spotK * Math.min(1, 16 / (d * d));
    l.set(-p.x, 2 - p.y, -p.z).normalize();
    const glow = Math.max(n.dot(l), 0) * (light.glowK ?? 0);
    const k = light.ambient * (0.75 + 0.25 * n.y) + spot + glow;
    const f = light.fade ?? 0;
    colors[i * 3] = base.r * k * (1 - f) + GLOOM.r * f;
    colors[i * 3 + 1] = base.g * k * (1 - f) + GLOOM.g * f;
    colors[i * 3 + 2] = base.b * k * (1 - f) + GLOOM.b * f;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
};

/** The room's gloom, that far things sink into. */
const GLOOM = new Color(ROOM.wall);

const lathe = (points: [number, number][], segments = 20) =>
  new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    segments,
  );

/** One sculpture, base at the origin, by index. */
const sculpture = (i: number): [BufferGeometry, string][] => {
  switch ([0, 1, 2, 3, 4, 7][i % SCULPTURES]) {
    case 0:
      // A bird in flight, drawn up to a point
      return [
        [
          lathe([
            [0, 0],
            [0.08, 0.02],
            [0.05, 0.3],
            [0.1, 1.0],
            [0.15, 1.7],
            [0.11, 2.2],
            [0.03, 2.6],
            [0, 2.62],
          ]),
          '#4a3a22',
        ],
      ];
    case 1:
      // A reclining form, pierced
      return [
        [
          new TorusGeometry(0.5, 0.24, 12, 28)
            .scale(1.5, 1, 0.9)
            .rotateY(0.4)
            .translate(0, 0.62, 0),
          '#3c3b39',
        ],
      ];
    case 2:
      // A sphere resting on a cube
      return [
        [new BoxGeometry(0.62, 0.62, 0.62).translate(0, 0.31, 0), '#34332f'],
        [new SphereGeometry(0.4, 20, 14).translate(0, 1.02, 0), '#403f3b'],
      ];
    case 3:
      // A tall thin standing figure
      return [
        [
          lathe([
            [0, 0],
            [0.22, 0],
            [0.2, 0.1],
            [0.05, 0.14],
            [0.06, 1.0],
            [0.09, 1.5],
            [0.05, 2.0],
            [0.1, 2.12],
            [0.08, 2.32],
            [0, 2.36],
          ]),
          '#3a2f23',
        ],
      ];
    case 4:
      // A knot of dark steel
      return [[new TorusKnotGeometry(0.42, 0.11, 72, 8).translate(0, 0.72, 0), '#33363b']];
    case 5: {
      // A cube balanced on its corner
      const cube = new BoxGeometry(0.8, 0.8, 0.8);
      cube.rotateZ(Math.PI / 4).rotateX(Math.atan(1 / Math.SQRT2));
      return [[cube.translate(0, 0.69, 0), '#b3aea5']];
    }
    case 6:
      // A classical bust
      return [
        [
          new SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
            .scale(1, 0.55, 0.62)
            .translate(0, 0.2, 0),
          '#b1ada5',
        ],
        [new CylinderGeometry(0.4, 0.45, 0.2, 20).translate(0, 0.1, 0), '#a5a198'],
        [new CylinderGeometry(0.11, 0.13, 0.3, 12).translate(0, 0.55, 0), '#b1ada5'],
        [new SphereGeometry(0.24, 18, 14).scale(0.9, 1.15, 1).translate(0, 0.9, 0), '#bbb7ae'],
      ];
    default: {
      // An endless column of stacked beads
      const beads: [BufferGeometry, string][] = [];
      for (let k = 0; k < 5; k++) {
        beads.push([
          new OctahedronGeometry(0.3, 0)
            .scale(1, 1.35, 1)
            .rotateY(Math.PI / 4)
            .translate(0, 0.4 + k * 0.8, 0),
          '#3f3322',
        ]);
      }
      return beads;
    }
  }
};

const PLINTH = { w: 1.05, h: 0.9 };
/** Sculptures are kept small and low, so they stay down in the gloom. */
const SCULPTURE_SCALE = 0.8;

const buildProps = (floorY: number, plinthTop: number, daisR: number, plinthHalf: number) => {
  const parts: BufferGeometry[] = [];
  // Sculptures on plinths, each under its own spotlight
  for (let i = 0; i < SCULPTURES; i++) {
    const a = SCULPTURE_PHASE + (i * Math.PI * 2) / SCULPTURES;
    const x = Math.cos(a) * SCULPTURE_RING;
    const z = Math.sin(a) * SCULPTURE_RING;
    const light: Light = {
      spot: new Vector3(x, floorY + PLINTH.h + 6, z),
      spotK: 0.42,
      ambient: 0.09,
      glowK: 0.05,
      fade: 0.5,
    };
    parts.push(
      baked(
        new BoxGeometry(PLINTH.w, PLINTH.h, PLINTH.w).translate(0, PLINTH.h / 2, 0),
        '#2c2c2d',
        light,
        [x, floorY, z],
      ),
    );
    for (const [g, color] of sculpture(i)) {
      g.scale(SCULPTURE_SCALE, SCULPTURE_SCALE, SCULPTURE_SCALE).rotateY(-a + i);
      parts.push(baked(g, color, light, [x, floorY + PLINTH.h, z]));
    }
  }
  // The exhibit's own light, high above the tower
  const exhibit: Light = { spot: new Vector3(0, 14, 0), spotK: 3.2, ambient: 0.12 };
  // The dais and the plinth (their tops are drawn by the top shader)
  const daisH = 0.3;
  parts.push(
    baked(new CylinderGeometry(daisR, daisR, daisH, 96, 1, true), '#2a2b2e', exhibit, [
      0,
      floorY + daisH / 2,
      0,
    ]),
  );
  const plinthH = plinthTop - (floorY + daisH);
  parts.push(
    baked(new BoxGeometry(plinthHalf * 2, plinthH, plinthHalf * 2), '#1c1d20', exhibit, [
      0,
      floorY + daisH + plinthH / 2,
      0,
    ]),
  );
  // A brass plaque on each face of the plinth
  for (let f = 0; f < 4; f++) {
    const plaque = new BoxGeometry(1.1, 0.32, 0.03)
      .translate(0, 0, plinthHalf + 0.015)
      .rotateY((f * Math.PI) / 2);
    parts.push(baked(plaque, '#4d3b22', exhibit, [0, plinthTop - plinthH * 0.42, 0]));
  }
  // Stanchions and velvet rope round the dais
  const posts = 16;
  const ringR = daisR + 1.5;
  const brass: Light = { spot: new Vector3(0, 14, 0), spotK: 3.6, ambient: 0.2 };
  const tops: Vector3[] = [];
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const at: Vec3 = [Math.cos(a) * ringR, floorY, Math.sin(a) * ringR];
    parts.push(
      baked(new CylinderGeometry(0.15, 0.17, 0.04, 18).translate(0, 0.02, 0), '#4d3b22', brass, at),
    );
    parts.push(
      baked(
        new CylinderGeometry(0.028, 0.028, 0.92, 8).translate(0, 0.48, 0),
        '#4d3b22',
        brass,
        at,
      ),
    );
    parts.push(baked(new SphereGeometry(0.062, 12, 8).translate(0, 0.96, 0), '#5a4526', brass, at));
    tops.push(new Vector3(at[0], floorY + 0.86, at[2]));
  }
  for (let i = 0; i < posts; i++) {
    const a = tops[i];
    const b = tops[(i + 1) % posts];
    const points = Array.from({ length: 9 }, (_, k) => {
      const t = k / 8;
      const p = a.clone().lerp(b, t);
      p.y -= 0.26 * 4 * t * (1 - t);
      return p;
    });
    const rope = new TubeGeometry(new CatmullRomCurve3(points), 14, 0.03, 6, false);
    parts.push(baked(rope, '#3a1016', brass));
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
};

// --- The stage ----------------------------------------------------------------------

export interface GalleryRoom {
  /** World height of the gallery floor. */
  floorY: number;
  /** World height of the plinth's top, under level A. */
  plinthTop: number;
  plinthHalf: number;
  daisR: number;
}

/** The gallery, sized round a tower whose lowest platform is at `levelA`. */
export const makeStage = (levelY: number[], platformHalf: number) => {
  const levelA = levelY[0];
  const room: GalleryRoom = {
    floorY: levelA - 2.55,
    plinthTop: levelA - 0.6,
    plinthHalf: platformHalf + 0.45,
    daisR: 5.8,
  };
  const Room = () => {
    const gl = useThree((s) => s.gl);
    const built = useMemo(() => {
      const walls = new CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, WALL_H, 160, 1, true).translate(
        0,
        room.floorY + WALL_H / 2,
        0,
      );
      const floor = new CircleGeometry(ROOM_RADIUS, 96).rotateX(-Math.PI / 2);
      // Paint the still room once
      const wallTex = bake(
        gl,
        wallBake,
        { ...roomUniforms(), uH: { value: WALL_H } },
        WALL_TEX,
        true,
      );
      const floorTex = bake(
        gl,
        floorBake,
        {
          ...roomUniforms(),
          uFloor: { value: new Color(ROOM.floor) },
          uSculptR: { value: SCULPTURE_RING },
        },
        [FLOOR_TEX, FLOOR_TEX],
      );
      const topTex = (half: number, round: boolean, inlayR: number, pool: number, size: number) =>
        bake(
          gl,
          topBake,
          {
            ...roomUniforms(),
            uBase: { value: new Color(ROOM.dais) },
            uLight: { value: new Color(ROOM.wash) },
            uPool: { value: pool },
            uPoolR: { value: half * 0.8 },
            uHalf: { value: half },
            uRound: { value: round ? 1 : 0 },
            uInlayR: { value: inlayR },
            uInlay: { value: new Color('#5a4526').multiplyScalar(0.35) },
          },
          [size, size],
        );
      const daisTex = topTex(room.daisR, true, room.daisR - 0.35, 0.12, 1024);
      const plinthTex = topTex(room.plinthHalf, false, 0, 0.2, 512);
      const wallMat = new ShaderMaterial({
        side: BackSide,
        uniforms: { uTex: { value: wallTex.texture } },
        vertexShader: uvVertex,
        fragmentShader: wallFragment,
      });
      const floorMat = new ShaderMaterial({
        uniforms: {
          uTex: { value: floorTex.texture },
          uWalls: { value: wallTex.texture },
          uR: { value: ROOM_RADIUS },
          uH: { value: WALL_H },
          uGloss: { value: 1.0 },
        },
        vertexShader: worldVertex,
        fragmentShader: floorFragment,
      });
      const top = (tex: WebGLRenderTarget, half: number) =>
        new ShaderMaterial({
          uniforms: { uTex: { value: tex.texture }, uHalf: { value: half } },
          vertexShader: worldVertex,
          fragmentShader: topFragment,
        });
      const daisTop = new RingGeometry(room.plinthHalf, room.daisR, 96, 1).rotateX(-Math.PI / 2);
      const plinthTopG = new PlaneGeometry(room.plinthHalf * 2, room.plinthHalf * 2).rotateX(
        -Math.PI / 2,
      );
      const props = buildProps(room.floorY, room.plinthTop, room.daisR, room.plinthHalf);
      const propsMat = new MeshBasicMaterial({ vertexColors: true });
      return {
        walls,
        floor,
        wallTex,
        floorTex,
        daisTex,
        plinthTex,
        wallMat,
        floorMat,
        daisTop,
        daisMat: top(daisTex, room.daisR),
        plinthTopG,
        plinthMat: top(plinthTex, room.plinthHalf),
        props,
        propsMat,
      };
    }, [gl]);
    useEffect(
      () => () => {
        Object.values(built).forEach((v) => (v as { dispose?: () => void }).dispose?.());
      },
      [built],
    );
    return (
      <group name="gallery-room">
        <mesh geometry={built.walls} material={built.wallMat} raycast={noRaycast} />
        <mesh
          geometry={built.floor}
          material={built.floorMat}
          position={[0, room.floorY, 0]}
          raycast={noRaycast}
        />
        <mesh
          geometry={built.daisTop}
          material={built.daisMat}
          position={[0, room.floorY + 0.3, 0]}
          raycast={noRaycast}
        />
        <mesh
          geometry={built.plinthTopG}
          material={built.plinthMat}
          position={[0, room.plinthTop + 0.002, 0]}
          raycast={noRaycast}
        />
        <mesh geometry={built.props} material={built.propsMat} raycast={noRaycast} />
      </group>
    );
  };

  // The display's four corner rods of dark bronze, from the plinth up past
  // the top shelf, holding each sheet of glass by its corner clamps
  const rodTop = levelY[levelY.length - 1] + 0.14;
  const rodAt = rodOffset(platformHalf);
  const rods = mergeGeometries(
    [-1, 1].flatMap((sx) =>
      [-1, 1].flatMap((sz) => [
        new CylinderGeometry(0.02, 0.02, rodTop - room.plinthTop, 8).translate(
          sx * rodAt,
          (rodTop + room.plinthTop) / 2,
          sz * rodAt,
        ),
        new SphereGeometry(0.038, 12, 8).translate(sx * rodAt, rodTop + 0.02, sz * rodAt),
        new CylinderGeometry(0.07, 0.08, 0.03, 16).translate(
          sx * rodAt,
          room.plinthTop + 0.015,
          sz * rodAt,
        ),
      ]),
    ),
  );
  const bronze = new MeshStandardMaterial({ color: '#4a3b27', metalness: 0.3, roughness: 0.45 });

  const Stage = () => (
    <>
      <color attach="background" args={[ROOM.background]} />
      <Room />
      <mesh geometry={rods} material={bronze} raycast={noRaycast} />
      {/* No environment map: under a software renderer its per-pixel lookup
          cost a fifth of the frame. The stone is honed, so the lights below
          (and each stone's own rim term) model it; the few metals carry a
          little glow of their own instead of reflections. */}
      <hemisphereLight args={['#a9b9d6', '#1a1b1e', 0.45]} />
      {/* Moonlight from the skylight, straight down */}
      <directionalLight position={[0, 10, 0]} intensity={0.55} color="#aebfdd" />
      <CameraLights />
    </>
  );
  return { Stage, room };
};
