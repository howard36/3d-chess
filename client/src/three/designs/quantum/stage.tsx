import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  LatheGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
} from 'three';
import type { DirectionalLight } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import { PALETTE } from './palette';

// The cryostat round the board: the gold "chandelier" of a dilution
// refrigerator, stacked plates narrowing toward the cold end far below,
// joined by posts and hung with coaxial lines, all sunk in cold blue mist.
// It is rotationally symmetric about the tower's axis, so it reads the same
// from every azimuth; from above it is a well of gold rings dropping away to
// a faint blue glow. Everything here is static and drawn before the board
// (depth-tested, but beyond it), in custom shaders that fade each part into
// the sky's own colour with distance and depth, so it stays dim, soft and
// low in contrast however close the camera comes.

// --- Shared GLSL ------------------------------------------------------------------

const SKY_GLSL = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uGlow;
  uniform vec3 uMist;
  // The cryostat's colour in direction d: blue-black overhead, a misty band
  // below the horizon, a faint cold glow straight down
  vec3 skyBase(vec3 d) {
    float h = d.y;
    vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.8));
    c += uMist * exp(-pow((h + 0.3) / 0.32, 2.0)) * 0.4;
    // The glow rises round the cold plate far below, a halo about the
    // tower's axis, dark at its very centre (behind the board seen from above)
    float off = acos(clamp(-h, -1.0, 1.0));
    c += uGlow * (exp(-pow((off - 0.4) / 0.16, 2.0)) * 0.34 + exp(-pow(off / 0.12, 2.0)) * 0.08);
    return c;
  }
`;

const NOISE_GLSL = /* glsl */ `
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
          mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
          mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.07 + 1.3;
      a *= 0.5;
    }
    return s;
  }
`;

const skyUniforms = () => ({
  uTop: { value: new Color(PALETTE.voidTop) },
  uHorizon: { value: new Color(PALETTE.voidHorizon) },
  uBottom: { value: new Color(PALETTE.voidBottom) },
  uGlow: { value: new Color(PALETTE.glow) },
  uMist: { value: new Color(PALETTE.mist) },
});

// --- The sky ----------------------------------------------------------------------

/**
 * The inside of the cryostat: the gradient, soft static wisps of mist in the
 * band below the horizon, and the cold glow far below. Dithered, so the dark
 * gradient never bands.
 */
const CryoSky = () => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: skyUniforms(),
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          ${SKY_GLSL}
          ${NOISE_GLSL}
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            vec3 c = skyBase(d);
            // Wisps: stretched sideways, thickest in the misty band
            float band = exp(-pow((d.y + 0.35) / 0.42, 2.0));
            float m = fbm(vec3(d.x * 2.2, d.y * 5.0, d.z * 2.2));
            c += uMist * band * smoothstep(0.35, 0.8, m) * 0.7;
            // A second, finer layer far below: frost haze round the glow
            float low = smoothstep(0.1, 0.9, -d.y);
            c += uGlow * low * smoothstep(0.45, 0.85, fbm(d * 6.0 + 3.1)) * 0.12;
            // Dither: a dark gradient bands in eight bits
            float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
            c += (n - 0.5) / 255.0;
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  const geometry = useMemo(() => new SphereGeometry(150, 48, 32), []);
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
      raycast={noRaycast}
      renderOrder={-1000}
      frustumCulled={false}
    />
  );
};

// --- The chandelier ---------------------------------------------------------------

/** A gold plate of the chandelier: a ring (or, at the bottom, a disc) at height y. */
interface Plate {
  y: number;
  inner: number;
  outer: number;
  thick: number;
  /** Feedthrough holes round the middle of the plate. */
  holes: number;
}

// Top to bottom, narrowing toward the cold end. The opening view sits
// between the second and third, so the plates bracket it above and below
// rather than crossing its middle. The zoom (orbit.maxDistance) keeps the
// camera inside every inner rim.
const PLATES: Plate[] = [
  { y: 15, inner: 32, outer: 46, thick: 0.9, holes: 30 },
  { y: 3.5, inner: 29, outer: 41, thick: 0.8, holes: 28 },
  { y: -16, inner: 22, outer: 33, thick: 0.7, holes: 24 },
  { y: -24.5, inner: 15.5, outer: 25, thick: 0.6, holes: 18 },
  { y: -32, inner: 9, outer: 17, thick: 0.5, holes: 12 },
  { y: -39, inner: 3.5, outer: 11, thick: 0.5, holes: 8 },
];

/**
 * The mist is complete across the tower's whole angular size from wherever
 * the camera is (the orbit's target is the tower's centre, the origin), so
 * no part of the chandelier ever shows through the see-through wafers.
 * TOWER_R is the tower's half-diagonal with its labels.
 */
const TOWER_MASK_GLSL = /* glsl */ `
  float towerMask(vec3 world) {
    vec3 toWorld = normalize(world - cameraPosition);
    float axis = acos(clamp(dot(toWorld, normalize(-cameraPosition)), -1.0, 1.0));
    float towerAng = atan(4.4 / length(cameraPosition));
    return 1.0 - smoothstep(towerAng, towerAng + 0.22, axis);
  }
