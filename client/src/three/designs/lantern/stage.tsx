import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  Vector4,
} from 'three';
import type { DirectionalLight, Material, Texture } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, fbm, paintedTexture, rng } from '../kit/textures';
import { FIREFLY, GARDEN, LANTERN_LIGHT, SKY } from './palette';

// The world round the tower: a zen garden at blue hour, far below. Raked
// gravel ripples out round a still pond under the tower (the tower is the
// garden's stone) and round moss islands set with rocks; stone lanterns
// glow here and there, each on its own pool of warm light; beyond, the
// garden fades into mist under a ring of temple roofs, pagodas, pines and
// maples against the last light, and a few stars come out overhead. It is
// all round and all still, so it looks the same from every seat and every
// angle, top-down included. The only motion is a few fireflies, kept to
// the edges of the view, never behind the tower.

const GROUND_Y = -13;
const GROUND_R = 78;
const RING_R = 80;
const RING_TOP = 16;
/** Half the side of the pond under the tower: seen from straight above, it frames the tower. */
const POND = 7.4;
/** The stepping-stone path round the pond: its radius and how many stones. */
const PATH_R = '10.8';
const STEPS = 46;

const DEG = Math.PI / 180;

// --- Garden layout ------------------------------------------------------------------

// Laid out once, the same on every load: moss islands scattered evenly
// round the pond at every azimuth (a sunflower spiral), at varied sizes;
// most with a stone lantern at the edge nearest the pond, clipped shrubs
// and a rock or two on the moss, and here and there a maple.
const layoutRandom = rng(5);
const ISLAND_COUNT = 18;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

type Placed = [number, number, number, number];

/** Moss islands: centre x, z and radius. */
const ISLANDS: [number, number, number][] = Array.from({ length: ISLAND_COUNT }, (_, i) => {
  const a = i * GOLDEN_ANGLE + (layoutRandom() - 0.5) * 0.3;
  const r = 13 + 30 * Math.sqrt((i + 0.5) / ISLAND_COUNT) + (layoutRandom() - 0.5) * 3;
  return [Math.cos(a) * r, Math.sin(a) * r, 1.9 + layoutRandom() * 2.1];
});

/** A point on an island at `k` of its radius, `a` round from its centre. */
const onIsland = ([x, z, r]: [number, number, number], k: number, a: number) =>
  [x + Math.cos(a) * r * k, z + Math.sin(a) * r * k] as const;

/** Stone lanterns: x, z, scale, turn. Each stands at an island's edge, toward the pond. */
const LANTERNS: Placed[] = ISLANDS.filter((_, i) => i % 3 !== 2).map(([x, z, r]) => {
  const d = Math.hypot(x, z);
  const side = (layoutRandom() - 0.5) * 1.2;
  const k = (d - r * 1.1) / d;
  return [
    x * k - (z / d) * side * r,
    z * k + (x / d) * side * r,
    1.2 + layoutRandom() * 0.25,
    layoutRandom() * 6,
  ];
});

/** Maples: x, z, scale, turn, on a few of the larger islands. */
const MAPLES: Placed[] = ISLANDS.filter(([x, z], i) => i % 3 === 1 && Math.hypot(x, z) > 24).map(
  (island) => {
    const [x, z] = onIsland(island, 0.15, layoutRandom() * 6);
    return [x, z, 1.05 + layoutRandom() * 0.35, layoutRandom() * 6];
  },
);

/** Rocks: x, z, size, turn. */
const ROCKS: Placed[] = ISLANDS.flatMap((island, i) => {
  const a = layoutRandom() * Math.PI * 2;
  const [bx, bz] = onIsland(island, 0.45, a);
  const [sx, sz] = onIsland(island, 0.62, a + 0.7);
  const rocks: Placed[] = [[bx, bz, 0.6 + layoutRandom() * 0.5, layoutRandom() * 6]];
  if (i % 2 === 0) rocks.push([sx, sz, 0.3 + layoutRandom() * 0.2, layoutRandom() * 6]);
  return rocks;
});

/** Clipped shrubs (karikomi): x, z, size, turn. */
const SHRUBS: Placed[] = ISLANDS.flatMap((island) =>
  Array.from({ length: 2 + Math.floor(layoutRandom() * 2) }, () => {
    const [x, z] = onIsland(island, 0.3 + layoutRandom() * 0.45, layoutRandom() * Math.PI * 2);
    return [x, z, 0.55 + layoutRandom() * 0.55, layoutRandom() * 6] as Placed;
  }),
);

// --- Shared noise -------------------------------------------------------------------

