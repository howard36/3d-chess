import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  DodecahedronGeometry,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
} from 'three';
import type { Group, InstancedMesh } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { Burst } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { BRASS, SPOT } from './palette';
import { makeStone } from './stone';

// Motion with a little weight, all on r3f's clock and all short:
// - a move lands with a ring of warm light spreading over the glass and a
//   puff of dust from under its foot;
// - a captured piece cracks as the attacker arrives and falls apart into
//   stone chips that skitter across the glass and a cloud of stone dust;
// - at mate, the fallen king's square sends out slow rings of brass light
//   and a shower of gold dust rises and settles.

const MAX = 1 / 20;
const ringGeometry = new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);

/** A ring of light spreading from a point on the glass, then gone. */
const Ripple = ({
  at,
  color,
  from = 0.2,
  to = 0.62,
  ms = 520,
  delayMs = 0,
  opacity = 0.7,
}: {
  at: Vec3;
  color: string;
  from?: number;
  to?: number;
  ms?: number;
  delayMs?: number;
  opacity?: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(-delayMs);
  const mesh = useRef<import('three').Mesh>(null);
  const [done, setDone] = useState(false);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX) * 1000;
    const t = elapsed.current / ms;
    const m = mesh.current;
    if (m) {
      const k = Math.max(0, Math.min(t, 1));
      const e = 1 - (1 - k) ** 3;
      m.scale.setScalar(from + (to - from) * e);
      material.opacity = t < 0 ? 0 : opacity * (1 - k) ** 1.5;
    }
    if (t >= 1) setDone(true);
    else invalidate();
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      geometry={ringGeometry}
      material={material}
      position={[at[0], at[1] + 0.014, at[2]]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
    />
  );
};

