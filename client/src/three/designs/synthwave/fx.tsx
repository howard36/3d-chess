import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { easeInOutCubic } from '../../motion';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture } from '../kit/textures';
import type { Vec3 } from '../types';

// Small building blocks for the synthwave effects, all timed on r3f's clock
// (so a recorded, frame-stepped run plays them identically).

const MAX_FRAME = 1 / 30;

/** Mounts its children once `ms` have passed. */
export const Delayed = ({ ms, children }: { ms: number; children: React.ReactNode }) => {
  const [on, setOn] = useState(ms <= 0);
  const t = useRef(0);
  useFrame((_, delta) => {
    if (on) return;
    t.current += Math.min(delta, MAX_FRAME) * 1000;
    if (t.current >= ms) setOn(true);
  });
  return on ? <>{children}</> : null;
};

/** Seconds since mount, on the frame clock; unmounts children after `lifeMs`. */
export const useLife = (lifeMs: number) => {
  const t = useRef(0);
  const [done, setDone] = useState(false);
  useFrame((_, delta) => {
    if (done) return;
    t.current += Math.min(delta, MAX_FRAME);
    if (t.current * 1000 >= lifeMs) setDone(true);
  });
  return { t, done };
};

export const glowDot = dotTexture(0.75);

const Y = new Vector3(0, 1, 0);
const unitCylinder = new CylinderGeometry(1, 1, 1, 10, 1, true);