let noiseTexture: Texture | null = null;
/** Four channels of tiling fractal noise, for the garden's grain and the islands' edges. */
const gardenNoise = () => {
  if (noiseTexture) return noiseTexture;
  const n = [fbm(3, 4, 4), fbm(7, 8, 3), fbm(11, 3, 3), fbm(19, 16, 2)];
  noiseTexture = paintedTexture(
    (u, v) => n.map((f) => Math.round(f(u, v) * 255)) as [number, number, number, number],
    { size: 256, color: false, repeat: true },
  );
  noiseTexture.minFilter = LinearMipmapLinearFilter;
  noiseTexture.wrapS = noiseTexture.wrapT = RepeatWrapping;
  return noiseTexture;
};

// --- What lies behind the tower ------------------------------------------------------

/** The tower's bounding box, pieces included. */
const TOWER_BOX = { half: 2.9, low: -3.4, high: 3.3 };
const corner = new Vector3();

/**
 * The tower's outline on screen, as a rectangle in normalised device
 * coordinates (x0, y0, x1, y1), shared by everything in the backdrop that
 * must keep out of the view behind the platforms: fireflies vanish there,
 * and lanterns and their pools of light dim.
 */
const towerRect = { value: new Vector4(0, 0, 0, 0) };

/** GLSL: 0 inside the tower's outline on screen, fading to 1 just outside it. */
const towerMask = /* glsl */ `
  uniform vec4 uTowerRect;
  float towerMask(vec2 ndc) {
    vec4 r = uTowerRect;
    float outside = max(max(r.x - ndc.x, ndc.x - r.z), max(r.y - ndc.y, ndc.y - r.w));
    return smoothstep(0.0, 0.15, outside);
  }
`;

/** Keeps `towerRect` up to date with the camera. Mount it before its users. */
const TowerRect = () => {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (const y of [TOWER_BOX.low, TOWER_BOX.high]) {
          corner.set(sx * TOWER_BOX.half, y, sz * TOWER_BOX.half).project(camera);
          x0 = Math.min(x0, corner.x);
          x1 = Math.max(x1, corner.x);
          y0 = Math.min(y0, corner.y);
          y1 = Math.max(y1, corner.y);
        }
    towerRect.value.set(x0, y0, x1, y1);
  });
  return null;
};

// --- Sky -----------------------------------------------------------------------------

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHigh;
  uniform vec3 uLow;
  uniform vec3 uBand;
  uniform vec3 uGlow;
  uniform vec3 uMist;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float e = asin(clamp(d.y, -1.0, 1.0)) * 57.2957795;
    // Deep blue overhead, lightening toward a thin warm band at the horizon
    vec3 col = mix(uHigh, uZenith, smoothstep(30.0, 85.0, e));
    col = mix(uLow, col, smoothstep(4.0, 34.0, e));
    col = mix(uBand, col, smoothstep(-1.0, 9.0, e));
    // The last light, warmest low in the band, a little stronger to one side
    float side = 0.6 + 0.4 * cos(atan(d.z, d.x) - 0.7);
    col = mix(col, uGlow, exp(-pow((e - 1.5) / 3.2, 2.0)) * 0.55 * side);
    col = mix(col, uMist, smoothstep(-1.0, -7.0, e));
    // A few stars coming out, only high in the sky
    vec3 cell = floor(d * 170.0);
    float s = hash(cell);
    vec3 c = (cell + 0.5 + (vec3(hash(cell + 1.3), hash(cell + 2.1), hash(cell + 3.7)) - 0.5) * 0.6) / 170.0;
    float dist = length(d - normalize(c)) * 170.0;
    float star = step(0.9965, s) * smoothstep(0.55, 0.0, dist) * smoothstep(18.0, 50.0, e);
    col += vec3(0.85, 0.88, 1.0) * star * (0.35 + 0.65 * hash(cell + 5.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Sky = () => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new Color(SKY.zenith) },
          uHigh: { value: new Color(SKY.high) },
          uLow: { value: new Color(SKY.low) },
          uBand: { value: new Color(SKY.band) },
          uGlow: { value: new Color(SKY.glow) },
          uMist: { value: new Color(SKY.mist) },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[150, 32, 16]} />
    </mesh>
  );
};

// --- Horizon: roofs and trees against the last light --------------------------------

/**
 * The ring of silhouettes on the horizon, painted once on a canvas that
 * wraps all the way round: misty hills, then temple roofs and pagodas, then
 * pines and maples nearest, each layer darker, all sinking into the mist at
 * their feet. A few windows keep a lamp lit.
 */
