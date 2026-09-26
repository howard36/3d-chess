import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { Group, Mesh, PerspectiveCamera, Texture } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { Vec3 } from '../types';

// Effects for Ice & Fire: a trail shed along a hop (snow or embers), a
// shockwave ring, a flame shader for rings and columns, and ice spikes that
// burst out of the floor. Everything runs on r3f's clock with the same frame
// clamp as the move glide.

const MAX_FRAME = 1 / 30;

/** Shared clock for the animated shaders; the Stage advances it. */
export const elementTime = { value: 0 };

const soft = dotTexture(0.6);

const pointScale = (state: {
  camera: unknown;
  size: { height: number };
  viewport: { dpr: number };
}) => {
  const cam = state.camera as PerspectiveCamera;
  const fov = ((cam.fov ?? 40) * Math.PI) / 180;
  return (state.size.height * state.viewport.dpr) / (2 * Math.tan(fov / 2));
};

/**
 * Particles shed along a hop from `from` to `to` (world points at the height
 * of the piece's body). Each appears as the piece passes and drifts by
 * `drift` per second (snow sinks, embers rise) while it fades.
 */
export const Trail = ({
  from,
  to,
  lift,
  durationMs,
  colors,
  drift = [0, -0.3, 0],
  count = 50,
  size = 0.1,
  lifeMs = 900,
  texture = soft,
  seed = 9,
}: {
  from: Vec3;
  to: Vec3;
  lift: number;
  durationMs: number;
  colors: string[];
  drift?: Vec3;
  count?: number;
  size?: number;
  lifeMs?: number;
  texture?: Texture;
  seed?: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const elapsed = useRef(0);
  const { geometry, material } = useMemo(() => {
    const random = rng(seed);
    const at = new Float32Array(count);
    const off = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const s = new Float32Array(count);
    const c = new Color();
    for (let i = 0; i < count; i++) {
      at[i] = Math.min(1, (i + random() * 0.9) / count);
      const u = random() * 2 - 1;
      const t = random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const m = 0.3 + random() * 0.7;
      off.set([r * Math.cos(t) * m, u * m, r * Math.sin(t) * m], i * 3);
      c.set(colors[Math.floor(random() * colors.length)]);
      col.set([c.r, c.g, c.b], i * 3);
      s[i] = random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aAt', new BufferAttribute(at, 1));
    geometry.setAttribute('aOff', new BufferAttribute(off, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(s, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uFrom: { value: new Vector3(...from) },
        uTo: { value: new Vector3(...to) },
        uDrift: { value: new Vector3(...drift) },
        uLift: { value: lift },
        uDur: { value: durationMs / 1000 },
        uT: { value: 0 },
        uLife: { value: lifeMs / 1000 },
        uSize: { value: size },
        uScale: { value: 400 },
        uMap: { value: texture },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uFrom; uniform vec3 uTo; uniform vec3 uDrift; uniform float uLift;
        uniform float uDur; uniform float uT; uniform float uLife; uniform float uSize;
        uniform float uScale;
        attribute float aAt; attribute vec3 aOff; attribute float aSeed;
        varying vec3 vColor; varying float vAlpha;
        float easeInOutCubic(float t) {
          return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
        }
        void main() {
          vColor = color;
          float age = uT - aAt * uDur;
          float a = max(age, 0.0);
          float e = easeInOutCubic(aAt);
          vec3 p = mix(uFrom, uTo, e);
          p.y += uLift * 4.0 * e * (1.0 - e);
          p += aOff * (0.12 + 0.3 * (1.0 - exp(-2.5 * a)));
          p += uDrift * a * (0.6 + 0.8 * aSeed);
          float k = clamp(a / (uLife * (0.55 + 0.45 * aSeed)), 0.0, 1.0);
          float flicker = 0.7 + 0.3 * sin(uT * 20.0 + aSeed * 60.0);
          vAlpha = age < 0.0 ? 0.0 : (1.0 - k) * (1.0 - k) * flicker;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (0.6 + 0.9 * aSeed) * (1.0 - 0.5 * k) * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    return { geometry, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a trail is configured once
  }, []);

  useEffect(() => invalidate(), [invalidate]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((state, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    material.uniforms.uT.value = elapsed.current;
    material.uniforms.uScale.value = pointScale(state);
    if (elapsed.current * 1000 > durationMs + lifeMs) setDone(true);
    else invalidate();
  });

  if (done) return null;
  return (
    <points geometry={geometry} material={material} raycast={noRaycast} frustumCulled={false} />
  );
};

/** A flat ring of light that swells outward along the floor and fades. */
export const Shockwave = ({
  position,
  color,
  radius = 0.9,
  lifeMs = 600,
  delayMs = 0,
  opacity = 0.9,
}: {
  position: Vec3;
  color: string;
  radius?: number;
  lifeMs?: number;
  delayMs?: number;
  opacity?: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const elapsed = useRef(-delayMs / 1000);
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: { uColor: { value: new Color(color) }, uK: { value: 0 }, uO: { value: opacity } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uK; uniform float uO; varying vec2 vUv;
          void main() {
            float r = length(vUv - 0.5) * 2.0;
            float ring = smoothstep(uK - 0.25, uK, r) * (1.0 - smoothstep(uK, uK + 0.05, r));
            gl_FragColor = vec4(uColor, ring * (1.0 - uK) * uO);
            #include <colorspace_fragment>
          }`,
      }),
    [color, opacity],
  );
  useEffect(() => invalidate(), [invalidate]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const k = elapsed.current / (lifeMs / 1000);
    material.uniforms.uK.value = Math.max(0, 1 - (1 - Math.min(k, 1)) ** 2.5);
    if (mesh.current) mesh.current.visible = k >= 0;
    if (k >= 1) setDone(true);
    else invalidate();
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      raycast={noRaycast}
      visible={false}
    >
      <planeGeometry args={[radius * 2, radius * 2]} />
    </mesh>
  );
};

/**
 * Flames licking up an open cylinder (its uv.y runs up the wall): scrolling
 * noise shaped into tongues, hot at the root, fading at the tips.
 */
export const flameMaterial = ({
  hot,
  cool,
  intensity = 1.6,
  speed = 2.4,
  tongues = 9,
}: {
  hot: string;
  cool: string;
  intensity?: number;
  speed?: number;
  tongues?: number;
}) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: {
      uTime: elementTime,
      uHot: { value: new Color(hot) },
      uCool: { value: new Color(cool) },
      uInt: { value: intensity },
      uSpeed: { value: speed },
      uTongues: { value: tongues },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uHot; uniform vec3 uCool; uniform float uInt;
      uniform float uSpeed; uniform float uTongues; uniform float uFade;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash(mod(i, vec2(uTongues * 2.0, 64.0)));
        float b = hash(mod(i + vec2(1.0, 0.0), vec2(uTongues * 2.0, 64.0)));
        float c = hash(mod(i + vec2(0.0, 1.0), vec2(uTongues * 2.0, 64.0)));
        float d = hash(mod(i + vec2(1.0, 1.0), vec2(uTongues * 2.0, 64.0)));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      void main() {
        vec2 p = vec2(vUv.x * uTongues * 2.0, vUv.y * 3.0 - uTime * uSpeed);
        float n = noise(p) * 0.6 + noise(p * 2.0 + 7.0) * 0.3 + noise(p * 4.0) * 0.1;
        float tongue = 0.55 + 0.45 * sin(vUv.x * 6.2831853 * uTongues + n * 3.0);
        float h = vUv.y;
        float body = smoothstep(h - 0.05, h + 0.35, n * tongue * 1.25);
        float a = body * (1.0 - h) * uFade;
        vec3 col = mix(uCool, uHot, clamp(body * (1.2 - h), 0.0, 1.0));
        gl_FragColor = vec4(col * uInt, a);
        #include <colorspace_fragment>
      }`,
  });

/**
 * A crown of ice spikes that bursts out of the floor, holds, then sinks
 * away: the blizzard's footprint.
 */
export const IceSpikes = ({
  position,
  count = 12,
  radius = 0.6,
  height = 0.8,
  delayMs = 0,
  holdMs = 2600,
  material,
}: {
  position: Vec3;
  count?: number;
  radius?: number;
  height?: number;
  delayMs?: number;
  holdMs?: number;
  material: import('three').Material;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);
  const elapsed = useRef(-delayMs / 1000);
  const [done, setDone] = useState(false);
  const spikes = useMemo(() => {
    const random = rng(31);
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + random() * 0.3;
      const r = radius * (0.75 + random() * 0.5);
      return {
        p: [Math.cos(a) * r, 0, Math.sin(a) * r] as Vec3,
        tilt: [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45] as Vec3,
        h: height * (0.5 + random() * 0.7),
        w: 0.06 + random() * 0.05,
        lag: random() * 0.12,
      };
    });
  }, [count, radius, height]);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    const g = group.current;
    if (done || !g) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = elapsed.current;
    const end = holdMs / 1000;
    g.children.forEach((c, i) => {
      const s = spikes[i];
      const up = Math.min(Math.max((t - s.lag) / 0.18, 0), 1);
      const grow = 1 - (1 - up) ** 3;
      const sink = Math.min(Math.max((t - end) / 0.5, 0), 1);
      const k = Math.max(grow * (1 - sink), 1e-4);
      c.scale.set(k, k, k);
    });
    if (t > end + 0.6) setDone(true);
    else invalidate();
  });
  if (done) return null;
  return (
    <group ref={group} position={position}>
      {spikes.map((s, i) => (
        <group key={i} position={s.p} rotation={s.tilt} scale={1e-4}>
          <mesh position={[0, s.h / 2, 0]} material={material} raycast={noRaycast}>
            <coneGeometry args={[s.w, s.h, 5]} />
          </mesh>
        </group>
      ))}
    </group>
  );
};
