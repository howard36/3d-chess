import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import { figuresReady, NOTATION_FONT } from './fonts';
import { TOWER_MASK } from './mask';
import { rig } from './pieces';
import { PALETTE, TERRACE_RADIUS, TERRACE_Y } from './palette';

// The observatory terrace at night. The tower stands on a round dark terrace
// high above a sea of cloud; the cloud tops lie well below eye level, so the
// sky reaches down behind the tower's sides. Its constellations are chess
// pieces (a knight's head, a rook, a king's cross, a bishop's mitre, a queen's
// crown, a pawn and a unicorn's horn), faint star points joined by hair-thin
// lines, set all round the sky so every side has one. Far round the horizon
// runs a slim brass meridian ring engraved with the board's notation, a–e,
// 1–5, A–E, between two hairlines of light.
//
// Everything is still and low in contrast. Whatever lies behind the tower
// from wherever the camera is (stars, lines, engraving, the terrace's brass)
// is held down to nothing by the tower mask (mask.ts), and from straight
// above there is only the terrace's dark stone and the dark cloud below it.

/** Radius of the sky dome. */
const SKY_RADIUS = 46;
/** Height (direction y on the dome) of the cloud tops: below eye level. */
const CLOUD_Y = -0.3;

// --- The sky and the cloud sea ---------------------------------------------------

