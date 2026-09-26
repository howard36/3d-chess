import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  Color,
  IcosahedronGeometry,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { InstancedMesh } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { Vec3 } from '../types';
import { PETAL_COLORS, petalGeometry, petalMaterial } from './petals';
import { contactShadow, graniteTexture } from './textures';

// The karesansui below the tower: raked sand, combed in straight lines and
// in rings around the stones (and around the tower's own feet), a few
// mossy rocks, and blossom that has already fallen.

/** A rake zone: rings start `inner` from its centre and run for `band`. */
interface Zone {
  x: number;
  z: number;
  inner: number;
  band: number;
}

interface Rock {
  x: number;
  z: number;
  scale: Vec3;
  yaw: number;
  seed: number;
}

export const ZONES: Zone[] = [
  { x: 0, z: 0, inner: 4.5, band: 2.1 },
  { x: -8.4, z: -2.2, inner: 1.75, band: 1.9 },
  { x: 8.9, z: -6.2, inner: 1.55, band: 1.9 },
  { x: -5.2, z: -15, inner: 1.05, band: 1.6 },
  { x: 5, z: -19, inner: 0.85, band: 1.5 },
];

const ROCKS: Rock[] = [
  { x: -8.7, z: -2.5, scale: [1.25, 0.8, 1.0], yaw: 0.4, seed: 1 },
  { x: -7.5, z: -1.2, scale: [0.5, 0.42, 0.45], yaw: 1.2, seed: 2 },
  { x: 8.9, z: -6.2, scale: [1.2, 0.95, 1.05], yaw: 2.1, seed: 3 },
  { x: -5.2, z: -15, scale: [0.85, 0.6, 0.7], yaw: 0.9, seed: 4 },
  { x: 5, z: -19, scale: [0.6, 0.55, 0.55], yaw: 2.6, seed: 5 },
];

// --- Sand -------------------------------------------------------------------

