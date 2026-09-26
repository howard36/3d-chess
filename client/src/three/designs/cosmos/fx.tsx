import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { Group, Mesh, Sprite } from 'three';
import { PieceType } from '../../../engine/pieces';
import { easeInOutCubic } from '../../motion';
import { StauntonParts } from '../classic/pieces';
import { Burst, ScreenShake } from '../kit/fx';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { PieceColor, Vec3 } from '../types';
import { pieceMaterial, pixelScale } from './shaders';

// The Cosmos effects: a comet tail behind a moving piece, a supernova where
// a piece is taken, and a spiral galaxy flung out around a mated king. The
// particle work is done on the GPU; each effect only advances one clock.

const MAX_FRAME = 1 / 30;
const glow = dotTexture(0.75, 128);

/** Height of a piece's body above its cell centre (pieces stand at floor −0.5). */
const BODY = -0.15;

const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

/**
 * Points born along a path over time that fade and drift: the shared
 * shader of the comet tail and the galaxy's trails.
 */
const trailMaterial = (size: number, life: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uT: { value: 0 },
      uDur: { value: 1 },
      uLife: { value: life },
      uSize: { value: size },
      uScale: pixelScale,
      uMap: { value: glow },
    },
    vertexShader: /* glsl */ `
      uniform float uT; uniform float uDur; uniform float uLife; uniform float uSize; uniform float uScale;
      attribute float aBirth; attribute float aScale; attribute vec3 aVel;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vColor = color;
        float age = uT - aBirth * uDur;
        float k = clamp(age / (uLife * (0.55 + 0.45 * aScale)), 0.0, 1.0);
        vAlpha = age < 0.0 ? 0.0 : (1.0 - k) * (1.0 - k);
        float drift = (1.0 - exp(-2.0 * max(age, 0.0))) / 2.0;
        vec3 p = position + aVel * drift;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * aScale * (1.0 - 0.75 * k) * uScale / -mv.z;
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

const COMET_COLORS: Record<PieceColor, string[]> = {
  white: ['#fff3c9', '#ffd27a', '#ffb347', '#ff8a3d'],
  black: ['#e3f4ff', '#8fd8ff', '#8b7bff', '#5b8cff'],
};

/**
 * A comet's tail streaming behind a sliding piece, with a bright coma
 * around the piece while it flies. Mirrors MoveGlide's slide easing.
 */
export const CometTrail = ({
  from,
  to,
  color,
  durationMs,
}: {
  from: Vec3;
  to: Vec3;
  color: PieceColor;
  durationMs: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const head = useRef<Sprite>(null);
  const elapsed = useRef(0);
  const [done, setDone] = useState(false);
  const life = 0.8;
  const dur = durationMs / 1000;
  const a: Vec3 = [from[0], from[1] + BODY, from[2]];
  const b: Vec3 = [to[0], to[1] + BODY, to[2]];

  const { geometry, material } = useMemo(() => {
    const count = 180;
    const random = rng(29);
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const birth = new Float32Array(count);
    const scale = new Float32Array(count);
    const col = new Float32Array(count * 3);
    const c = new Color();
    const palette = COMET_COLORS[color];
    for (let i = 0; i < count; i++) {
      const s = i / (count - 1);
      const p = lerp3(a, b, easeInOutCubic(s));
      const j = 0.07;
      pos.set(
        [
          p[0] + (random() - 0.5) * j,
          p[1] + (random() - 0.5) * j + 0.12,
          p[2] + (random() - 0.5) * j,
        ],
        i * 3,
      );
      vel.set([(random() - 0.5) * 0.5, (random() - 0.3) * 0.35, (random() - 0.5) * 0.5], i * 3);
      birth[i] = s;
      scale[i] = 0.4 + random() * 0.9;
      c.set(palette[Math.min(palette.length - 1, Math.floor(random() ** 1.5 * palette.length))]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aVel', new BufferAttribute(vel, 3));
    geometry.setAttribute('aBirth', new BufferAttribute(birth, 1));
    geometry.setAttribute('aScale', new BufferAttribute(scale, 1));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    const material = trailMaterial(0.26, life);
    material.uniforms.uDur.value = dur;
    return { geometry, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a trail is laid out once, on mount
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = elapsed.current;
    material.uniforms.uT.value = t;
    const h = head.current;
    if (h) {
      const k = Math.min(t / dur, 1);
      h.position.set(...lerp3(a, b, easeInOutCubic(k)));
      h.position.y += 0.12;
      (h.material as SpriteMaterial).opacity = Math.sin(Math.PI * k) * 0.32;
    }
    if (t > dur + life) setDone(true);
    else invalidate();
  });

  if (done) return null;
  return (
    <>
      <points geometry={geometry} material={material} raycast={noRaycast} frustumCulled={false} />
      <sprite ref={head} scale={0.75} raycast={noRaycast}>
        <spriteMaterial
          map={glow}
          color={COMET_COLORS[color][1]}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
    </>
  );
};

// --- Supernova ----------------------------------------------------------------

const shellMaterial = (color: string) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(color) }, uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
        gl_FragColor = vec4(uColor * 2.0, f * uAlpha);
        #include <colorspace_fragment>
      }`,
  });

