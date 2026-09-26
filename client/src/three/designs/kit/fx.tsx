import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  Object3D,
  PerspectiveCamera,
  ShaderMaterial,
} from 'three';
import type { BufferGeometry as Geometry, Material } from 'three';
import { noRaycast } from './noRaycast';
import { dotTexture, rng } from './textures';
import type { Vec3 } from '../types';

// Shared effects for designs: ambient particle fields, one-shot bursts,
// confetti, screen shake, and a check beacon. Everything here is decorative
// (never raycast) and every animation is driven by r3f's clock, so it plays
// identically on a recorded, frame-stepped run.

const MAX_FRAME = 1 / 30;

/**
 * A GPU-animated field of drifting points filling a box around the board:
 * dust, snow, embers, bubbles, fireflies. Positions wrap inside the box, so
 * the field never runs out. Needs a continuous frame loop to move.
 */
export const AmbientParticles = ({
  count = 300,
  box = [16, 12, 16],
  centre = [0, 0, 0],
  velocity = [0, 0.3, 0],
  sway = 0.3,
  size = 0.12,
  color = '#ffffff',
  colors,
  opacity = 0.8,
  additive = true,
  twinkle = 0,
  texture,
  seed = 3,
}: {
  count?: number;
  box?: Vec3;
  centre?: Vec3;
  velocity?: Vec3;
  sway?: number;
  /** World-space size of a particle. */
  size?: number;
  color?: string;
  /** Per-particle colours, picked at random (overrides `color`). */
  colors?: string[];
  opacity?: number;
  additive?: boolean;
  twinkle?: number;
  texture?: import('three').Texture;
  seed?: number;
}) => {
  const { geometry, material } = useMemo(() => {
    const random = rng(seed);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const s = new Float32Array(count);
    const c = new Color();
    const palette = colors ?? [color];
    for (let i = 0; i < count; i++) {
      pos.set(
        [(random() - 0.5) * box[0], (random() - 0.5) * box[1], (random() - 0.5) * box[2]],
        i * 3,
      );
      c.set(palette[Math.floor(random() * palette.length)]);
      col.set([c.r, c.g, c.b], i * 3);
      s[i] = random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(s, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      vertexColors: true,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: box },
        uVel: { value: velocity },
        uSway: { value: sway },
        uSize: { value: size },
        uOpacity: { value: opacity },
        uTwinkle: { value: twinkle },
        uMap: { value: texture ?? dotTexture(0.6) },
        uScale: { value: 400 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uBox; uniform vec3 uVel; uniform float uSway;
        uniform float uSize; uniform float uScale; uniform float uTwinkle;
        attribute float aSeed;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = color;
          vec3 p = position + uVel * uTime * (0.6 + 0.8 * aSeed);
          p.x += sin(uTime * 0.7 + aSeed * 40.0) * uSway;
          p.z += cos(uTime * 0.5 + aSeed * 23.0) * uSway;
          p = mod(p + uBox * 0.5, uBox) - uBox * 0.5;
          // Fade in and out near the box's faces, so wrapping never pops
          vec3 edge = 1.0 - smoothstep(0.35, 0.5, abs(p) / uBox);
          vAlpha = edge.x * edge.y * edge.z;
          vAlpha *= 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * 3.0 + aSeed * 60.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (0.5 + aSeed) * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uOpacity;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha * uOpacity);
          #include <colorspace_fragment>
        }`,
    });
    return { geometry, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a particle field is configured once
  }, []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    // Point sizes are in pixels: scale world size by the viewport height
    const cam = state.camera as PerspectiveCamera;
    const fov = ((cam.fov ?? 40) * Math.PI) / 180;
    material.uniforms.uScale.value =
      (state.size.height * state.viewport.dpr) / (2 * Math.tan(fov / 2));
  });

  return (
    <points
      geometry={geometry}
      material={material}
      position={centre}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

export interface BurstProps {
  position: Vec3;
  colors: string[];
  count?: number;
  /** Initial speed, world units per second. */
  speed?: number;
  /** Downward acceleration. */
  gravity?: number;
  lifeMs?: number;
  size?: number;
  additive?: boolean;
  /** Bias the spray upward (0 = all directions, 1 = a fountain). */
  upward?: number;
  seed?: number;
  /** Delay before the burst starts. */
  delayMs?: number;
}

/**
 * A one-shot spray of glowing points from `position` that falls and fades,
 * then unmounts itself.
 */
export const Burst = ({
  position,
  colors,
  count = 60,
  speed = 2.5,
  gravity = 3,
  lifeMs = 900,
  size = 0.12,
  additive = true,
  upward = 0.4,
  seed = 11,
  delayMs = 0,
}: BurstProps) => {
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
      const v = speed * (0.35 + random() * 0.65);
      const dir = [
        r * Math.cos(t),
        u * (1 - upward) + upward * (0.6 + random() * 0.8),
        r * Math.sin(t),
      ];
      vel.set(
        dir.map((d) => d * v),
        i * 3,
      );
      c.set(colors[Math.floor(random() * colors.length)]);
      col.set([c.r, c.g, c.b], i * 3);
      s[i] = 0.4 + random() * 0.9;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aVel', new BufferAttribute(vel, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setAttribute('aScale', new BufferAttribute(s, 1));
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
        uMap: { value: dotTexture(0.5) },
      },
      vertexShader: /* glsl */ `
        uniform float uT; uniform float uLife; uniform float uGravity; uniform float uSize; uniform float uScale;
        attribute vec3 aVel; attribute float aScale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = color;
          float t = max(uT, 0.0);
          // Air drag: velocity decays, so sparks slow as they spread
          float drag = (1.0 - exp(-2.2 * t)) / 2.2;
          vec3 p = aVel * drag - vec3(0.0, 0.5 * uGravity * t * t, 0.0);
          float k = clamp(t / (uLife * (0.6 + 0.4 * aScale)), 0.0, 1.0);
          vAlpha = uT < 0.0 ? 0.0 : (1.0 - k) * (1.0 - k);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * aScale * (1.0 - 0.5 * k) * uScale / -mv.z;
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
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    material.uniforms.uT.value = elapsed.current;
    const cam = state.camera as PerspectiveCamera;
    const fov = ((cam.fov ?? 40) * Math.PI) / 180;
    material.uniforms.uScale.value =
      (state.size.height * state.viewport.dpr) / (2 * Math.tan(fov / 2));
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

export interface ShardsProps {
  position: Vec3;
  /** The shard geometry (small tetrahedra, cubes, flat quads for confetti). */
  geometry: Geometry;
  material: Material;
  count?: number;
  speed?: number;
  gravity?: number;
  lifeMs?: number;
  /** Starting scale of each shard. */
  scale?: number;
  /** Spin, radians per second. */
  spin?: number;
  upward?: number;
  /** Spread of the starting points around `position`. */
  spread?: number;
  /** Per-shard colours (the material must not override instance colour). */
  colors?: string[];
  /** Confetti drifts down slowly and flutters instead of falling like rock. */
  flutter?: boolean;
  seed?: number;
  delayMs?: number;
}

/**
 * A one-shot burst of small solid pieces — shards of a shattered piece,
 * voxel debris, confetti — as one instanced mesh, then unmounts itself.
 */
export const Shards = ({
  position,
  geometry,
  material,
  count = 24,
  speed = 2.5,
  gravity = 6,
  lifeMs = 1100,
  scale = 1,
  spin = 8,
  upward = 0.5,
  spread = 0.15,
  colors,
  flutter = false,
  seed = 5,
  delayMs = 0,
}: ShardsProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useRef<InstancedMesh>(null);
  const [done, setDone] = useState(false);
  const elapsed = useRef(-delayMs / 1000);
  const parts = useMemo(() => {
    const random = rng(seed);
    return Array.from({ length: count }, () => {
      const u = random() * 2 - 1;
      const t = random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const v = speed * (0.4 + random() * 0.6);
      return {
        p: [(random() - 0.5) * spread, random() * spread * 2, (random() - 0.5) * spread],
        v: [
          r * Math.cos(t) * v,
          (u * (1 - upward) + upward * (0.7 + random() * 0.6)) * v,
          r * Math.sin(t) * v,
        ],
        axis: [random() - 0.5, random() - 0.5, random() - 0.5],
        spin: spin * (0.5 + random()),
        scale: scale * (0.6 + random() * 0.7),
        phase: random() * 10,
      };
    });
  }, [count, speed, spread, spin, scale, upward, seed]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m || !colors) return;
    const c = new Color();
    parts.forEach((_, i) => m.setColorAt(i, c.set(colors[i % colors.length])));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [parts, colors]);

  useEffect(() => invalidate(), [invalidate]);

  const dummy = useMemo(() => new Object3D(), []);
  const hidden = useMemo(() => new Matrix4().makeScale(0, 0, 0), []);
  useFrame((_, delta) => {
    const m = mesh.current;
    if (done || !m) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = elapsed.current;
    const k = Math.min(Math.max(t, 0) / (lifeMs / 1000), 1);
    parts.forEach((part, i) => {
      if (t < 0) {
        m.setMatrixAt(i, hidden);
        return;
      }
      if (flutter) {
        // Launched up, then drifting down with a side-to-side flutter
        const up = (1 - Math.exp(-3 * t)) / 3;
        dummy.position.set(
          part.p[0] + part.v[0] * up + Math.sin(t * 5 + part.phase) * 0.12,
          part.p[1] + part.v[1] * up - 0.35 * gravity * t * t * 0.3,
          part.p[2] + part.v[2] * up + Math.cos(t * 4 + part.phase) * 0.12,
        );
      } else {
        const drag = (1 - Math.exp(-1.2 * t)) / 1.2;
        dummy.position.set(
          part.p[0] + part.v[0] * drag,
          part.p[1] + part.v[1] * drag - 0.5 * gravity * t * t,
          part.p[2] + part.v[2] * drag,
        );
      }
      dummy.rotation.set(
        part.axis[0] * part.spin * t,
        part.axis[1] * part.spin * t,
        part.axis[2] * part.spin * t,
      );
      dummy.scale.setScalar(part.scale * (1 - k ** 3));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    if (k >= 1) setDone(true);
    else invalidate();
  });

  if (done) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, count]}
      position={position}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/**
 * Shakes the view for a moment, as from an impact. Shifts the camera's
 * projection (a view offset) rather than moving it, so orbit controls never
 * see a displaced camera.
 */
export const ScreenShake = ({
  intensity = 6,
  durationMs = 350,
}: {
  intensity?: number;
  durationMs?: number;
}) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const finished = useRef(false);

  useEffect(() => {
    invalidate();
    return () => {
      camera.clearViewOffset();
    };
  }, [camera, invalidate]);

  useFrame((_, delta) => {
    if (finished.current) return;
    elapsed.current += Math.min(delta, MAX_FRAME) * 1000;
    const k = elapsed.current / durationMs;
    if (k >= 1) {
      finished.current = true;
      camera.clearViewOffset();
      return;
    }
    const amp = intensity * (1 - k) ** 2;
    const t = elapsed.current / 1000;
    const dx = Math.sin(t * 91) * amp;
    const dy = Math.cos(t * 73) * amp;
    camera.setViewOffset(size.width, size.height, dx, dy, size.width, size.height);
    invalidate();
  });
  return null;
};

/**
 * A pulsing ring on the floor and a soft column of light rising through a
 * king in check.
 */
export const CheckBeacon = ({
  floor,
  color = '#ff3344',
  radius = 0.42,
  height = 1.1,
}: {
  floor: Vec3;
  color?: string;
  radius?: number;
  height?: number;
}) => {
  const ring = useRef<import('three').Mesh>(null);
  const column = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: { uColor: { value: new Color(color) }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
          void main() {
            float pulse = 0.65 + 0.35 * sin(uTime * 6.0);
            float a = (1.0 - vUv.y) * (1.0 - vUv.y) * 0.55 * pulse;
            gl_FragColor = vec4(uColor, a);
            #include <colorspace_fragment>
          }`,
      }),
    [color],
  );
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    column.uniforms.uTime.value = t;
    const r = ring.current;
    if (r) {
      const k = (t * 1.3) % 1;
      r.scale.setScalar(0.7 + k * 0.6);
      (r.material as import('three').MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
    state.invalidate();
  });
  return (
    <group position={floor}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} raycast={noRaycast}>
        <ringGeometry args={[radius * 0.82, radius, 48]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, height / 2, 0]} material={column} raycast={noRaycast}>
        <cylinderGeometry args={[radius * 0.75, radius * 0.9, height, 32, 1, true]} />
      </mesh>
    </group>
  );
};