/** A streak of additive light, brighter toward its head (uv.y = 1). */
export const streakMaterial = (color: string, strength = 2.2) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      uColor: { value: new Color(color).multiplyScalar(strength) },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main() {
        float a = pow(vUv.y, 1.6) * uOpacity;
        gl_FragColor = vec4(uColor * (0.6 + 0.8 * vUv.y), a);
      }`,
  });

/**
 * A light trail that streams behind a piece sliding from `from` to `to`
 * (matching the glide's easing), then drains into the destination.
 */
export const LightTrail = ({
  from,
  to,
  color,
  durationMs,
  radius = 0.05,
}: {
  from: Vec3;
  to: Vec3;
  color: string;
  durationMs: number;
  radius?: number;
}) => {
  const mesh = useRef<Mesh>(null);
  const core = useRef<Mesh>(null);
  const { a, dir, len, quat } = useMemo(() => {
    const a = new Vector3(...from);
    const d = new Vector3(...to).sub(a);
    const len = d.length();
    const dir = d.clone().normalize();
    const quat = new Quaternion().setFromUnitVectors(Y, dir);
    return { a, dir, len, quat };
  }, [from, to]);
  const materials = useMemo(
    () => [streakMaterial(color, 1.8), streakMaterial('#ffffff', 1.4)],
    [color],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  const life = durationMs * 1.9;
  const { t, done } = useLife(life);
  const p = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const k = (t.current * 1000) / durationMs;
    const head = easeInOutCubic(Math.min(k, 1));
    const tail = easeInOutCubic(Math.min(Math.max((k - 0.25) / 1.1, 0), 1));
    const fade = 1 - Math.max(0, (t.current * 1000 - durationMs) / (life - durationMs));
    for (const [m, r] of [
      [mesh.current, radius],
      [core.current, radius * 0.35],
    ] as const) {
      if (!m) continue;
      const l = Math.max((head - tail) * len, 1e-3);
      p.copy(a).addScaledVector(dir, ((head + tail) / 2) * len);
      m.position.copy(p);
      m.scale.set(r, l, r);
    }
    materials.forEach((m) => (m.uniforms.uOpacity.value = fade));
  });
  if (done) return null;
  return (
    <>
      <mesh
        ref={mesh}
        geometry={unitCylinder}
        material={materials[0]}
        quaternion={quat}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <mesh
        ref={core}
        geometry={unitCylinder}
        material={materials[1]}
        quaternion={quat}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </>
  );
};

/** A flat ring of light that races outward across the floor and fades. */
export const Shockwave = ({
  position,
  color,
  radius = 1.2,
  lifeMs = 500,
  width = 0.06,
}: {
  position: Vec3;
  color: string;
  radius?: number;
  lifeMs?: number;
  width?: number;
}) => {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(color).multiplyScalar(2),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        side: DoubleSide,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  const { t, done } = useLife(lifeMs);
  useFrame(() => {
    const k = Math.min((t.current * 1000) / lifeMs, 1);
    const e = 1 - (1 - k) ** 3;
    mesh.current?.scale.setScalar(0.15 + e * radius);
    material.opacity = (1 - k) ** 1.5;
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      raycast={noRaycast}
    >
      <ringGeometry args={[1 - width, 1, 64]} />
    </mesh>
  );
};

/** A quick bloom of light: a sprite that flares and dies. */
export const Flash = ({
  position,
  color,
  size = 2.2,
  lifeMs = 260,
}: {
  position: Vec3;
  color: string;
  size?: number;
  lifeMs?: number;
}) => {
  const sprite = useRef<Sprite>(null);
  const material = useMemo(
    () =>
      new SpriteMaterial({
        map: glowDot,
        color: new Color(color).multiplyScalar(2.5),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  const { t, done } = useLife(lifeMs);
  useFrame(() => {
    const k = Math.min((t.current * 1000) / lifeMs, 1);
    sprite.current?.scale.setScalar(size * (0.4 + 0.6 * Math.sqrt(k)));
    material.opacity = (1 - k) ** 2;
  });
  if (done) return null;
  return <sprite ref={sprite} position={position} material={material} raycast={noRaycast} />;
};

/**
 * A firework: a spark rises from `from` to `at` trailing light, then bursts
 * (the burst itself is `children`, mounted on arrival).
 */
export const Rocket = ({
  from,
  at,
  color,
  riseMs = 520,
  children,
}: {
  from: Vec3;
  at: Vec3;
  color: string;
  riseMs?: number;
  children: React.ReactNode;
}) => {
  const group = useRef<Group>(null);
  const [burst, setBurst] = useState(false);
  const t = useRef(0);
  const material = useMemo(
    () =>
      new SpriteMaterial({
        map: glowDot,
        color: new Color(color).multiplyScalar(3),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    if (burst) return;
    t.current += Math.min(delta, MAX_FRAME);
    const k = Math.min((t.current * 1000) / riseMs, 1);
    const e = 1 - (1 - k) ** 2;
    group.current?.position.set(
      from[0] + (at[0] - from[0]) * e,
      from[1] + (at[1] - from[1]) * e,
      from[2] + (at[2] - from[2]) * e,
    );
    if (k >= 1) setBurst(true);
  });
  if (burst) return <>{children}</>;
  return (
    <group ref={group} position={from}>
      <sprite scale={0.32} material={material} raycast={noRaycast} />
      <sprite
        position={[0, -0.18, 0]}
        scale={[0.12, 0.4, 1]}
        material={material}
        raycast={noRaycast}
      />
    </group>
  );
};

/** How a banner's letters are painted: an alarm (hot white on red) or 80s chrome. */
export type BannerStyle = 'alarm' | 'chrome';

const drawBanner = (text: string, style: BannerStyle) => {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.font = 'italic 900 132px "Orbitron", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = 512;
  const y = 132;
  if (style === 'alarm') {
    // A dark warning plate with a red frame, so it reads even against the sun
    ctx.fillStyle = 'rgba(24, 0, 6, 0.94)';
    ctx.strokeStyle = '#ff2a3d';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(90, 40);
    ctx.lineTo(1000, 40);
    ctx.lineTo(934, 224);
    ctx.lineTo(24, 224);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Squeeze long words to fit
  const w = ctx.measureText(text).width;
  const squeeze = Math.min(1, (style === 'alarm' ? 800 : 940) / w);
  ctx.translate(x, y);
  ctx.scale(squeeze, 1);
  ctx.translate(-x, -y);
  ctx.lineJoin = 'round';
  // Glow, then a dark outline so it reads over anything
  ctx.shadowColor = style === 'alarm' ? '#ff1a2e' : '#ff2bd6';
  ctx.shadowBlur = 38;
  ctx.lineWidth = 22;
  ctx.strokeStyle = style === 'alarm' ? '#3a0006' : '#1a0326';
  ctx.strokeText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.lineWidth = 7;
  ctx.strokeStyle = style === 'alarm' ? '#ffc2c8' : '#ffffff';
  ctx.strokeText(text, x, y);
  const g = ctx.createLinearGradient(0, y - 60, 0, y + 60);
  if (style === 'alarm') {
    g.addColorStop(0, '#ffe8ea');
    g.addColorStop(0.45, '#ff6a78');
    g.addColorStop(0.5, '#ff2a3d');
    g.addColorStop(1, '#d80f22');
  } else {
    // Chrome: sky above a hard horizon, earth below
    g.addColorStop(0, '#dff7ff');
    g.addColorStop(0.45, '#4fb7ff');
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(0.53, '#3a0a4a');
    g.addColorStop(0.75, '#ff5ab0');
    g.addColorStop(1, '#ffd23f');
  }
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

/**
 * A word hanging in the air in the HUD font, always drawn on top: a
 * blinking CHECK warning, or a chrome CHECKMATE title that slams in.
 */
export const Banner = ({
  text,
  position,
  width,
  style,
  blink = false,
  delayMs = 0,
}: {
  text: string;
  position: Vec3;
  width: number;
  style: BannerStyle;
  blink?: boolean;
  delayMs?: number;
}) => {
  const sprite = useRef<Sprite>(null);
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setFontReady(true);
    document.fonts.load('italic 900 64px "Orbitron"').then(done, done);
    return () => {
      live = false;
    };
  }, []);
  const material = useMemo(
    () =>
      fontReady
        ? new SpriteMaterial({
            map: drawBanner(text, style),
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
        : null,
    [fontReady, text, style],
  );
  useEffect(
    () => () => {
      material?.map?.dispose();
      material?.dispose();
    },
    [material],
  );
  const t = useRef(-delayMs / 1000);
  useFrame((_, delta) => {
    t.current += Math.min(delta, MAX_FRAME);
    const s = sprite.current;
    if (!s || !material) return;
    const k = t.current;
    s.visible = k >= 0;
    if (k < 0) return;
    // Slams in oversized, settles, then breathes
    const slam = 1 + 1.4 * Math.exp(-k * 9);
    const breathe = 1 + 0.04 * Math.sin(k * 5);
    const sc = width * slam * breathe;
    s.scale.set(sc, sc / 4, 1);
    material.opacity = Math.min(1, k * 6) * (blink ? (Math.sin(k * 9) > -0.4 ? 1 : 0.35) : 1);
  });
  if (!material) return null;
  return (
    <sprite
      ref={sprite}
      position={position}
      material={material}
      raycast={noRaycast}
      renderOrder={20}
      visible={false}
    />
  );
};