const horizonTexture = (): Texture => {
  const W = 4096;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const random = rng(29);
  /** Canvas row of a world height on the ring (row 0 is the top). */
  const yOf = (h: number) => H * (1 - (h - GROUND_Y) / (RING_TOP - GROUND_Y));
  /** Canvas pixels per world unit, up the ring. */
  const px = H / (RING_TOP - GROUND_Y);
  const wrap = (draw: (dx: number) => void) => [0, -W, W].forEach(draw);
  const ridge = (seed: number, base: number, amp: number, freq: number) => {
    const n = fbm(seed, freq, 4);
    return (x: number) => base + amp * (n(x / W, 0.5) - 0.5) * 2;
  };
  const fillRidge = (h: (x: number) => number) => {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, yOf(h(x)));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  };
  /** A lumpy mass of leaves: many overlapping discs inside an ellipse. */
  const canopy = (cx: number, cy: number, w: number, h: number, lumps: number, size: number) => {
    for (let k = 0; k < lumps; k++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random());
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(a) * r * w,
        cy + Math.sin(a) * r * h,
        size * (0.6 + random() * 0.6),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  };

  // Far hills, barely darker than the sky
  ctx.fillStyle = '#272b49';
  fillRidge(ridge(5, 7.5, 5.5, 4));
  ctx.fillStyle = '#20243f';
  fillRidge(ridge(9, 3.5, 3.5, 7));

  // Temple halls and pagodas, far off, their roofs sweeping up at the eaves
  const roof = (cx: number, y: number, w: number, h: number) => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, y - h * 0.15);
    ctx.quadraticCurveTo(cx - w * 0.32, y + h * 0.25, cx - w * 0.16, y - h * 0.75);
    ctx.lineTo(cx + w * 0.16, y - h * 0.75);
    ctx.quadraticCurveTo(cx + w * 0.32, y + h * 0.25, cx + w / 2, y - h * 0.15);
    ctx.lineTo(cx + w * 0.42, y + h * 0.3);
    ctx.lineTo(cx - w * 0.42, y + h * 0.3);
    ctx.closePath();
    ctx.fill();
  };
  const windows: [number, number][] = [];
  const pagoda = (cx: number, base: number, unit: number, tiers: number) => {
    let y = yOf(base);
    for (let t = 0; t < tiers; t++) {
      const w = unit * (3.4 - t * 0.36);
      ctx.fillRect(cx - w * 0.26, y - unit * 0.62, w * 0.52, unit * 0.66);
      if (t === 0) windows.push([cx, y - unit * 0.3]);
      y -= unit * 0.62;
      roof(cx, y, w, unit * 0.5);
      y -= unit * 0.3;
    }
    ctx.fillRect(cx - unit * 0.05, y - unit * 1.3, unit * 0.1, unit * 1.3);
  };
  const hall = (cx: number, base: number, unit: number) => {
    const y = yOf(base);
    ctx.fillRect(cx - unit * 2.3, y - unit * 0.85, unit * 4.6, unit * 0.9);
    windows.push([cx - unit, y - unit * 0.45], [cx + unit * 0.9, y - unit * 0.45]);
    roof(cx, y - unit * 0.95, unit * 6.6, unit * 1.0);
    roof(cx, y - unit * 1.65, unit * 3.2, unit * 0.62);
  };
  ctx.fillStyle = '#1a1e39';
  const sites: [number, 'pagoda' | 'hall', number, number][] = [
    [0.04, 'pagoda', 1.0, 5],
    [0.17, 'hall', 0.8, 0],
    [0.31, 'pagoda', 0.75, 3],
    [0.45, 'hall', 1.0, 0],
    [0.56, 'pagoda', 1.1, 5],
    [0.69, 'hall', 0.7, 0],
    [0.79, 'pagoda', 0.8, 3],
    [0.9, 'hall', 0.9, 0],
  ];
  for (const [at, kind, scale, tiers] of sites) {
    const unit = px * 0.95 * scale;
    wrap((dx) => {
      if (kind === 'pagoda') pagoda(at * W + dx, -1.5, unit, tiers);
      else hall(at * W + dx, -1.2, unit);
    });
  }
  // Lamps still lit in a few windows
  ctx.fillStyle = 'rgba(214, 160, 100, 0.5)';
  for (const [x, y] of windows) {
    if (random() < 0.6) wrap((dx) => ctx.fillRect(x + dx - 1.5, y - 1.5, 3, 3));
  }
  ctx.fillStyle = '#1a1e39';

  // Trees nearest: round maples, cloud-pruned pines and tall cedars, in a
  // broken line along a low hedge
  const maple = (cx: number, base: number, s: number) => {
    const y = yOf(base);
    ctx.fillRect(cx - 0.12 * s, y - 2.2 * s, 0.24 * s, 2.2 * s);
    canopy(cx, y - 3.2 * s, 2.4 * s, 1.3 * s, 26, 0.75 * s);
  };
  const pine = (cx: number, base: number, s: number) => {
    const y = yOf(base);
    const lean = (random() - 0.5) * 1.2 * s;
    ctx.beginPath();
    ctx.moveTo(cx - 0.14 * s, y);
    ctx.quadraticCurveTo(cx + lean * 0.3, y - 2 * s, cx + lean, y - 4.2 * s);
    ctx.lineTo(cx + lean + 0.1 * s, y - 4.2 * s);
    ctx.quadraticCurveTo(cx + lean * 0.3 + 0.2 * s, y - 2 * s, cx + 0.14 * s, y);
    ctx.fill();
    for (let k = 0; k < 4; k++) {
      const py = y - (1.6 + k * 0.9) * s;
      const off = lean * ((1.6 + k * 0.9) / 4.2) + (random() - 0.5) * 1.2 * s;
      canopy(cx + off, py, (1.7 - k * 0.3) * s, 0.28 * s, 12, 0.36 * s);
    }
  };
  const cedar = (cx: number, base: number, s: number) => {
    const y = yOf(base);
    for (let k = 0; k < 10; k++) {
      const t = k / 9;
      canopy(cx, y - (0.8 + t * 4.2) * s, (1 - t) * 0.9 * s + 0.15 * s, 0.35 * s, 5, 0.4 * s);
    }
  };
  const trees = [maple, maple, pine, cedar];
  ctx.fillStyle = '#12152c';
  for (let x = 0; x < W; ) {
    const s = px * (0.65 + random() * 0.5);
    const tree = trees[Math.floor(random() * trees.length)];
    const base = -4.8 + random() * 1.4;
    const at = x;
    wrap((dx) => tree(at + dx, base, s));
    // Clumps and clearings
    x += random() < 0.25 ? 180 + random() * 260 : 30 + random() * 70;
  }
  fillRidge(ridge(13, -4.2, 0.9, 24));

  // Mist: each silhouette sinks into it toward the ground
  const mist = ctx.createLinearGradient(0, yOf(-1.5), 0, yOf(-7));
  mist.addColorStop(0, 'rgba(22, 27, 49, 0)');
  mist.addColorStop(0.6, 'rgba(22, 27, 49, 0.7)');
  mist.addColorStop(1, 'rgba(22, 27, 49, 1)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = mist;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
};