`;

const CHANDELIER_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/**
 * The chandelier as gold line-work on cool dark metal. Plate faces are near
 * the mist's own colour, with a lathe-turned sheen catching a light from
 * behind the tower; the gold is in their polished lips, bolt circles, rims
 * and posts, and the coaxial lines. Feedthrough holes are dark recesses in
 * steel collars (never gold, so none can pass for a move glyph). Everything
 * fades into the sky's colour with distance and depth, and completely
 * across the tower (towerMask).
 */
const CHANDELIER_FRAGMENT = /* glsl */ `
  ${SKY_GLSL}
  ${TOWER_MASK_GLSL}
  uniform vec3 uGold;
  uniform vec3 uPlate;
  uniform vec3 uSteel;
  uniform float uKind;
  uniform float uInner;
  uniform float uOuter;
  uniform float uHoles;
  uniform float uDensity;
  varying vec3 vWorld;
  varying vec3 vNormal;

  float ring(float d, float w) {
    float aa = max(fwidth(d), 1e-4);
    return 1.0 - smoothstep(w - aa, w + aa, abs(d));
  }

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 v = toCam / dist;
    vec3 sky = skyBase(-v);
    float mask = towerMask(vWorld);
    if (mask > 0.999) {
      gl_FragColor = vec4(sky, 1.0);
      #include <colorspace_fragment>
      return;
    }
    // Lit from above and from behind the tower, whichever way the camera faces
    vec2 away = -normalize(cameraPosition.xz + vec2(1e-4, 0.0));
    vec3 L = normalize(vec3(away.x, 1.1, away.y));
    vec3 col;
    if (uKind > 1.5) {
      // Lines: fine gold wires
      col = uGold * 0.45;
    } else {
      vec3 n = normalize(vNormal);
      if (dot(n, v) < 0.0) n = -n;
      float diff = max(dot(n, L), 0.0);
      float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      if (uKind < 0.5 && abs(n.y) > 0.7) {
        float r = length(vWorld.xz);
        float a = atan(vWorld.z, vWorld.x);
        float span = uOuter - uInner;
        float detail = 1.0;
        float gold = 0.0;
        float steel = 0.0;
        // Feedthrough holes round the middle: dark recesses in steel collars
        float mid = uInner + span * 0.52;
        float cell = 6.2831853 / uHoles;
        float k = (fract(a / cell + 0.5) - 0.5) * cell * mid;
        float hr = min(span * 0.09, 0.95);
        float d = length(vec2(k, r - mid));
        float aaH = max(fwidth(d), 1e-4);
        detail *= mix(1.0, 0.4, 1.0 - smoothstep(hr - aaH, hr + aaH, d));
        steel += ring(d - hr - 0.12, 0.1);
        // Bolt circles near both rims
        for (int j = 0; j < 2; j++) {
          float br = j == 0 ? uInner + 0.55 : uOuter - 0.6;
          float bn = floor(6.2831853 * br / 1.3);
          float bc = 6.2831853 / bn;
          float bk = (fract(a / bc + 0.5) - 0.5) * bc * br;
          gold = max(gold, ring(length(vec2(bk, r - br)), 0.1) * 0.6);
        }
        // Machined grooves
        detail -= 0.3 * ring(r - (uInner + span * 0.2), 0.05);
        detail -= 0.3 * ring(r - (uInner + span * 0.84), 0.05);
        // The polished lip of each rim, a fine line of gold
        gold = max(gold, ring(r - uInner - 0.07, 0.05));
        gold = max(gold, ring(r - uOuter + 0.07, 0.05) * 0.6);
        // A lathe-turned sheen: fine concentric streaks catching the light
        vec3 h = normalize(L + v);
        float spec = pow(max(dot(n, h), 0.0), 10.0);
        float turns = 12.0 * r;
        float streak = mix(0.5, 0.5 + 0.5 * sin(turns), clamp(1.0 - fwidth(turns) * 0.4, 0.0, 1.0));
        col = uPlate * detail * (0.75 + 0.45 * diff);
        col += uGold * (gold * 0.45 + spec * streak * 0.2);
        col += uSteel * steel * 0.22;
        col += uGlow * max(-n.y, 0.0) * 0.12;
      } else {
        // Rims and posts: the edges that catch the light
        col = uGold * (0.06 + 0.2 * diff + 0.45 * fres);
        col += uGlow * max(-n.y, 0.0) * 0.14;
      }
    }
    // Mist: with distance, thicker the deeper down, and complete across
    // the tower
    float fog = 1.0 - exp(-dist * uDensity);
    fog = max(fog, smoothstep(-4.0, -44.0, vWorld.y) * 0.92);
    fog = max(fog, mask);
    col = mix(col, sky, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const chandelierMaterial = (kind: number, plate?: Plate) =>
  new ShaderMaterial({
    fog: false,
    side: kind === 0 ? DoubleSide : FrontSide,
    uniforms: {
      ...skyUniforms(),
      uGold: { value: new Color(PALETTE.chandelier) },
      uPlate: { value: new Color(PALETTE.plate) },
      uSteel: { value: new Color(PALETTE.steel) },
      uKind: { value: kind },
      uInner: { value: plate?.inner ?? 0 },
      uOuter: { value: plate?.outer ?? 1 },
      uHoles: { value: plate?.holes ?? 1 },
      uDensity: { value: 0.04 },
    },
    vertexShader: CHANDELIER_VERTEX,
    fragmentShader: CHANDELIER_FRAGMENT,
  });

/** A plate as a lathe: its top, its rims and its underside. */
const plateGeometry = ({ inner, outer, thick }: Plate) => {
  const bevel = 0.12;
  const pts = [
    new Vector2(inner, -thick),
    new Vector2(inner - bevel * 0.3, -thick + bevel),
    new Vector2(inner - bevel * 0.3, -bevel),
    new Vector2(inner, 0),
    new Vector2(outer, 0),
    new Vector2(outer + bevel * 0.3, -bevel),
    new Vector2(outer + bevel * 0.3, -thick + bevel),
    new Vector2(outer, -thick),
    new Vector2(inner, -thick),
  ];
  return new LatheGeometry(pts, 160);
};

/** Posts between neighbouring plates, with a clamp ring at each end. */
const postsGeometry = () => {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < PLATES.length - 1; i++) {
    const top = PLATES[i];
    const bottom = PLATES[i + 1];
    const r = (Math.max(top.inner, bottom.inner) + Math.min(top.outer, bottom.outer)) / 2;
    // None round the camera's height: they would stand beside the view
    if (i < 2) continue;
    const count = i < 4 ? 6 : 4;
    const height = top.y - top.thick - bottom.y;
    const radius = 0.32 - i * 0.03;
    for (let k = 0; k < count; k++) {
      const a = ((k + 0.5 + i * 0.37) / count) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const post = new CylinderGeometry(radius, radius, height, 10, 1, true);
      post.translate(x, bottom.y + height / 2, z);
      parts.push(post);
      for (const y of [top.y - top.thick - 0.35, bottom.y + 0.35]) {
        const clamp = new CylinderGeometry(radius * 1.9, radius * 1.9, 0.5, 12);
        clamp.translate(x, y, z);
        parts.push(clamp);
      }
    }
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  parts.forEach((p) => p.dispose());
  return merged;
};

/**
 * The coaxial lines: dense bundles hanging from each plate to the next, just
 * inside the lower plate's rim, and from the top plate up into the dark.
 * Each line drops from an attenuator under its plate (a bead, drawn as a
 * point), swings out through a thermal U-bend, kinks inward where the stages
 * narrow, and drops to the next plate.
 */
const linesGeometry = () => {
  const random = rng(42);
  const pos: number[] = [];
  const beads: number[] = [];
  for (let i = 0; i < PLATES.length - 1; i++) {
    const top = PLATES[i];
    const bottom = PLATES[i + 1];
    const bundles = i < 3 ? 22 : 14;
    const rTop = top.inner + 0.9;
    const rBottom = Math.min(bottom.outer - 0.9, rTop);
    const y0 = top.y - top.thick;
    const y1 = bottom.y;
    for (let b = 0; b < bundles; b++) {
      const a0 = ((b + 0.25 + i * 0.5) / bundles) * Math.PI * 2;
      const lines = 8 + Math.floor(random() * 5);
      for (let l = 0; l < lines; l++) {
        const a = a0 + ((l - lines / 2) * 0.22) / rTop;
        const r0 = rTop + (random() - 0.5) * 0.3;
        const r1 = rBottom + (random() - 0.5) * 0.3;
        const p = (r: number, y: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
        const path: number[][] = [p(r0, y0)];
        // The U-bend: a smooth swing outward and back
        const bend = y0 - 1.2 - random() * 0.8;
        for (let k = 0; k <= 6; k++) {
          const y = bend - (k / 6) * 1.1;
          path.push(p(r0 + 0.45 * Math.sin((k / 6) * Math.PI), y));
        }
        // The kink inward, then straight down to the next plate
        const kink = y0 - (y0 - y1) * (0.45 + random() * 0.25);
        path.push(p(r0, kink), p(r1, kink - 1.2), p(r1, y1));
        for (let k = 1; k < path.length; k++) pos.push(...path[k - 1], ...path[k]);
        beads.push(...p(r0, y0 - 0.35), ...p(r1, y1 + 0.25));
      }
    }
  }
  // Up from the top plate, into the dark
  const top = PLATES[0];
  for (let b = 0; b < 22; b++) {
    const a0 = (b / 22) * Math.PI * 2;
    for (let l = 0; l < 9; l++) {
      const a = a0 + ((l - 4.5) * 0.22) / (top.inner + 2);
      const r = top.inner + 2 + random() * 0.4;
      pos.push(Math.cos(a) * r, top.y, Math.sin(a) * r, Math.cos(a) * r, 60, Math.sin(a) * r);
      beads.push(Math.cos(a) * r, top.y + 0.35, Math.sin(a) * r);
    }
  }
  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  lineGeometry.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length), 3));
  const beadGeometry = new BufferGeometry();
  beadGeometry.setAttribute('position', new BufferAttribute(new Float32Array(beads), 3));
  return { lineGeometry, beadGeometry };
};