export const makeFx = (floorY: number, pieceScale: number) => {
  const floorOf = (p: Vec3): Vec3 => [p[0], p[1] + floorY, p[2]];

  /** A landing: a ring of warm light over the glass and a small puff of dust. */
  const MoveFx = ({ to, durationMs }: MoveFxProps) => {
    const at = floorOf(to);
    return (
      <>
        <Ripple at={at} color={SPOT} delayMs={durationMs * 0.92} opacity={0.55} />
        <Burst
          position={[at[0], at[1] + 0.03, at[2]]}
          colors={['#d9d2c3', '#bfb7a8']}
          count={14}
          speed={0.9}
          gravity={0.6}
          lifeMs={560}
          size={0.035}
          additive={false}
          upward={0.15}
          delayMs={durationMs * 0.9}
          seed={7}
        />
      </>
    );
  };

  // Stone chips: a few irregular solids, lit by the scene, coloured per army
  const chip = new DodecahedronGeometry(0.05, 0).scale(1, 0.7, 1.2);
  const chipMaterial = new MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
  const CHIPS = 16;

  /** Chips thrown from the victim's body that fall to the glass, skitter and settle away. */
  const Rubble = ({ at, colors, delayMs }: { at: Vec3; colors: string[]; delayMs: number }) => {
    const invalidate = useThree((s) => s.invalidate);
    const mesh = useRef<InstancedMesh>(null);
    const elapsed = useRef(-delayMs / 1000);
    const [done, setDone] = useState(false);
    const parts = useMemo(() => {
      const random = rng(23);
      return Array.from({ length: CHIPS }, () => {
        const a = random() * Math.PI * 2;
        const v = 0.7 + random() * 0.9;
        return {
          p: [(random() - 0.5) * 0.18, 0.08 + random() * 0.45, (random() - 0.5) * 0.18],
          v: [Math.cos(a) * v, 0.6 + random() * 1.2, Math.sin(a) * v],
          axis: [random() - 0.5, random() - 0.5, random() - 0.5],
          spin: 6 + random() * 8,
          scale: 0.6 + random() * 0.8,
        };
      });
    }, []);
    useLayoutEffect(() => {
      const m = mesh.current;
      if (!m) return;
      const c = new Color();
      parts.forEach((_, i) => m.setColorAt(i, c.set(colors[i % colors.length])));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }, [parts, colors]);
    const dummy = useMemo(() => new Object3D(), []);
    const LIFE = 0.95;
    useFrame((_, delta) => {
      const m = mesh.current;
      if (done || !m) return;
      elapsed.current += Math.min(delta, MAX);
      const t = elapsed.current;
      parts.forEach((part, i) => {
        const tt = Math.max(t, 0);
        // Thrown out, falling to the glass, then sliding to a stop on it
        const drag = (1 - Math.exp(-3 * tt)) / 3;
        let y = part.p[1] + part.v[1] * tt - 4.9 * 1.4 * tt * tt;
        const landed = y <= 0.02;
        y = Math.max(y, 0.02);
        dummy.position.set(part.p[0] + part.v[0] * drag, y, part.p[2] + part.v[2] * drag);
        const spinT = landed ? Math.min(tt, 0.35) : tt;
        dummy.rotation.set(
          part.axis[0] * part.spin * spinT,
          part.axis[1] * part.spin * spinT,
          part.axis[2] * part.spin * spinT,
        );
        const fade = Math.min(Math.max((tt - LIFE * 0.6) / (LIFE * 0.4), 0), 1);
        dummy.scale.setScalar(t < 0 ? 0 : part.scale * (1 - fade));
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      if (t >= LIFE) setDone(true);
      else invalidate();
    });
    if (done) return null;
    return (
      <instancedMesh
        ref={mesh}
        args={[chip, chipMaterial, CHIPS]}
        position={at}
        frustumCulled={false}
        raycast={noRaycast}
      />
    );
  };

  /**
   * The captured piece stands until the attacker reaches it, cracks (a
   * shiver and a flash of its rim), and is gone in a spray of chips and dust.
   */
  const CaptureFx = ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => {
    const invalidate = useThree((s) => s.invalidate);
    const group = useRef<Group>(null);
    const elapsed = useRef(0);
    const impact = durationMs * 0.78;
    const white = victim.color === 'white';
    const mats = useMemo(
      () => ({
        body: makeStone(white ? 'marble' : 'basalt', { transparent: true }),
        accent: makeStone(white ? 'bardiglio' : 'graphite', { transparent: true }),
      }),
      [white],
    );
    useEffect(
      () => () => {
        mats.body.dispose();
        mats.accent.dispose();
      },
      [mats],
    );
    const [gone, setGone] = useState(false);
    useFrame((_, delta) => {
      if (gone) return;
      elapsed.current += Math.min(delta, MAX) * 1000;
      const t = elapsed.current;
      const g = group.current;
      const k = Math.max(0, (t - impact) / 160);
      const fade = Math.max(0, 1 - k);
      for (const m of [mats.body, mats.accent]) m.userData.stone.uFade.value = fade;
      if (g) {
        // A shiver as it cracks
        const shake = t > impact - 60 && k < 1 ? Math.sin(t * 0.9) * 0.012 : 0;
        g.position.set(floor[0] + shake, floor[1], floor[2]);
        g.scale.setScalar(pieceScale * (1 + 0.05 * Math.min(k, 1)));
      }
      if (k >= 1) setGone(true);
      else invalidate();
    });
    const chipColors = white
      ? ['#ece6dc', '#d9d4ca', '#a9adb4']
      : ['#35373b', '#4a4d52', '#26282b'];
    return (
      <>
        {!gone && (
          <group ref={group} position={floor} scale={pieceScale}>
            <group rotation={[0, victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0, 0]}>
              <ChessPiece type={victim.type} parts={{ body: mats.body, accent: mats.accent }} />
            </group>
          </group>
        )}
        <Rubble at={floor} colors={chipColors} delayMs={impact} />
        <Burst
          position={[floor[0], floor[1] + 0.25, floor[2]]}
          colors={white ? ['#e8e2d6', '#cfc8ba'] : ['#6b6d72', '#4d4f54']}
          count={36}
          speed={0.8}
          gravity={-0.25}
          lifeMs={900}
          size={0.07}
          additive={false}
          upward={0.4}
          delayMs={impact}
          seed={13}
        />
      </>
    );
  };

  /** Mate: slow rings of brass light from the fallen king, and gold dust rising once. */
  const Celebration = ({ floor }: CelebrationProps) => (
    <>
      {[0, 1, 2].map((i) => (
        <Ripple
          key={i}
          at={floor}
          color={BRASS}
          from={0.3}
          to={2.4}
          ms={1500}
          delayMs={500 + i * 420}
          opacity={0.6}
        />
      ))}
      <Burst
        position={[floor[0], floor[1] + 0.2, floor[2]]}
        colors={[BRASS, '#fff0c8', '#f2cf85']}
        count={70}
        speed={1.1}
        gravity={-0.35}
        lifeMs={2600}
        size={0.05}
        upward={0.85}
        delayMs={450}
        seed={29}
      />
    </>
  );

  return { MoveFx, CaptureFx, Celebration };
};