const NOVA_COLORS: Record<PieceColor, string[]> = {
  white: ['#ffffff', '#fff1c2', '#ffc75a', '#ff8a3d', '#ff5f8f'],
  black: ['#ffffff', '#d7ecff', '#7fd4ff', '#8f7bff', '#ff7ae0'],
};

const easeOut = (k: number) => 1 - (1 - Math.min(Math.max(k, 0), 1)) ** 3;

/**
 * The taken piece heats as the attacker streaks in, flares white and
 * collapses, then goes supernova: a flash, a shockwave ring racing out
 * through its rank, a glowing shell and a spray of star-stuff.
 */
export const Supernova = ({
  floor,
  victim,
  durationMs,
  knightYaw,
}: {
  floor: Vec3;
  victim: { type: PieceType; color: PieceColor };
  durationMs: number;
  knightYaw: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const impact = (durationMs * 0.7) / 1000;
  const elapsed = useRef(0);
  const [phase, setPhase] = useState<'heat' | 'boom' | 'done'>('heat');
  const body = useRef<Group>(null);
  const flash = useRef<Sprite>(null);
  const ring = useRef<Mesh>(null);
  const face = useRef<Mesh>(null);
  const shell = useRef<Mesh>(null);
  const palette = NOVA_COLORS[victim.color];

  const mats = useMemo(
    () => ({
      hot: new MeshBasicMaterial({
        color: victim.color === 'white' ? '#ffd88a' : '#9fdcff',
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      ring: new MeshBasicMaterial({
        color: palette[2],
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
      face: new MeshBasicMaterial({
        color: palette[1],
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
      shell: shellMaterial(palette[3]),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one victim per effect
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const q = useMemo(() => new Quaternion(), []);
  useFrame((_, delta) => {
    if (phase === 'done') return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = elapsed.current;
    const since = t - impact;
    // The victim: glowing hotter as the attacker nears, then flare and collapse
    const b = body.current;
    if (b) {
      if (since < 0) {
        mats.hot.opacity = 0.6 * (t / impact) ** 2;
        b.scale.setScalar(1);
      } else {
        const k = since / 0.26;
        mats.hot.opacity = 1;
        b.scale.setScalar(k < 0.3 ? 1 + 0.5 * k : Math.max(1e-4, 1.15 * (1 - (k - 0.3) / 0.7)));
        b.visible = k < 1;
      }
    }
    const f = flash.current;
    if (f) {
      const k = since / 0.55;
      f.visible = since > 0 && k < 1;
      f.scale.setScalar(0.4 + 3.2 * easeOut(k));
      (f.material as SpriteMaterial).opacity = (1 - k) ** 2;
    }
    const r = ring.current;
    if (r) {
      const k = since / 0.85;
      r.visible = since > 0 && k < 1;
      r.scale.setScalar(0.2 + 2.5 * easeOut(k));
      mats.ring.opacity = 0.75 * (1 - k) ** 1.6;
    }
    const fr = face.current;
    if (fr) {
      const k = since / 0.6;
      fr.visible = since > 0 && k < 1;
      fr.scale.setScalar(0.2 + 1.9 * easeOut(k));
      fr.quaternion.copy(q.copy(camera.quaternion));
      mats.face.opacity = (1 - k) ** 2 * 0.9;
    }
    const s = shell.current;
    if (s) {
      const k = since / 0.6;
      s.visible = since > 0 && k < 1;
      s.scale.setScalar(0.2 + 1.6 * easeOut(k));
      mats.shell.uniforms.uAlpha.value = 0.6 * (1 - k) ** 2;
    }
    if (phase === 'heat' && since >= 0) setPhase('boom');
    if (since > 1.6) setPhase('done');
    else invalidate();
  });

  if (phase === 'done') return null;
  const centre: Vec3 = [floor[0], floor[1] + 0.35, floor[2]];
  const yaw = victim.color === 'white' ? -knightYaw : knightYaw;
  return (
    <>
      <group position={floor}>
        <group ref={body} rotation={[0, victim.type === PieceType.Knight ? yaw : 0, 0]}>
          <StauntonParts
            type={victim.type}
            material={pieceMaterial(victim.color)}
            groove={pieceMaterial(victim.color)}
          />
          <StauntonParts type={victim.type} material={mats.hot} groove={mats.hot} />
        </group>
      </group>
      <sprite ref={flash} position={centre} visible={false} raycast={noRaycast}>
        <spriteMaterial
          map={glow}
          color={palette[1]}
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <mesh
        ref={ring}
        position={[floor[0], floor[1] + 0.05, floor[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={mats.ring}
        visible={false}
        raycast={noRaycast}
      >
        <ringGeometry args={[0.93, 1, 64]} />
      </mesh>
      <mesh ref={face} position={centre} material={mats.face} visible={false} raycast={noRaycast}>
        <ringGeometry args={[0.9, 1, 64]} />
      </mesh>
      <mesh ref={shell} position={centre} material={mats.shell} visible={false} raycast={noRaycast}>
        <sphereGeometry args={[1, 32, 20]} />
      </mesh>
      {phase !== 'heat' && (
        <>
          <Burst
            position={centre}
            colors={palette}
            count={160}
            speed={3.4}
            gravity={0}
            upward={0}
            lifeMs={1400}
            size={0.11}
          />
          <ScreenShake intensity={5} durationMs={320} />
        </>
      )}
    </>
  );
};

// --- Galaxy -------------------------------------------------------------------

const GALAXY_ARMS: Record<PieceColor, string[]> = {
  white: ['#ffc861', '#ff9a4a', '#ff6f9a', '#ffe0a0', '#7fb8ff', '#ff8a3d'],
  black: ['#7fb8ff', '#5f8dff', '#9a7bff', '#c8b8ff', '#ff7ad8', '#5fe0ff'],
};

/**
 * A spiral galaxy flung out from the mated king: stars race out along two
 * arms, flash, then settle into a slowly wheeling disc that stays for the
 * result.
 */
export const Galaxy = ({
  floor,
  winner,
  viewDirection,
}: {
  floor: Vec3;
  winner: PieceColor | null;
  viewDirection: Vec3;
}) => {
  const { geometry, material } = useMemo(() => {
    const count = 1400;
    const random = rng(71);
    const radius = new Float32Array(count);
    const theta = new Float32Array(count);
    const height = new Float32Array(count);
    const scale = new Float32Array(count);
    const seed = new Float32Array(count);
    const col = new Float32Array(count * 3);
    const c = new Color();
    const arms = GALAXY_ARMS[winner ?? 'white'];
    const gauss = () => (random() + random() + random() - 1.5) / 1.5;
    for (let i = 0; i < count; i++) {
      const bulge = i < count * 0.22;
      const r = bulge ? random() ** 2 * 0.22 : 0.08 + random() ** 0.8 * 0.92;
      const arm = i % 2;
      const th = bulge
        ? random() * Math.PI * 2
        : arm * Math.PI + r * 4.6 + gauss() * (0.5 * (1 - r) + 0.18);
      radius[i] = r;
      theta[i] = th;
      height[i] = gauss() * (bulge ? 0.18 : 0.05);
      scale[i] = bulge ? 0.6 + random() * 1.1 : 0.35 + random() ** 3 * 1.6;
      seed[i] = random();
      c.set(
        bulge ? (random() < 0.5 ? '#fff4dc' : '#ffe3a6') : arms[Math.floor(random() * arms.length)],
      );
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geometry = new BufferGeometry();
    // Positions are computed in the shader; three still needs the attribute
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aR', new BufferAttribute(radius, 1));
    geometry.setAttribute('aTheta', new BufferAttribute(theta, 1));
    geometry.setAttribute('aH', new BufferAttribute(height, 1));
    geometry.setAttribute('aScale', new BufferAttribute(scale, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uT: { value: -0.35 },
        uRadius: { value: 2.1 },
        uSize: { value: 0.075 },
        uScale: pixelScale,
        uMap: { value: glow },
      },
      vertexShader: /* glsl */ `
        uniform float uT; uniform float uRadius; uniform float uSize; uniform float uScale;
        attribute float aR; attribute float aTheta; attribute float aH; attribute float aScale; attribute float aSeed;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = color;
          float t = max(uT, 0.0);
          // Flung out from the core, overshooting a little, then settling
          float grow = 1.0 - exp(-t * 2.6) * cos(t * 2.0);
          float r = aR * uRadius * grow;
          // Differential rotation: the inner disc wheels faster
          float ang = aTheta - t * 0.35 / (0.3 + aR) - (1.0 - exp(-t * 2.0)) * 1.2;
          vec3 p = vec3(cos(ang) * r, aH * uRadius * grow, sin(ang) * r);
          float intro = smoothstep(0.0, 0.25, t);
          float twinkle = 0.7 + 0.3 * sin(t * (2.0 + aSeed * 3.0) + aSeed * 50.0);
          vAlpha = uT < 0.0 ? 0.0 : intro * (0.4 + 0.55 * exp(-t * 1.1)) * twinkle;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * aScale * (1.0 + 0.8 * exp(-t * 1.5)) * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * 1.25, t.a * vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    return { geometry, material };
  }, [winner]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // Tip the disc toward the viewer, halfway between flat and face-on.
  const tilt = useMemo(() => {
    const n = new Vector3(...viewDirection)
      .normalize()
      .add(new Vector3(0, 1.1, 0))
      .normalize();
    return new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), n);
  }, [viewDirection]);

  const core = useRef<Sprite>(null);
  const camera = useThree((s) => s.camera);
  const [fx, fy, fz] = floor;
  const away = useMemo(() => new Vector3(), []);
  useFrame((_, delta) => {
    const t = (material.uniforms.uT.value += Math.min(delta, MAX_FRAME));
    const c = core.current;
    if (c) {
      const k = Math.max(t, 0);
      // The core glows just behind the fallen king, never over it
      away
        .set(fx, fy + 0.45, fz)
        .sub(camera.position)
        .normalize();
      c.position.set(fx, fy + 0.45, fz).addScaledVector(away, 0.8);
      c.scale.setScalar(0.9 + 1.6 * Math.exp(-k * 1.6) + 0.08 * Math.sin(k * 2.2));
      (c.material as SpriteMaterial).opacity = t < 0 ? 0 : 0.3 + 0.5 * Math.exp(-k);
    }
  });

  const centre: Vec3 = [floor[0], floor[1] + 0.45, floor[2]];
  const colors = GALAXY_ARMS[winner ?? 'white'];
  return (
    <>
      <group position={centre} quaternion={tilt}>
        <points geometry={geometry} material={material} raycast={noRaycast} frustumCulled={false} />
      </group>
      <sprite ref={core} raycast={noRaycast}>
        <spriteMaterial
          map={glow}
          color={colors[0]}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <Burst
        position={centre}
        colors={['#ffffff', ...colors]}
        count={220}
        speed={4.2}
        gravity={0}
        upward={0}
        lifeMs={2200}
        size={0.12}
        delayMs={350}
      />
    </>
  );
};