const skyMaterial = () =>
  new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new Color(PALETTE.skyTop) },
      uHorizon: { value: new Color(PALETTE.skyHorizon) },
      uCloud: { value: new Color(PALETTE.cloud) },
      uCloudLit: { value: new Color(PALETTE.cloudLit) },
      uBottom: { value: new Color(PALETTE.skyBottom) },
      uCloudY: { value: CLOUD_Y },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uCloud;
      uniform vec3 uCloudLit;
      uniform vec3 uBottom;
      uniform float uCloudY;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 col;
        if (y > uCloudY) {
          // Night: deepest at the zenith, a faint haze over the cloud tops
          float t = (y - uCloudY) / (1.0 - uCloudY);
          col = mix(uHorizon, uTop, pow(t, 0.5));
        } else {
          // The cloud sea: its moonlit tops fading to plain dark below
          float t = (uCloudY - y) / (1.0 + uCloudY);
          col = mix(uCloudLit, uCloud, smoothstep(0.0, 0.18, t));
          col = mix(col, uBottom, smoothstep(0.3, 0.9, t));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

const Sky = () => {
  const material = useMemo(skyMaterial, []);
  const geometry = useMemo(() => new SphereGeometry(SKY_RADIUS + 4, 48, 32), []);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-1000}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Stars and constellations ----------------------------------------------------

type P2 = [number, number];

interface Constellation {
  /** Points in a unit box (x right, y up). */
  stars: P2[];
  /** Pairs of star indices joined by a line. */
  lines: [number, number][];
  /** Stars left unjoined (an eye, an orb): drawn, no line. */
  loose?: P2[];
}

const loop = (n: number, from = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => [from + i, from + ((i + 1) % n)]);
const chain = (n: number, from = 0): [number, number][] =>
  Array.from({ length: n - 1 }, (_, i) => [from + i, from + i + 1]);

// The pieces as constellations, each an outline of a few stars
const KNIGHT: Constellation = {
  stars: [
    [0.52, 1.0],
    [0.66, 0.84],
    [0.8, 0.6],
    [0.86, 0.28],
    [0.82, 0.0],
    [0.24, 0.0],
    [0.3, 0.3],
    [0.36, 0.42],
    [0.04, 0.48],
    [0.1, 0.66],
    [0.38, 0.86],
  ],
  lines: loop(11),
  loose: [[0.34, 0.7]],
};
const ROOK: Constellation = {
  stars: [
    [0.18, 0.0],
    [0.82, 0.0],
    [0.72, 0.16],
    [0.7, 0.7],
    [0.82, 0.78],
    [0.82, 1.0],
    [0.62, 1.0],
    [0.62, 0.9],
    [0.38, 0.9],
    [0.38, 1.0],
    [0.18, 1.0],
    [0.18, 0.78],
    [0.3, 0.7],
    [0.28, 0.16],
  ],
  lines: loop(14),
};
const KING: Constellation = {
  stars: [
    // The cross
    [0.5, 1.0],
    [0.5, 0.78],
    [0.39, 0.9],
    [0.61, 0.9],
    // The crown and body
    [0.3, 0.7],
    [0.7, 0.7],
    [0.63, 0.32],
    [0.76, 0.06],
    [0.24, 0.06],
    [0.37, 0.32],
  ],
  lines: [[0, 1], [2, 3], [1, 4], [1, 5], ...loop(6, 4).slice(1), [9, 4]],
};
const BISHOP: Constellation = {
  stars: [
    [0.5, 0.9],
    [0.34, 0.72],
    [0.37, 0.5],
    [0.5, 0.42],
    [0.63, 0.5],
    [0.66, 0.72],
    // The mitre's cut
    [0.43, 0.78],
    [0.6, 0.6],
    // Collar and foot
    [0.36, 0.32],
    [0.64, 0.32],
    [0.26, 0.02],
    [0.74, 0.02],
  ],
  lines: [...loop(6), [6, 7], [8, 9], [8, 10], [9, 11], [10, 11]],
  loose: [[0.5, 1.02]],
};
const QUEEN: Constellation = {
  stars: [
    [0.18, 0.58],
    [0.3, 0.88],
    [0.4, 0.64],
    [0.5, 0.96],
    [0.6, 0.64],
    [0.7, 0.88],
    [0.82, 0.58],
    [0.74, 0.34],
    [0.26, 0.34],
  ],
  lines: loop(9),
  loose: [
    [0.3, 0.98],
    [0.5, 1.07],
    [0.7, 0.98],
  ],
};
const PAWN: Constellation = {
  stars: [
    [0.5, 1.0],
    [0.65, 0.84],
    [0.5, 0.68],
    [0.35, 0.84],
    [0.4, 0.62],
    [0.6, 0.62],
    [0.72, 0.08],
    [0.28, 0.08],
  ],
  lines: [...loop(4), [4, 7], [5, 6], [6, 7], [4, 5]],
};
const UNICORN: Constellation = {
  stars: [
    // The horn, spiralling up
    [0.62, 1.0],
    [0.55, 0.84],
    [0.62, 0.8],
    [0.52, 0.68],
    // The head below it
    [0.4, 0.66],
    [0.12, 0.44],
    [0.2, 0.3],
    [0.46, 0.4],
    [0.56, 0.14],
    [0.86, 0.14],
    [0.8, 0.5],
    [0.62, 0.62],
  ],
  lines: [...chain(5), ...loop(8, 4)],
};

/** The knight turned the other way, for the far side of the sky. */
const KNIGHT_WEST: Constellation = {
  ...KNIGHT,
  stars: KNIGHT.stars.map(([u, v]) => [1 - u, v]),
  loose: KNIGHT.loose?.map(([u, v]) => [1 - u, v]),
};

// Round the whole sky, about one every 45°, each at its own height between
// the cloud tops and eye level (dome y), sized (dome units) to sit beside the
// tower rather than over it. The camera stands well off the dome's centre, so
// the opening view sees a narrow arc of it: the knight is set to stand just
// left of the tower there, and the king just right of it.
const SKY_PLAN: { c: Constellation; azimuth: number; y: number; size: number; tilt: number }[] = [
  { c: KNIGHT, azimuth: 222, y: -0.1, size: 10, tilt: -0.06 },
  { c: KING, azimuth: 170, y: -0.09, size: 9.5, tilt: 0.06 },
  { c: BISHOP, azimuth: 125, y: -0.13, size: 8.5, tilt: -0.05 },
  { c: PAWN, azimuth: 80, y: -0.16, size: 7, tilt: -0.08 },
  { c: UNICORN, azimuth: 35, y: -0.08, size: 9.5, tilt: 0.07 },
  { c: KNIGHT_WEST, azimuth: 350, y: -0.11, size: 10, tilt: 0.05 },
  { c: QUEEN, azimuth: 305, y: -0.1, size: 9, tilt: 0.04 },
  { c: ROOK, azimuth: 262, y: -0.15, size: 7.5, tilt: 0.06 },
];

const DEG = Math.PI / 180;

/** A point on the dome from a constellation's unit box. */
const place = (
  [u, v]: P2,
  plan: { azimuth: number; y: number; size: number; tilt: number },
): [number, number, number] => {
  // Centre of the figure on the dome, and its local right and up
  const az = plan.azimuth * DEG;
  const centre = new Vector3(Math.sin(az), 0, Math.cos(az)).multiplyScalar(
    Math.sqrt(1 - plan.y * plan.y),
  );
  centre.y = plan.y;
  centre.multiplyScalar(SKY_RADIUS);
  const inward = centre.clone().normalize().negate();
  const right = new Vector3(0, 1, 0).cross(inward).normalize();
  const up = inward.clone().cross(right).normalize();
  const x = (u - 0.5) * plan.size;
  const y = (v - 0.5) * plan.size;
  const c = Math.cos(plan.tilt);
  const s = Math.sin(plan.tilt);
  const p = centre
    .clone()
    .addScaledVector(right, x * c - y * s)
    .addScaledVector(up, x * s + y * c);
  // Back onto the dome
  return p.normalize().multiplyScalar(SKY_RADIUS).toArray() as [number, number, number];
};

const pointVertex = /* glsl */ `
  uniform float uDpr;
  attribute float aSize;
  attribute float aBright;
  attribute vec3 aColor;
  varying float vBright;
  varying vec3 vColor;
  varying vec3 vWorld;
  void main() {
    vBright = aBright;
    vColor = aColor;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_PointSize = aSize * uDpr;
  }`;

const pointFragment = /* glsl */ `
  varying float vBright;
  varying vec3 vColor;
  varying vec3 vWorld;
  ${TOWER_MASK}
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float a = (1.0 - smoothstep(0.35, 1.0, r)) * vBright * towerMask(vWorld, 0.0);
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }`;

const lineVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const lineFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vWorld;
  ${TOWER_MASK}
  void main() {
    float a = uOpacity * towerMask(vWorld, 0.0);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const STAR_COUNT = 520;

const starGeometry = () => {
  const random = rng(29);
  const pos: number[] = [];
  const size: number[] = [];
  const bright: number[] = [];
  const color: number[] = [];
  const cool = new Color(PALETTE.star);
  const warm = new Color(PALETTE.starWarm);
  const add = (p: number[], s: number, b: number, c: Color) => {
    pos.push(...p);
    size.push(s);
    bright.push(b);
    color.push(c.r, c.g, c.b);
  };
  // The background field: sparse, dim, thinning toward the cloud tops
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = CLOUD_Y + 0.04 + random() ** 0.8 * (1 - CLOUD_Y - 0.04);
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    const low = Math.min((y - CLOUD_Y) / 0.25, 1);
    add(
      [Math.sin(a) * r * SKY_RADIUS, y * SKY_RADIUS, Math.cos(a) * r * SKY_RADIUS],
      1.4 + random() ** 3 * 1.6,
      (0.12 + random() ** 2.5 * 0.4) * (0.35 + 0.65 * low),
      random() < 0.25 ? warm : cool,
    );
  }
  // The constellations' stars: a little brighter than the field
  for (const plan of SKY_PLAN) {
    for (const s of [...plan.c.stars, ...(plan.c.loose ?? [])]) {
      add(place(s, plan), 2.6 + random() * 0.9, 0.5 + random() * 0.2, cool);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 1));
  g.setAttribute('aBright', new BufferAttribute(new Float32Array(bright), 1));
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(color), 3));
  return g;
};

