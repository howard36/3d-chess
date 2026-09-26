import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import type { Vec3 } from '../types';

// Hologram effects: projector beams, glitch shards, data links and floating
// readouts, all timed on r3f's clock so a frame-stepped recording plays them
// the same every time.

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

/** Seconds since mount on the frame clock, and whether `lifeMs` has run out. */
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

const beamGeometry = new CylinderGeometry(1, 1, 1, 40, 1, true);

/**
 * A column of projector light over a cell, with bright scan rings running
 * down it (`dir` -1, dematerialising) or up it (`dir` 1, materialising).
 */
export const ScanBeam = ({
  floor,
  color,
  dir,
  lifeMs,
  radius = 0.36,
  height = 1.5,
}: {
  floor: Vec3;
  color: string;
  dir: 1 | -1;
  lifeMs: number;
  radius?: number;
  height?: number;
}) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
        uniforms: {
          uColor: { value: new Color(color).multiplyScalar(1.1) },
          uK: { value: 0 },
          uDir: { value: dir },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uK; uniform float uDir; varying vec2 vUv;
          void main() {
            float env = sin(3.14159 * uK);
            float y = vUv.y;
            float fall = pow(1.0 - y, 1.3);
            float head = uDir > 0.0 ? uK * 1.2 : 1.0 - uK * 1.2;
            float sweep = exp(-abs(y - head) * 18.0);
            float rings = pow(0.5 + 0.5 * sin((y - uK * uDir) * 60.0), 8.0);
            float a = env * (fall * 0.22 + rings * 0.2 * fall + sweep * 0.55);
            gl_FragColor = vec4(uColor * (1.0 + 0.5 * sweep), a);
          }`,
      }),
    [color, dir],
  );
  useEffect(() => () => material.dispose(), [material]);
  const { t, done } = useLife(lifeMs);
  useFrame(() => {
    material.uniforms.uK.value = Math.min((t.current * 1000) / lifeMs, 1);
  });
  if (done) return null;
  return (
    <mesh
      geometry={beamGeometry}
      material={material}
      position={[floor[0], floor[1] + height / 2, floor[2]]}
      scale={[radius, height, radius]}
      raycast={noRaycast}
    />
  );
};

/** A flat ring of light racing outward across a board and fading. */
export const Shockwave = ({
  position,
  color,
  radius = 1.2,
  lifeMs = 500,
  width = 0.05,
}: {
  position: Vec3;
  color: string;
  radius?: number;
  lifeMs?: number;
  width?: number;
}) => {
  const mesh = useRef<Mesh>(null);
  const geometry = useMemo(() => new RingGeometry(1 - width, 1, 64), [width]);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(color).multiplyScalar(1.8),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        side: DoubleSide,
      }),
    [color],
  );
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );
  const { t, done } = useLife(lifeMs);
  useFrame(() => {
    const k = Math.min((t.current * 1000) / lifeMs, 1);
    mesh.current?.scale.setScalar(0.12 + (1 - (1 - k) ** 3) * radius);
    material.opacity = (1 - k) ** 1.4;
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
      geometry={geometry}
      material={material}
      raycast={noRaycast}
    />
  );
};

const UP = new Vector3(0, 1, 0);
const linkGeometry = new CylinderGeometry(0.018, 0.018, 1, 6, 1, true);

/** A data link: a line of light flickering from one point to another. */
export const DataLink = ({
  from,
  to,
  color,
  lifeMs,
}: {
  from: Vec3;
  to: Vec3;
  color: string;
  lifeMs: number;
}) => {
  const { mid, len, quat } = useMemo(() => {
    const a = new Vector3(...from);
    const d = new Vector3(...to).sub(a);
    return {
      mid: a.addScaledVector(d, 0.5).toArray() as Vec3,
      len: d.length(),
      quat: new Quaternion().setFromUnitVectors(UP, d.clone().normalize()),
    };
  }, [from, to]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uColor: { value: new Color(color).multiplyScalar(1.8) },
          uK: { value: 0 },
          uLen: { value: len },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uK; uniform float uLen; varying vec2 vUv;
          void main() {
            float packet = exp(-abs(vUv.y - uK) * 6.0);
            float dash = step(0.5, fract(vUv.y * uLen * 4.0 - uK * 6.0));
            float a = (0.25 * dash + packet) * sin(3.14159 * uK);
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    [color, len],
  );
  useEffect(() => () => material.dispose(), [material]);
  const { t, done } = useLife(lifeMs);
  useFrame(() => {
    material.uniforms.uK.value = Math.min((t.current * 1000) / lifeMs, 1);
  });
  if (done) return null;
  return (
    <mesh
      geometry={linkGeometry}
      material={material}
      position={mid}
      quaternion={quat}
      scale={[1, len, 1]}
      raycast={noRaycast}
    />
  );
};

/** A floating holographic readout (a word drawn in the HUD font) that flickers in. */
export const HoloText = ({
  text,
  position,
  color,
  width = 3.2,
  lifeMs = 4000,
  font = '700 110px "Rajdhani", sans-serif',
}: {
  text: string;
  position: Vec3;
  color: string;
  width?: number;
  lifeMs?: number;
  font?: string;
}) => {
  const sprite = useRef<Sprite>(null);
  // Draw once the font is ready: a canvas drawn before then keeps a fallback face
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setFontReady(true);
    document.fonts.load(font).then(done, done);
    return () => {
      live = false;
    };
  }, [font]);
  const material = useMemo(() => {
    if (!fontReady) return null;
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 192;
    const ctx = c.getContext('2d')!;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = color;
    const spaced = text.split('').join(' ');
    ctx.fillText(spaced, 512, 100);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.55;
    ctx.fillText(spaced, 512, 100);
    // Bracket ticks either side
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillRect(40, 30, 6, 132);
    ctx.fillRect(40, 30, 30, 6);
    ctx.fillRect(40, 156, 30, 6);
    ctx.fillRect(978, 30, 6, 132);
    ctx.fillRect(954, 30, 30, 6);
    ctx.fillRect(954, 156, 30, 6);
    // Scanlines
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.35;
    for (let y = 0; y < 192; y += 4) ctx.fillRect(0, y, 1024, 1);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    return new SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
  }, [text, color, font, fontReady]);
  useEffect(
    () => () => {
      material?.map?.dispose();
      material?.dispose();
    },
    [material],
  );
  const { t, done } = useLife(lifeMs);
  useFrame(() => {
    if (!material) return;
    const s = t.current;
    const k = (s * 1000) / lifeMs;
    const on = s > 0.5 || Math.sin(s * 70) > 0.1;
    material.opacity = on ? Math.min(1, s * 3) * (k > 0.85 ? (1 - k) / 0.15 : 1) : 0.15;
    const sp = sprite.current;
    if (sp) {
      const pop = 1 + 0.3 * Math.exp(-s * 8);
      sp.scale.set(width * pop, (width * 192 * pop) / 1024 / (s < 0.15 ? 3 : 1), 1);
      sp.position.set(position[0], position[1] + Math.min(s, 1) * 0.25, position[2]);
    }
  });
  if (done || !material) return null;
  return <sprite ref={sprite} material={material} raycast={noRaycast} renderOrder={10} />;
};