const Horizon = () => {
  const { geometry, material } = useMemo(() => {
    const geometry = new CylinderGeometry(RING_R, RING_R, RING_TOP - GROUND_Y, 96, 1, true);
    geometry.translate(0, (RING_TOP + GROUND_Y) / 2, 0);
    const material = new MeshBasicMaterial({
      map: horizonTexture(),
      transparent: true,
      depthWrite: false,
      side: BackSide,
      fog: false,
      toneMapped: false,
    });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-998}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- The garden floor -------------------------------------------------------------------

const groundVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vClip;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    vClip = gl_Position.xyw;
  }`;

const groundFragment = /* glsl */ `
  uniform sampler2D uNoise;
  uniform vec3 uGravel;
  uniform vec3 uGravelLit;
  uniform vec3 uMoss;
  uniform vec3 uMossLit;
  uniform vec3 uWater;
  uniform vec3 uStone;
  uniform vec3 uMist;
  uniform vec3 uLight;
  varying vec3 vClip;
  ${towerMask}
  uniform vec3 uIslands[${ISLANDS.length}];
  uniform vec3 uLanterns[${LANTERNS.length}];
  uniform float uPond;
  varying vec3 vWorld;

  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float box2(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  void main() {
    vec2 p = vWorld.xz;
    vec4 big = texture2D(uNoise, p * 0.021);
    vec4 fine = texture2D(uNoise, p * 0.37);
    float pond = roundBox(p, uPond, 2.4);
    // Island edges wobble with one noise sample for the whole garden (cheap
    // in a software renderer: one lookup, not one per island)
    float wob = texture2D(uNoise, p * 0.09).b - 0.5;
    float isl = 1e4;
    for (int i = 0; i < ${ISLANDS.length}; i++) {
      vec3 s = uIslands[i];
      isl = min(isl, length(p - s.xy) - s.z * (1.0 + 0.55 * wob));
    }
    // Rake lines follow the pond's edge and every island's, merging where
    // their ripples meet
    float field = smin(pond - 0.5, isl, 2.2);
    float f = max(field, 0.0) / 0.36;
    float w = fwidth(f);
    float groove = cos(6.2831853 * f) * (1.0 - smoothstep(0.18, 0.5, w));
    vec3 col = mix(uGravel, uGravelLit, 0.25 + 0.35 * big.r) * (0.9 + 0.2 * fine.g);
    col *= 1.0 + 0.16 * groove;
    // Moss, soft at its edge, mottled
    float moss = 1.0 - smoothstep(-0.12, 0.1, isl);
    vec3 mossCol = mix(uMoss, uMossLit, smoothstep(0.3, 0.8, fine.r)) * (0.85 + 0.3 * big.g);
    col = mix(col, mossCol, moss);
    // A kerb of dressed stone round the pond, and the still water inside
    float kerb = smoothstep(0.42, 0.36, pond) * smoothstep(-0.04, 0.02, pond);
    vec3 stone = uStone * (0.75 + 0.5 * fine.a) * (0.9 + 0.2 * step(0.5, fract(atan(p.y, p.x) * 18.0)));
    col = mix(col, stone, kerb);
    // Stepping stones on a path round the pond
    float rad = length(p);
    float seg = atan(p.y, p.x) / 6.2831853 * ${STEPS}.0;
    float id = floor(seg);
    vec4 j = texture2D(uNoise, vec2(id * 0.137, 0.71));
    vec2 q = vec2((fract(seg) - 0.5) * 6.2831853 * ${PATH_R} / ${STEPS}.0, rad - ${PATH_R} - (j.g - 0.5) * 0.25);
    float stoneD = box2(q, vec2(0.5, 0.36) * (0.85 + 0.3 * j.r), 0.22) + (fine.b - 0.5) * 0.08;
    float sa = fwidth(stoneD);
    float stepMask = 1.0 - smoothstep(-sa, sa, stoneD);
    vec3 stepCol = uStone * (0.95 + 0.35 * j.b) * (0.85 + 0.3 * fine.a);
    col = mix(col * (1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.12, stoneD))), stepCol, stepMask);
    vec3 view = normalize(cameraPosition - vWorld);
    float fresnel = pow(1.0 - clamp(view.y, 0.0, 1.0), 4.0);
    vec3 water = mix(uWater, uMist * 1.25, fresnel);
    col = mix(col, water, smoothstep(0.0, -0.05, pond));
    // Pools of warm light round the lanterns
    float light = 0.0;
    for (int i = 0; i < ${LANTERNS.length}; i++) {
      vec3 l = uLanterns[i];
      vec2 d = p - l.xy;
      light += l.z * exp(-dot(d, d) / 14.0);
    }
    // Dimmed where they would show through the platforms
    light *= mix(0.2, 1.0, towerMask(vClip.xy / vClip.z));
    col += uLight * light * (0.05 + col * 1.8);
    // Mist over the distance
    float dist = distance(cameraPosition, vWorld);
    col = mix(col, uMist, 1.0 - exp(-pow(dist * 0.0135, 1.6)));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Ground = () => {
  const { geometry, material } = useMemo(() => {
    const geometry = new CircleGeometry(GROUND_R, 96).rotateX(-Math.PI / 2);
    const material = new ShaderMaterial({
      fog: false,
      uniforms: {
        uNoise: { value: gardenNoise() },
        uGravel: { value: new Color(GARDEN.gravel) },
        uGravelLit: { value: new Color(GARDEN.gravelLit) },
        uMoss: { value: new Color(GARDEN.moss) },
        uMossLit: { value: new Color(GARDEN.mossLit) },
        uWater: { value: new Color(GARDEN.water) },
        uStone: { value: new Color(GARDEN.stone) },
        uMist: { value: new Color(SKY.mist) },
        uLight: { value: new Color(LANTERN_LIGHT) },
        uIslands: { value: ISLANDS.map(([x, z, r]) => new Vector3(x, z, r)) },
        uLanterns: { value: LANTERNS.map(([x, z, s]) => new Vector3(x, z, s * 0.75)) },
        uPond: { value: POND },
        uTowerRect: towerRect,
      },
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
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
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, GROUND_Y, 0]}
      renderOrder={-990}
      raycast={noRaycast}
    />
  );
};

// --- The garden wall ---------------------------------------------------------------------

const WALL_R = 56;
const WALL_H = 2.6;

/** Plaster between timber posts over a stone footing, for the inside of the wall. */
const wallTexture = (): Texture => {
  const W = 2048;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const random = rng(61);
  ctx.fillStyle = '#8a8c98';
  ctx.fillRect(0, 0, W, H);
  // Weathering
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(40, 42, 56, ${random() * 0.12})`;
    ctx.fillRect(random() * W, random() * H * 0.8, 2 + random() * 30, 2 + random() * 16);
  }
  // The five pale rules of a temple wall
  ctx.fillStyle = 'rgba(210, 212, 222, 0.35)';
  for (let k = 0; k < 5; k++) ctx.fillRect(0, 8 + k * 5, W, 1.5);
  // Posts
  ctx.fillStyle = '#3a2c26';
  for (let x = 0; x < W; x += 64) ctx.fillRect(x, 0, 5, H);
  // Stone footing
  ctx.fillStyle = '#4a4a50';
  ctx.fillRect(0, H * 0.82, W, H * 0.18);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.repeat.set(3, 1);
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
};

/**
 * A tiled temple wall closing the garden all the way round, far off:
 * plaster between timber posts under a dark tiled cap, with temple roofs
 * and trees beyond it.
 */
const Wall = () => {
  const { plaster, cap, plasterMat, capMat } = useMemo(() => {
    const plaster = new CylinderGeometry(WALL_R, WALL_R, WALL_H, 160, 1, true).translate(
      0,
      GROUND_Y + WALL_H / 2,
      0,
    );
    const cap = new CylinderGeometry(WALL_R + 0.5, WALL_R - 0.7, 0.55, 160, 1, true).translate(
      0,
      GROUND_Y + WALL_H + 0.2,
      0,
    );
    const plasterMat = new MeshStandardMaterial({
      map: wallTexture(),
      color: '#34374a',
      roughness: 1,
      envMapIntensity: 0.3,
      side: BackSide,
    });
    const capMat = new MeshStandardMaterial({
      color: '#17161c',
      roughness: 0.8,
      envMapIntensity: 0.3,
      side: BackSide,
    });
    return { plaster, cap, plasterMat, capMat };
  }, []);
  useEffect(
    () => () => {
      plaster.dispose();
      cap.dispose();
      plasterMat.map?.dispose();
      plasterMat.dispose();
      capMat.dispose();
    },
    [plaster, cap, plasterMat, capMat],
  );
  return (
    <group name="garden-wall">
      <mesh geometry={plaster} material={plasterMat} raycast={noRaycast} />
      <mesh geometry={cap} material={capMat} raycast={noRaycast} />
    </group>
  );
};

// --- Stone lanterns and rocks -------------------------------------------------------------

/** A kasuga-dōrō: foot, post, a shelf, the fire box, a six-sided roof and its jewel. */
const lanternGeometry = () => {
  const parts = [
    new CylinderGeometry(0.42, 0.48, 0.22, 6).translate(0, 0.11, 0),
    new CylinderGeometry(0.14, 0.17, 0.95, 8).translate(0, 0.7, 0),
    new CylinderGeometry(0.42, 0.36, 0.16, 6).translate(0, 1.25, 0),
    // The fire box's corner posts
    ...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      return new CylinderGeometry(0.035, 0.035, 0.44, 4).translate(
        Math.cos(a) * 0.27,
        1.55,
        Math.sin(a) * 0.27,
      );
    }),
    new CylinderGeometry(0.1, 0.66, 0.36, 6).translate(0, 1.95, 0),
    new CylinderGeometry(0.1, 0.1, 0.1, 6).translate(0, 2.18, 0),
    new SphereGeometry(0.11, 8, 6).translate(0, 2.3, 0),
  ];
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
};

/**
 * A smooth lump: an icosphere pushed in and out, flattened by `squash` and
 * cut flat at `floor` so it sits on the ground.
 */
const lumpGeometry = (seed: number, squash: number, floor: number, detail = 1) => {
  const raw = new IcosahedronGeometry(1, detail);
  raw.deleteAttribute('normal');
  raw.deleteAttribute('uv');
  const g = mergeVertices(raw);
  raw.dispose();
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k =
      1 +
      0.16 * Math.sin(v.x * 3.1 + v.y * 1.7 + seed) +
      0.1 * Math.cos(v.z * 4.3 - v.x * 2.2 + seed * 2);
    v.multiplyScalar(k);
    v.y = Math.max(v.y, floor) * squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
};

/** A maple: a short leaning trunk under a broad crown of leaf masses. */
const mapleGeometry = () => {
  const trunk = new CylinderGeometry(0.1, 0.2, 2.3, 6).translate(0, 1.15, 0);
  trunk.rotateZ(0.08);
  const masses: [number, number, number, number][] = [
    [0, 2.9, 0, 1.25],
    [1.0, 2.55, 0.3, 0.9],
    [-0.9, 2.65, -0.4, 1.0],
    [0.3, 3.5, -0.5, 0.85],
    [-0.4, 2.4, 0.9, 0.85],
    [0.6, 2.3, -0.95, 0.8],
  ];
  const crown = mergeGeometries(
    masses.map(([x, y, z, r], i) => {
      const m = lumpGeometry(i * 1.7, 0.72, -1);
      m.scale(r, r, r).translate(x, y, z);
      return m;
    }),
  );
  return { trunk, crown };
};

const GardenObjects = () => {
  const parts = useMemo(() => {
    const stone = lanternGeometry();
    const stoneMat = new MeshStandardMaterial({
      color: '#3e3b39',
      roughness: 0.95,
      envMapIntensity: 0.3,
    });
    // The paper of the fire box, lit from inside
    const box = new CylinderGeometry(0.25, 0.25, 0.4, 6).translate(0, 1.55, 0);
    // Lamps behind the tower (on screen) burn low, so no bright spot shows
    // through the platforms
    const boxMat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color('#e0a860') }, uTowerRect: towerRect },
      vertexShader: /* glsl */ `
        varying vec3 vClip;
        void main() {
          vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * p;
          vClip = gl_Position.xyw;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec3 vClip;
        ${towerMask}
        void main() {
          gl_FragColor = vec4(uColor * mix(0.22, 1.0, towerMask(vClip.xy / vClip.z)), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const rock = lumpGeometry(0, 0.62, -0.25);
    const rockMat = new MeshStandardMaterial({
      color: '#34312f',
      roughness: 0.9,
      envMapIntensity: 0.3,
    });
    const shrub = lumpGeometry(3, 0.58, -0.1);
    const shrubMat = new MeshStandardMaterial({
      color: '#16261c',
      roughness: 1,
      envMapIntensity: 0.3,
    });
    const maple = mapleGeometry();
    const trunkMat = new MeshStandardMaterial({
      color: '#2b1e19',
      roughness: 0.9,
      envMapIntensity: 0.3,
    });
    // Momiji at dusk: deep crimson going dark
    const leafMat = new MeshStandardMaterial({
      color: '#40171e',
      roughness: 1,
      envMapIntensity: 0.3,
    });
    // A soft halo round each fire box
    const halo = new BufferGeometry();
    halo.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array(LANTERNS.flatMap(([x, z, s]) => [x, GROUND_Y + 1.55 * s, z])),
        3,
      ),
    );
    halo.setAttribute(
      'aSize',
      new BufferAttribute(new Float32Array(LANTERNS.map(([, , s]) => s)), 1),
    );
    const haloMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uMap: { value: dotTexture(0.95) },
        uColor: { value: new Color(LANTERN_LIGHT) },
        uScale: { value: 1 },
        uTowerRect: towerRect,
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        uniform float uScale;
        varying float vShow;
        ${towerMask}
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale * 300.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
          vShow = towerMask(gl_Position.xy / gl_Position.w);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vShow;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vShow;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * a * 0.2, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    return {
      geometries: [stone, box, rock, shrub, maple.trunk, maple.crown, halo],
      materials: [stoneMat, boxMat, rockMat, shrubMat, trunkMat, leafMat, haloMat],
      // What to instance, where
      sets: [
        [stone, stoneMat, LANTERNS],
        [box, boxMat, LANTERNS],
        [rock, rockMat, ROCKS],
        [shrub, shrubMat, SHRUBS],
        [maple.trunk, trunkMat, MAPLES],
        [maple.crown, leafMat, MAPLES],
      ] as [BufferGeometry, Material, Placed[]][],
      halo,
      haloMat,
    };
  }, []);
  useEffect(
    () => () => {
      parts.geometries.forEach((g) => g.dispose());
      parts.materials.forEach((m) => m.dispose());
    },
    [parts],
  );
  const size = useThree((s) => s.size.height);
  parts.haloMat.uniforms.uScale.value = size / 800;

  const place = (mesh: InstancedMesh | null, items: Placed[]) => {
    if (!mesh) return;
    const o = new Object3D();
    items.forEach(([x, z, s, turn], i) => {
      o.position.set(x, GROUND_Y, z);
      o.rotation.set(0, turn, 0);
      o.scale.set(s, s, s);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
  return (
    <group name="garden">
      {parts.sets.map(([geometry, material, items], i) => (
        <instancedMesh
          key={i}
          ref={(m) => place(m, items)}
          args={[geometry, material, items.length]}
          raycast={noRaycast}
        />
      ))}
      <points
        geometry={parts.halo}
        material={parts.haloMat}
        raycast={noRaycast}
        renderOrder={-980}
      />
    </group>
  );
};

// --- Fireflies ------------------------------------------------------------------------------

const FIREFLIES = 36;
/**
 * A few fireflies drifting low over the garden, blinking slowly. Each one
 * fades out wherever it would appear on screen within the tower's outline,
 * so nothing ever moves behind the platforms.
 */
const Fireflies = () => {
  const height = useThree((s) => s.size.height);
  const { geometry, material } = useMemo(() => {
    const random = rng(41);
    const home = new Float32Array(FIREFLIES * 3);
    const phase = new Float32Array(FIREFLIES);
    for (let i = 0; i < FIREFLIES; i++) {
      const a = random() * Math.PI * 2;
      const r = 9 + random() * 26;
      home.set([Math.cos(a) * r, GROUND_Y + 0.4 + random() * 2.4, Math.sin(a) * r], i * 3);
      phase[i] = random() * 100;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(home, 3));
    geometry.setAttribute('aPhase', new BufferAttribute(phase, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uTowerRect: towerRect,
        uColor: { value: new Color(FIREFLY) },
        uMap: { value: dotTexture(0.8) },
        uScale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        uniform float uScale;
        ${towerMask}
        varying float vAlpha;
        void main() {
          float t = uTime * 0.12 + aPhase;
          vec3 p = position + vec3(sin(t * 1.3) * 0.9, sin(t * 0.9 + 1.7) * 0.35, cos(t * 1.1) * 0.9);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec4 clip = projectionMatrix * mv;
          vec2 ndc = clip.xy / clip.w;
          // Out of the tower's outline on screen, and a slow blink
          float blink = smoothstep(0.55, 0.95, sin(uTime * 0.5 + aPhase * 3.7));
          vAlpha = towerMask(ndc) * blink;
          gl_PointSize = uScale * 95.0 / -mv.z;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
          #include <colorspace_fragment>
        }`,
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
  material.uniforms.uScale.value = height / 800;

  useFrame((_, delta) => {
    material.uniforms.uTime.value += Math.min(delta, 1 / 20);
  });

  return (
    <points
      geometry={geometry}
      material={material}
      raycast={noRaycast}
      frustumCulled={false}
      renderOrder={-970}
    />
  );
};

// --- Light ----------------------------------------------------------------------------------

/**
 * Lights that travel with the camera, so every piece is modelled the same
 * from any seat and any orbit: a warm lantern key over the viewer's left
 * shoulder and a cool moonlight rim from behind the tower, which edges the
 * rosewood army against the dark garden.
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
    place(key.current, az - 40 * DEG, 42 * DEG);
    place(rim.current, az + 180 * DEG + 40 * DEG, 32 * DEG);
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.3} color="#ffe2b8" />
      <directionalLight ref={rim} intensity={2.1} color="#a9bcff" />
    </>
  );
};

export const Stage = () => (
  <>
    <TowerRect />
    <Sky />
    <Horizon />
    <Ground />
    <GardenObjects />
    <Wall />
    {/* Distance haze for the garden's objects (the tower's materials opt out) */}
    <fogExp2 attach="fog" args={[SKY.mist, 0.0135]} />
    <Fireflies />
    {/* Reflections for the varnish: a dim dusk room, a broad warm paper
        panel (a lantern-lit shoji) to one side and the blue sky above, so
        the satin finish shows long soft highlights and never a hard glint */}
    <Environment resolution={64} frames={1}>
      <color attach="background" args={['#141828']} />
      <Lightformer
        form="rect"
        intensity={0.9}
        color="#9fb2ff"
        position={[0, 8, 0]}
        rotation-x={Math.PI / 2}
        scale={[10, 10, 1]}
      />
      <Lightformer
        form="rect"
        intensity={1.6}
        color="#ffd29a"
        position={[-6, 2.5, 5]}
        scale={[5, 3, 1]}
      />
      <Lightformer
        form="rect"
        intensity={0.7}
        color="#ffd29a"
        position={[6, 2, -5]}
        scale={[4, 2, 1]}
      />
    </Environment>
    <hemisphereLight args={['#5a66a8', '#2a1c16', 0.75]} />
    <CameraLights />
  </>
);