const figureGeometry = () => {
  const pos: number[] = [];
  for (const plan of SKY_PLAN) {
    for (const [a, b] of plan.c.lines) {
      pos.push(...place(plan.c.stars[a], plan), ...place(plan.c.stars[b], plan));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
};

const Heavens = ({ dpr }: { dpr: number }) => {
  const { stars, figures, starMaterial, lineMaterial } = useMemo(
    () => ({
      stars: starGeometry(),
      figures: figureGeometry(),
      // Light added onto the night, in the opaque pass before everything else
      // (so a check's light, drawn next, is never painted over)
      starMaterial: new ShaderMaterial({
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uDpr: { value: 1 } },
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
      }),
      lineMaterial: new ShaderMaterial({
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.star) },
          uOpacity: { value: 0.18 },
        },
        vertexShader: lineVertex,
        fragmentShader: lineFragment,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      stars.dispose();
      figures.dispose();
      starMaterial.dispose();
      lineMaterial.dispose();
    },
    [stars, figures, starMaterial, lineMaterial],
  );
  // Point sizes are in CSS pixels; the shader draws in device pixels
  starMaterial.uniforms.uDpr.value = dpr;
  return (
    <group name="meridian-heavens">
      <lineSegments
        geometry={figures}
        material={lineMaterial}
        renderOrder={-900}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <points
        geometry={stars}
        material={starMaterial}
        renderOrder={-899}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};

// --- The meridian ring -----------------------------------------------------------

const RING_RADIUS = 34;
// Below the level letters beside the tower in the opening view (and its
// mask keeps it well clear of the tower, labels included)
const RING_Y = -9;
const RING_HEIGHT = 1.1;
/** Glyph slots round the ring: the notation repeats this many times. */
const RING_REPEATS = 9;

const NOTATION = [
  'a',
  'b',
  'c',
  'd',
  'e',
  '·',
  '1',
  '2',
  '3',
  '4',
  '5',
  '·',
  'A',
  'B',
  'C',
  'D',
  'E',
  '·',
];

/** One repeat of the ring's engraving, drawn once the font is ready. */
const engraving = (): CanvasTexture => {
  const w = 1152;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const t = new CanvasTexture(c);
  const paint = () => {
    ctx.clearRect(0, 0, w, h);
    // The band: dim brass, catching the light along its upper edge, a
    // hairline of light along each edge
    const band = ctx.createLinearGradient(0, 6, 0, h - 6);
    band.addColorStop(0, 'rgba(160, 134, 84, 0.2)');
    band.addColorStop(1, 'rgba(120, 100, 62, 0.06)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 6, w, h - 12);
    ctx.fillStyle = 'rgba(240, 222, 170, 0.95)';
    ctx.fillRect(0, 4, w, 2);
    ctx.fillStyle = 'rgba(233, 212, 154, 0.4)';
    ctx.fillRect(0, h - 6, w, 2);
    // Graduation: a tick every slot quarter, longer at each slot
    const slot = w / NOTATION.length;
    for (let i = 0; i < NOTATION.length * 4; i++) {
      const x = (i * slot) / 4;
      const major = i % 4 === 0;
      ctx.fillStyle = major ? 'rgba(233, 212, 154, 0.55)' : 'rgba(233, 212, 154, 0.3)';
      ctx.fillRect(x - 0.75, 6, 1.5, major ? 12 : 7);
    }
    // The notation, engraved
    ctx.font = `600 30px ${NOTATION_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(233, 212, 154, 0.8)';
    NOTATION.forEach((g, i) => ctx.fillText(g, (i + 0.5) * slot, h / 2 + 6));
    t.needsUpdate = true;
  };
  paint();
  // Again once the notation's letters and figures have loaded
  Promise.all([document.fonts?.load('600 30px "Cormorant Garamond"'), figuresReady()]).then(
    paint,
    () => undefined,
  );
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.repeat.set(RING_REPEATS, 1);
  return t;
};

const ringVertex = /* glsl */ `
  uniform vec2 uRepeat;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv * uRepeat;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const ringFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vWorld;
  ${TOWER_MASK}
  // The ring gives the tower a wider berth than the rest of the night, so its
  // engraving fades out well before it reaches the board's own labels
  float ringCover(vec3 world) {
    vec3 d = world - cameraPosition;
    float len = length(d);
    vec3 rd = d / max(len, 1e-5);
    vec3 s = step(0.0, rd) * 2.0 - 1.0;
    vec3 inv = 1.0 / (s * max(abs(rd), vec3(1e-5)));
    return max(towerCover(world), towerHit(cameraPosition, inv, len, 1.7));
  }
  void main() {
    // Seen from outside the ring's face, the glyphs read the right way round
    vec4 t = texture2D(uMap, vec2(-vUv.x, vUv.y));
    float a = t.a * uOpacity * (1.0 - ringCover(vWorld));
    if (a < 0.003) discard;
    gl_FragColor = vec4(t.rgb, a);
    #include <colorspace_fragment>
  }`;

const MeridianRing = () => {
  const { geometry, material, map } = useMemo(() => {
    const map = engraving();
    return {
      map,
      geometry: new CylinderGeometry(RING_RADIUS, RING_RADIUS, RING_HEIGHT, 360, 1, true),
      material: new ShaderMaterial({
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uMap: { value: map },
          uOpacity: { value: 0.5 },
          uRepeat: { value: map.repeat },
        },
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
      }),
    };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
    [geometry, material, map],
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, RING_Y, 0]}
      renderOrder={-800}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- The terrace -----------------------------------------------------------------

// A round terrace of dark stone under the tower, a hairline of brass at its
// rim, well outside the tower's footprint. The mask holds its brass down to
// nothing behind the tower, and the stone to a shade.
const terraceFragment = /* glsl */ `
  uniform vec3 uStone;
  uniform vec3 uBrass;
  uniform float uRadius;
  varying vec2 vP;
  varying vec3 vWorld;
  ${TOWER_MASK}
  float line(float d, float w) {
    float fw = max(fwidth(d), 1e-4);
    float h = max(w * 0.5, fw * 0.6);
    return (1.0 - smoothstep(h - fw, h + fw, abs(d))) * min(w * 0.5 / h, 1.0);
  }
  void main() {
    float r = length(vP);
    // The stone, a shade lighter toward its rim, where the sky catches it
    vec3 stone = uStone * (0.85 + 0.3 * smoothstep(3.0, uRadius, r));
    float brass = line(r - uRadius * 0.975, 0.025) * 0.3;
    float cover = towerCover(vWorld);
    brass *= 1.0 - cover;
    stone *= 1.0 - 0.25 * cover;
    vec3 col = mix(stone, uBrass, brass);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Terrace = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: new CircleGeometry(TERRACE_RADIUS, 96).rotateX(-Math.PI / 2),
      material: new ShaderMaterial({
        uniforms: {
          uStone: { value: new Color(PALETTE.terrace) },
          uBrass: { value: new Color(PALETTE.brass) },
          uRadius: { value: TERRACE_RADIUS },
        },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          varying vec3 vWorld;
          void main() {
            vP = position.xz;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: terraceFragment,
      }),
    }),
    [],
  );
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
      position={[0, TERRACE_Y, 0]}
      renderOrder={-700}
      raycast={noRaycast}
    />
  );
};

// --- The light rig --------------------------------------------------------------

const UP = new Vector3(0, 1, 0);
const forward = new Vector3();
const right = new Vector3();
const origin = new Vector3();
const key = new Vector3();

/**
 * A soft key above the camera's left shoulder and a cool fill low on its
 * right, riding with the camera, so the pieces are modelled the same way
 * from every side and both seats. The pieces' stone shader reads them.
 */
const CameraRig = () => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;
  const last = useRef(new Vector3(NaN, NaN, NaN));
  useFrame(() => {
    if (last.current.equals(camera.position)) return;
    last.current.copy(camera.position);
    const target = controls?.target ?? origin;
    forward.copy(target).sub(camera.position).normalize();
    right.crossVectors(forward, UP).normalize();
    key.copy(forward).multiplyScalar(-8).addScaledVector(right, -5).addScaledVector(UP, 9);
    rig.key.value.copy(key).normalize();
    key.copy(forward).multiplyScalar(-6).addScaledVector(right, 7).addScaledVector(UP, 1);
    rig.fill.value.copy(key).normalize();
  });
  return null;
};

export const Stage = () => {
  const dpr = useThree((s) => s.viewport.dpr);
  return (
    <>
      <Sky />
      <Heavens dpr={dpr} />
      <MeridianRing />
      <Terrace />
      <CameraRig />
    </>
  );
};