const sandMaterial = (() => {
  const m = new MeshStandardMaterial({ color: '#e7dfcd', roughness: 0.96, metalness: 0 });
  const zones = ZONES.map((z) => new Vector3(z.x, z.z, z.inner));
  const bands = ZONES.map((z) => z.band);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uZones = { value: zones };
    shader.uniforms.uBands = { value: bands };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSand;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSand = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSand;
        uniform vec3 uZones[${ZONES.length}];
        uniform float uBands[${ZONES.length}];
        float sandHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 p = vSand.xz;
          const float FREQ = 22.0;
          // Straight combing across the garden...
          float phase = p.y * FREQ;
          vec2 grad = vec2(0.0, FREQ);
          float edge = 1.0;
          // ...and rings around each stone, within its band
          for (int i = 0; i < ${ZONES.length}; i++) {
            vec2 d = p - uZones[i].xy;
            float r = length(d) - uZones[i].z;
            if (r < uBands[i]) {
              phase = max(r, 0.0) * FREQ;
              grad = normalize(d) * FREQ;
              // The groove nearest the stone is left smooth
              edge = smoothstep(0.0, 0.25, r);
            }
          }
          // Fade the grooves out where they'd shimmer (far away)
          float fw = fwidth(phase);
          float amp = 0.32 * edge * (1.0 - smoothstep(0.7, 2.2, fw));
          float h = sin(phase);
          vec2 dh = cos(phase) * grad / FREQ * amp;
          vec3 nw = normalize(vec3(-dh.x, 1.0, -dh.y));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
          float grit = sandHash(floor(p * 180.0));
          diffuseColor.rgb *= (0.965 + 0.05 * h * edge) * (0.97 + 0.06 * grit);
        }`,
      );
  };
  return m;
})();

export const Sand = ({ y }: { y: number }) => (
  <mesh
    rotation={[-Math.PI / 2, 0, 0]}
    position={[0, y, -10]}
    material={sandMaterial}
    receiveShadow
    raycast={noRaycast}
  >
    <planeGeometry args={[150, 150]} />
  </mesh>
);

// --- Rocks -------------------------------------------------------------------

const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
const noise3 = (x: number, y: number, z: number) => {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const fx = s(x - i);
  const fy = s(y - j);
  const fz = s(z - k);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (di: number, dj: number, dk: number) => hash3(i + di, j + dj, k + dk);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
};

const rockGeometry = (seed: number) => {
  const g = new IcosahedronGeometry(1, 4);
  const p = g.getAttribute('position');
  const v = new Vector3();
  const o = seed * 7.3;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n =
      (noise3(v.x * 1.4 + o, v.y * 1.4, v.z * 1.4) - 0.5) * 0.45 +
      (noise3(v.x * 3.5, v.y * 3.5 + o, v.z * 3.5) - 0.5) * 0.14;
    v.multiplyScalar(1 + n);
    // Settled into the sand: a flattened underside
    v.y = Math.max(v.y, -0.35);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // Moss on the tops, weathered stone below
  const nrm = g.getAttribute('normal');
  const colors = new Float32Array(p.count * 3);
  const stone = new Color('#8d877e');
  const dark = new Color('#5f5a54');
  const moss = new Color('#6f7d43');
  const c = new Color();
  for (let i = 0; i < p.count; i++) {
    const up = nrm.getY(i);
    const n = noise3(p.getX(i) * 3 + o, p.getY(i) * 3, p.getZ(i) * 3);
    c.copy(stone).lerp(dark, Math.min(1, n * 0.9 + (up < 0 ? 0.3 : 0)));
    const m = Math.max(0, (up - 0.45) * 2.2) * (0.5 + n);
    c.lerp(moss, Math.min(0.85, m));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
};

const rockMaterial = new MeshStandardMaterial({
  vertexColors: true,
  map: graniteTexture,
  roughness: 0.93,
  metalness: 0,
});

export const Rocks = ({ y }: { y: number }) => {
  const geometries = useMemo(() => ROCKS.map((r) => rockGeometry(r.seed)), []);
  return (
    <>
      {ROCKS.map((r, i) => (
        <group key={i} position={[r.x, y + r.scale[1] * 0.3, r.z]}>
          <mesh
            geometry={geometries[i]}
            material={rockMaterial}
            scale={r.scale}
            rotation={[0, r.yaw, 0]}
            castShadow
            receiveShadow
            raycast={noRaycast}
          />
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -r.scale[1] * 0.3 + 0.01, 0]}
            scale={[r.scale[0] * 3, r.scale[2] * 3, 1]}
            raycast={noRaycast}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={contactShadow} transparent depthWrite={false} />
          </mesh>
        </group>
      ))}
    </>
  );
};

// --- Fallen petals ------------------------------------------------------------

export const FallenPetals = ({ y, count = 90 }: { y: number; count?: number }) => {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const random = rng(33);
    const o = new Object3D();
    const c = new Color();
    for (let i = 0; i < count; i++) {
      // Drifted against the stones and scattered across the sand
      const zone = ZONES[1 + Math.floor(random() * (ZONES.length - 1))];
      const near = random() < 0.55;
      const a = random() * Math.PI * 2;
      const r = near ? zone.inner * (0.8 + random() * 0.9) : 3 + random() * 14;
      const cx = near ? zone.x : 0;
      const cz = near ? zone.z : -6;
      o.position.set(cx + Math.cos(a) * r, y + 0.012, cz + Math.sin(a) * r);
      o.rotation.set(-Math.PI / 2 + (random() - 0.5) * 0.3, 0, random() * Math.PI * 2);
      o.scale.setScalar(0.8 + random() * 0.6);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(PETAL_COLORS[i % PETAL_COLORS.length]));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [count, y]);
  return (
    <instancedMesh
      ref={mesh}
      args={[petalGeometry, petalMaterial, count]}
      raycast={noRaycast}
      receiveShadow
    />
  );
};
