import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';

// The world around the board: an outrun sunset. A violet sky burning down
// to magenta and orange at the horizon, a striped sun sitting on it, faint
// stars overhead, wireframe mountains either side of the sun, and an endless
// neon grid rolling in under the board toward the viewer.

/** Height of the grid floor, below the lattice. */
export const FLOOR_Y = -4.6;

/** Where the sun sits: straight behind the board as first seen. */
export const sunDirection = (view: readonly [number, number, number]) => {
  const d = new Vector3(-view[0], 0, -view[2]).normalize();
  return d;
};

// --- Sky and sun -----------------------------------------------------------

export const SunsetSky = ({ sun, radius = 450 }: { sun: Vector3; radius?: number }) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTime: { value: 0 },
          uSun: { value: sun.clone().setY(0.03).normalize() },
          uSunSize: { value: Math.tan(0.135) },
          uTop: { value: new Color('#040009') },
          uMid: { value: new Color('#2a0748') },
          uLow: { value: new Color('#8a0f6e') },
          uHorizon: { value: new Color('#ff4d6d') },
          uBelow: { value: new Color('#12031f') },
          uSunTop: { value: new Color('#fff27a') },
          uSunMid: { value: new Color('#ff9d2e') },
          uSunBottom: { value: new Color('#ff2e8a') },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uSun; uniform float uSunSize;
          uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; uniform vec3 uHorizon; uniform vec3 uBelow;
          uniform vec3 uSunTop; uniform vec3 uSunMid; uniform vec3 uSunBottom;
          varying vec3 vWorld;
          void main() {
            vec3 d = normalize(vWorld - cameraPosition);
            float e = d.y;
            vec3 col = mix(uHorizon, uLow, smoothstep(0.0, 0.07, e));
            col = mix(col, uMid, smoothstep(0.05, 0.22, e));
            col = mix(col, uTop, smoothstep(0.18, 0.62, e));
            if (e < 0.0) col = mix(uHorizon * 0.55, uBelow, smoothstep(0.0, 0.05, -e));
            // A hot line right on the horizon
            col += uHorizon * 0.5 * exp(-abs(e) * 90.0);

            // The sun: a disc facing the viewer, yellow at the crown to
            // magenta at the foot, cut by horizontal slits that thicken
            // toward the horizon and slowly sink.
            vec3 s = uSun;
            vec3 right = normalize(cross(s, vec3(0.0, 1.0, 0.0)));
            vec3 up = cross(right, s);
            float fwd = dot(d, s);
            if (fwd > 0.0) {
              vec2 p = vec2(dot(d, right), dot(d, up)) / fwd / uSunSize;
              float r = length(p);
              float aa = fwidth(r) * 1.5;
              vec3 sun = mix(uSunBottom, uSunMid, smoothstep(-0.75, 0.05, p.y));
              sun = mix(sun, uSunTop, smoothstep(0.05, 0.85, p.y));
              float gap = 0.0;
              if (p.y < 0.42) {
                float k = clamp((0.42 - p.y) / 1.2, 0.0, 1.0);
                float band = fract(p.y * 6.0 + uTime * 0.12);
                float w = 0.06 + k * 0.55;
                float fw = fwidth(p.y * 6.0) * 1.2;
                gap = smoothstep(w - fw, w, band) * (1.0 - smoothstep(1.0 - fw, 1.0, band));
                gap = 1.0 - gap;
              }
              float disc = (1.0 - smoothstep(1.0 - aa, 1.0, r)) * (1.0 - gap);
              // Glow around the disc, strongest low down
              float halo = exp(-max(r - 1.0, 0.0) * 2.6) * (1.0 - step(r, 1.0) * (1.0 - gap));
              col += uSunBottom * halo * 0.35 * smoothstep(-0.2, 1.0, 1.0 - p.y * 0.5);
              col = mix(col, sun * 1.05, disc);
            }
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [sun],
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 48, 24]} />
    </mesh>
  );
};

// --- Stars -----------------------------------------------------------------