/** The attenuators: small gold beads on the lines, a few pixels across, misted like the rest. */
const beadMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...skyUniforms(),
      uGold: { value: new Color(PALETTE.chandelier) },
      uDensity: { value: 0.04 },
    },
    vertexShader: /* glsl */ `
      ${TOWER_MASK_GLSL}
      uniform float uDensity;
      varying float vFog;
      varying vec3 vDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float dist = distance(world.xyz, cameraPosition);
        vFog = max(max(1.0 - exp(-dist * uDensity), smoothstep(-4.0, -44.0, world.y) * 0.92), towerMask(world.xyz));
        vDir = normalize(world.xyz - cameraPosition);
        gl_PointSize = clamp(90.0 / dist, 1.5, 3.5);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform vec3 uGold;
      varying float vFog;
      varying vec3 vDir;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = 1.0 - smoothstep(0.5, 1.0, d);
        if (a < 0.01 || vFog > 0.995) discard;
        gl_FragColor = vec4(mix(uGold * 0.5, skyBase(vDir), vFog), a);
        #include <colorspace_fragment>
      }`,
  });

const Chandelier = () => {
  const { plates, posts, lines, beads } = useMemo(
    () => ({
      plates: PLATES.map((p) => ({
        geometry: plateGeometry(p),
        material: chandelierMaterial(0, p),
        y: p.y,
      })),
      posts: { geometry: postsGeometry(), material: chandelierMaterial(1) },
      ...(() => {
        const { lineGeometry, beadGeometry } = linesGeometry();
        return {
          lines: { geometry: lineGeometry, material: chandelierMaterial(2) },
          beads: { geometry: beadGeometry, material: beadMaterial() },
        };
      })(),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const p of [...plates, posts, lines, beads]) {
        p.geometry.dispose();
        p.material.dispose();
      }
    },
    [plates, posts, lines, beads],
  );
  return (
    <group name="chandelier">
      {plates.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geometry}
          material={p.material}
          position={[0, p.y, 0]}
          renderOrder={-900}
          raycast={noRaycast}
        />
      ))}
      <mesh
        geometry={posts.geometry}
        material={posts.material}
        renderOrder={-900}
        raycast={noRaycast}
      />
      <lineSegments
        geometry={lines.geometry}
        material={lines.material}
        renderOrder={-900}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <points
        geometry={beads.geometry}
        material={beads.material}
        renderOrder={-890}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};

