import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { PerspectiveCamera, Texture } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng, sparkTexture } from '../kit/textures';
import type { Vec3 } from '../types';

// Sparkle effects for the Crystal Garden: a glittering trail that follows a
// moving piece along its hop, and a burst of twinkling four-point stars.
// Both are a single GPU-animated point cloud, driven by r3f's clock (with the
// same frame clamp as the move glide, so the trail stays on the piece).

const MAX_FRAME = 1 / 30;

const spark = sparkTexture(64);

/** Pixels per world unit at unit distance, for sizing points in world units. */
const pointScale = (state: {
  camera: unknown;
  size: { height: number };
  viewport: { dpr: number };
}) => {
  const cam = state.camera as PerspectiveCamera;
  const fov = ((cam.fov ?? 40) * Math.PI) / 180;
  return (state.size.height * state.viewport.dpr) / (2 * Math.tan(fov / 2));
};

const EASE_GLSL = /* glsl */ `
  float easeInOutCubic(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
  }`;

/**
 * Glitter shed along a hop from `from` to `to` (world points at the height of
 * the piece's body): each spark appears as the piece passes, drifts out and
 * sinks a little, twinkling as it fades.
 */
export const SparkleTrail = ({
  from,
  to,
  lift,
  durationMs,
  colors,
  count = 56,
  size = 0.13,
  lifeMs = 900,
  texture = spark,
  additive = true,
  seed = 9,
}: {
  from: Vec3;
  to: Vec3;
  lift: number;
  durationMs: number;
  colors: string[];
  count?: number;
  size?: number;
  lifeMs?: number;
  texture?: Texture;
  /** Glow (additive) or paint (normal blending, which reads on a pale sky). */
  additive?: boolean;
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
      blending: additive ? AdditiveBlending : NormalBlending,
      vertexColors: true,
      uniforms: {
        uFrom: { value: new Vector3(...from) },
        uTo: { value: new Vector3(...to) },
        uLift: { value: lift },
        uDur: { value: durationMs / 1000 },
        uT: { value: 0 },
        uLife: { value: lifeMs / 1000 },
        uSize: { value: size },
        uScale: { value: 400 },
        uMap: { value: texture },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uFrom; uniform vec3 uTo; uniform float uLift; uniform float uDur;
        uniform float uT; uniform float uLife; uniform float uSize; uniform float uScale;
        attribute float aAt; attribute vec3 aOff; attribute float aSeed;
        varying vec3 vColor; varying float vAlpha;
        ${EASE_GLSL}
        void main() {
          vColor = color;
          float age = uT - aAt * uDur;
          float a = max(age, 0.0);
          float e = easeInOutCubic(aAt);
          vec3 p = mix(uFrom, uTo, e);
          p.y += uLift * 4.0 * e * (1.0 - e);
          p += aOff * (0.14 + 0.4 * (1.0 - exp(-2.5 * a)));
          p.y -= 0.35 * a * a;
          float k = clamp(a / (uLife * (0.55 + 0.45 * aSeed)), 0.0, 1.0);
          float twinkle = 0.55 + 0.45 * sin(uT * 22.0 + aSeed * 60.0);
          vAlpha = age < 0.0 ? 0.0 : (1.0 - k) * (1.0 - k) * twinkle;
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

/**
 * A one-shot spray of twinkling four-point stars (the kit's Burst, drawn
 * with a star sprite and a flicker), then unmounts itself.
 */
export const SparkleBurst = ({
  position,
  colors,
  count = 60,
  speed = 2.2,
  gravity = 1.5,
  lifeMs = 1000,
  size = 0.18,
  upward = 0.4,
  additive = true,
  texture = spark,
  seed = 13,
  delayMs = 0,
}: {
  position: Vec3;
  colors: string[];
  count?: number;
  speed?: number;
  gravity?: number;
  lifeMs?: number;
  size?: number;
  upward?: number;
  additive?: boolean;
  texture?: Texture;
  seed?: number;
  delayMs?: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const elapsed = useRef(-delayMs / 1000);
  const { geometry, material } = useMemo(() => {
    const random = rng(seed);
    const vel = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const s = new Float32Array(count);
    const c = new Color();
    for (let i = 0; i < count; i++) {
      const u = random() * 2 - 1;
      const t = random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const v = speed * (0.3 + random() * 0.7);
      vel.set(
        [
          r * Math.cos(t) * v,
          (u * (1 - upward) + upward * (0.6 + random() * 0.8)) * v,
          r * Math.sin(t) * v,
        ],
        i * 3,
      );
      c.set(colors[Math.floor(random() * colors.length)]);
      col.set([c.r, c.g, c.b], i * 3);
      s[i] = random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aVel', new BufferAttribute(vel, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(s, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      vertexColors: true,
      uniforms: {
        uT: { value: 0 },
        uLife: { value: lifeMs / 1000 },
        uGravity: { value: gravity },
        uSize: { value: size },
        uScale: { value: 400 },
        uMap: { value: texture },
      },
      vertexShader: /* glsl */ `
        uniform float uT; uniform float uLife; uniform float uGravity; uniform float uSize;
        uniform float uScale;
        attribute vec3 aVel; attribute float aSeed;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = color;
          float t = max(uT, 0.0);
          float drag = (1.0 - exp(-2.4 * t)) / 2.4;
          vec3 p = aVel * drag - vec3(0.0, 0.5 * uGravity * t * t, 0.0);
          float k = clamp(t / (uLife * (0.55 + 0.45 * aSeed)), 0.0, 1.0);
          float twinkle = 0.55 + 0.45 * sin(uT * 18.0 + aSeed * 70.0);
          vAlpha = uT < 0.0 ? 0.0 : (1.0 - k) * twinkle;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (0.5 + aSeed) * (1.0 - 0.4 * k) * uScale / -mv.z;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a burst is configured once
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
    if (elapsed.current * 1000 > lifeMs) setDone(true);
    else invalidate();
  });

  if (done) return null;
  return (
    <points
      geometry={geometry}
      material={material}
      position={position}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/**
 * A flat ring of light that swells outward along the floor and fades: the
 * flash of a landing or a shattering.
 */
export const Shockwave = ({
  position,
  color,
  radius = 0.9,
  lifeMs = 600,
  delayMs = 0,
  opacity = 0.9,
  additive = true,
}: {
  position: Vec3;
  color: string;
  radius?: number;
  lifeMs?: number;
  delayMs?: number;
  opacity?: number;
  additive?: boolean;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const elapsed = useRef(-delayMs / 1000);
  const mesh = useRef<import('three').Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: additive ? AdditiveBlending : NormalBlending,
        uniforms: { uColor: { value: new Color(color) }, uK: { value: 0 }, uO: { value: opacity } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uK; uniform float uO; varying vec2 vUv;
          void main() {
            float r = length(vUv - 0.5) * 2.0;
            float ring = smoothstep(uK - 0.22, uK, r) * (1.0 - smoothstep(uK, uK + 0.05, r));
            float a = ring * (1.0 - uK) * uO;
            gl_FragColor = vec4(uColor, a);
            #include <colorspace_fragment>
          }`,
      }),
    [color, opacity, additive],
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