export const Stars = ({ count = 700, radius = 420 }: { count?: number; radius?: number }) => {
  const { geometry, material } = useMemo(() => {
    const random = rng(21);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Only above the glow of the horizon
      const e = 0.12 + random() ** 0.8 * 1.3;
      const a = random() * Math.PI * 2;
      pos.set(
        [
          radius * Math.cos(e) * Math.cos(a),
          radius * Math.sin(e),
          radius * Math.cos(e) * Math.sin(a),
        ],
        i * 3,
      );
      seed[i] = random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      uniforms: { uTime: { value: 0 }, uDpr: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uDpr;
        attribute float aSeed;
        varying float vAlpha;
        void main() {
          vec3 d = normalize(position);
          vAlpha = (0.35 + 0.65 * aSeed) * (0.6 + 0.4 * sin(uTime * (0.8 + aSeed * 2.0) + aSeed * 50.0));
          vAlpha *= smoothstep(0.1, 0.3, d.y);
          gl_PointSize = (1.0 + aSeed * aSeed * 2.2) * uDpr;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(c));
          gl_FragColor = vec4(vec3(1.0, 0.9, 1.0), a * vAlpha);
        }`,
    });
    return { geometry, material };
  }, [count, radius]);
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uDpr.value = state.viewport.dpr;
  });
  return (
    <points
      geometry={geometry}
      material={material}
      raycast={noRaycast}
      frustumCulled={false}
      renderOrder={-999}
    />
  );
};

// --- The endless grid floor -------------------------------------------------

export const GridFloor = ({ sun, y = FLOOR_Y }: { sun: Vector3; y?: number }) => {
  const material = useMemo(() => {
    // Grid axes: one set of lines runs toward the sun (the vanishing point),
    // the other across it, rolling toward the viewer.
    const toward = new Vector2(-sun.x, -sun.z).normalize();
    return new ShaderMaterial({
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uToward: { value: toward },
        uCell: { value: 3 },
        uLine: { value: new Color('#b026ff').multiplyScalar(0.75) },
        uCross: { value: new Color('#d23cff').multiplyScalar(0.6) },
        uBase: { value: new Color('#07010f') },
        uHaze: { value: new Color('#ff4d6d').multiplyScalar(0.45) },
        uPool: { value: new Color('#27e3ff') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec2 uToward; uniform float uCell;
        uniform vec3 uLine; uniform vec3 uCross; uniform vec3 uBase; uniform vec3 uHaze; uniform vec3 uPool;
        varying vec3 vWorld;
        void main() {
          vec2 xz = vWorld.xz;
          float along = dot(xz, uToward) - uTime * 1.6;
          float across = dot(xz, vec2(-uToward.y, uToward.x));
          vec2 g = vec2(across, along) / uCell;
          vec2 w = fwidth(g);
          vec2 f = abs(fract(g - 0.5) - 0.5);
          // A crisp core and a soft glow either side, fading out where the
          // lines get denser than a pixel (no moire at the horizon)
          vec2 core = 1.0 - smoothstep(vec2(0.0), w * 1.4, f);
          vec2 glow = exp(-f / (w * 3.0 + 0.01)) * 0.22;
          vec2 fade = 1.0 - smoothstep(vec2(0.15), vec2(0.6), w);
          vec3 col = uBase;
          col += uLine * max(core.x, glow.x) * fade.x;
          col += uCross * max(core.y, glow.y) * fade.y;
          float dist = length(vWorld.xz - cameraPosition.xz);
          // A cyan pool of light under the board
          col += uPool * 0.07 * exp(-length(xz) / 3.5);
          // Haze thickening to the horizon
          col = mix(col, uHaze, smoothstep(30.0, 260.0, dist));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
  }, [sun]);
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      material={material}
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={noRaycast}
      frustumCulled={false}
    >
      <planeGeometry args={[1800, 1800]} />
    </mesh>
  );
};

// --- Wireframe mountains ------------------------------------------------------

/**
 * Two ranges of wireframe mountains on the far plain, parted round the sun
 * so it sets into a valley.
 */
export const Mountains = ({ sun, y = FLOOR_Y }: { sun: Vector3; y?: number }) => {
  const { fill, wire } = useMemo(() => {
    const base = Math.atan2(sun.z, sun.x);
    const NA = 96;
    const NR = 10;
    const span = 1.45;
    const r0 = 170;
    const r1 = 290;
    const random = rng(4);
    const jag = Array.from({ length: NA + 1 }, () => random());
    const verts: number[] = [];
    const heightAt = (i: number, j: number) => {
      const a = -span + (2 * span * i) / NA;
      const u = j / NR;
      const ridge =
        22 +
        12 * Math.sin(a * 7.3 + 1.1) +
        7 * Math.sin(a * 15.1 + 2.3) +
        5 * Math.sin(a * 29.7 + 0.4) +
        jag[i] * 5;
      const valley = Math.min(1, Math.max(0, (Math.abs(a) - 0.2) / 0.3));
      const bump = Math.sin(Math.PI * u) ** 1.3 * (0.8 + 0.2 * Math.sin(u * 9 + a * 3));
      return Math.max(0, ridge) * bump * valley;
    };
    const at = (i: number, j: number) => {
      const a = base - span + (2 * span * i) / NA;
      const r = r0 + ((r1 - r0) * j) / NR;
      return [Math.cos(a) * r, y + 0.05 + heightAt(i, j), Math.sin(a) * r];
    };
    for (let i = 0; i <= NA; i++) for (let j = 0; j <= NR; j++) verts.push(...at(i, j));
    const idx: number[] = [];
    const wireIdx: number[] = [];
    const id = (i: number, j: number) => i * (NR + 1) + j;
    for (let i = 0; i < NA; i++)
      for (let j = 0; j < NR; j++) {
        idx.push(
          id(i, j),
          id(i + 1, j),
          id(i, j + 1),
          id(i + 1, j),
          id(i + 1, j + 1),
          id(i, j + 1),
        );
      }
    for (let i = 0; i <= NA; i++)
      for (let j = 0; j <= NR; j++) {
        if (i < NA) wireIdx.push(id(i, j), id(i + 1, j));
        if (j < NR) wireIdx.push(id(i, j), id(i, j + 1));
      }
    const position = new BufferAttribute(new Float32Array(verts), 3);
    const fill = new BufferGeometry();
    fill.setAttribute('position', position);
    fill.setIndex(idx);
    const wire = new BufferGeometry();
    wire.setAttribute('position', position);
    wire.setIndex(wireIdx);
    return { fill, wire };
  }, [sun, y]);
  const fillMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#0c0218',
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
      }),
    [],
  );
  const wireMaterial = useMemo(
    () =>
      new LineBasicMaterial({
        color: new Color('#b43cff').multiplyScalar(0.9),
        toneMapped: false,
        fog: false,
        transparent: true,
        opacity: 0.75,
      }),
    [],
  );
  return (
    <group>
      <mesh geometry={fill} material={fillMaterial} raycast={noRaycast} />
      <lineSegments geometry={wire} material={wireMaterial} raycast={noRaycast} />
    </group>
  );
};