/**
 * Frost: a sparse, still haze of tiny cold points hanging in the cryostat
 * round the board, fading with distance like everything else, for depth.
 */
const FrostMotes = ({ count = 380 }: { count?: number }) => {
  const { geometry, material } = useMemo(() => {
    const random = rng(7);
    const pos = new Float32Array(count * 3);
    const bright = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = 17 + random() ** 0.7 * 28;
      const y = -30 + random() * 50;
      pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      bright[i] = 0.25 + random() ** 3 * 0.75;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aBright', new BufferAttribute(bright, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      uniforms: { uColor: { value: new Color(PALETTE.frost) }, uDensity: { value: 0.042 } },
      vertexShader: /* glsl */ `
        ${TOWER_MASK_GLSL}
        attribute float aBright;
        uniform float uDensity;
        varying float vA;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          float dist = distance(world.xyz, cameraPosition);
          // Thinned by the mist, and gone before it could come near the eye
          vA = aBright * exp(-dist * uDensity) * smoothstep(5.0, 10.0, dist)
            * (1.0 - smoothstep(-4.0, -30.0, world.y) * 0.8)
            * (1.0 - towerMask(world.xyz));
          gl_PointSize = 1.0 + aBright * 1.6;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float d = length(q) * 2.0;
          float a = (1.0 - smoothstep(0.4, 1.0, d)) * vA * 0.9;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    return { geometry, material };
  }, [count]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={-800}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Light ------------------------------------------------------------------------

/**
 * What the pieces reflect: a cool softbox overhead, the chandelier's warm
 * gold in a band round the horizon, the dark below. Rotationally symmetric,
 * so polished gold looks the same from every seat and azimuth.
 */
const ReflectionRoom = () => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: {},
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 c = vec3(0.012, 0.018, 0.03);
            // A ring of softbox overhead, cool white, round a dimmer warm
            // zenith: tops seen from above stay a rich gold, not a white glare
            c += vec3(1.36, 1.3, 1.22) * smoothstep(0.55, 0.75, h) * (1.0 - smoothstep(0.86, 0.96, h));
            c += vec3(0.55, 0.45, 0.32) * smoothstep(0.86, 0.96, h);
            // A thin bright ring round it, for a crisp highlight on the shoulders
            c += vec3(1.1, 1.02, 0.9) * exp(-pow((h - 0.42) / 0.04, 2.0));
            // The chandelier's gold in a band above the horizon
            c += vec3(0.55, 0.36, 0.14) * exp(-pow((h - 0.12) / 0.1, 2.0));
            // A cool bounce from the wafers below the horizon
            c += vec3(0.05, 0.1, 0.18) * exp(-pow((h + 0.25) / 0.2, 2.0));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material}>
      <sphereGeometry args={[20, 48, 24]} />
    </mesh>
  );
};

const DEG = Math.PI / 180;

/**
 * Lights that travel with the camera, so every piece is modelled the same
 * from any orbit and either seat: a neutral key over the viewer's left
 * shoulder and a frosty rim from behind the tower.
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
    place(key.current, az - 40 * DEG, 50 * DEG);
    place(rim.current, az + 180 * DEG + 30 * DEG, 25 * DEG);
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.2} color="#fff4e6" />
      <directionalLight ref={rim} intensity={1.6} color={PALETTE.frost} />
    </>
  );
};

export const Stage = () => (
  <>
    <CryoSky />
    <Chandelier />
    <FrostMotes />
    <Environment resolution={128} frames={1}>
      <ReflectionRoom />
    </Environment>
    <hemisphereLight args={['#c9dcff', '#0a1220', 0.55]} />
    <CameraLights />
  </>
);
