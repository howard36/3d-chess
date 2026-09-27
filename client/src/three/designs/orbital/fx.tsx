import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  Vector3,
} from 'three';
import type { Group, Mesh, MeshStandardMaterial, ShaderMaterial } from 'three';
import { ChessPiece } from '../../pieces';
import { PieceType } from '../../../engine/pieces';
import { Burst } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout, CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { LightRing } from './markers';
import type { LightRingStyle } from './markers';
import { CAPTURE, DOCK, TRAIL } from './palette';
import { freshSkin, footFor } from './pieces';

// Orbital's moments of motion, short and clean, on r3f's clock:
//
// - a move docks: as the piece arrives, a ring of violet lights opens out
//   round its base and fades (the last-move line has drawn in behind it);
// - a capture is a scan: a red plane of light sweeps down through the
//   victim, erasing it as it goes, and flashes on the glass as it lands;
// - a mate: the king topples and three rings of light sweep out across its
//   deck.

const MAX_FRAME = 1 / 30;

/** Runs `onFrame(ms since mount)` every frame until it returns false, then unmounts. */
const useTimeline = (onFrame: (ms: number) => boolean) => {
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const elapsed = useRef(0);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME) * 1000;
    if (onFrame(elapsed.current)) invalidate();
    else setDone(true);
  });
  return done;
};

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A ring of lights that opens out from `from` to `to` radius and fades, after `delayMs`. */
const OpeningRing = ({
  floor,
  from,
  to,
  ms,
  delayMs = 0,
  ...style
}: Omit<LightRingStyle, 'radius'> & {
  floor: Vec3;
  from: number;
  to: number;
  ms: number;
  delayMs?: number;
}) => {
  const material = useRef<ShaderMaterial | null>(null);
  const opacity = style.opacity ?? 1;
  const apply = (elapsed: number) => {
    const m = material.current;
    if (!m) return;
    const t = Math.min(Math.max((elapsed - delayMs) / ms, 0), 1);
    m.uniforms.uRadius.value = from + (to - from) * easeOut(t);
    m.uniforms.uOpacity.value = elapsed < delayMs ? 0 : opacity * (1 - t) ** 1.5;
  };
  const last = useRef(0);
  const done = useTimeline((elapsed) => {
    last.current = elapsed;
    apply(elapsed);
    return elapsed < delayMs + ms;
  });
  if (done) return null;
  return (
    <LightRing
      floor={floor}
      radius={to}
      {...style}
      opacity={0}
      materialRef={(m) => {
        material.current = m;
        apply(last.current);
      }}
    />
  );
};

// --- A move docks ---------------------------------------------------------------------

export const makeMoveFx = (floorY: number) => {
  const MoveFx = ({ to, durationMs }: MoveFxProps) => {
    const floor: Vec3 = [to[0], to[1] + floorY, to[2]];
    return (
      <OpeningRing
        floor={floor}
        color={TRAIL}
        count={10}
        from={0.3}
        to={0.62}
        ms={420}
        delayMs={durationMs * 0.9}
        dot={0.022}
        halo={0.45}
        line={0.35}
      />
    );
  };
  return MoveFx;
};

// --- A capture is a scan ----------------------------------------------------------------

const glowTexture = (() => {
  let t: CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    // Grey on black: an alpha map reads the colour, not the alpha
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgb(30,30,30)');
    g.addColorStop(0.5, 'rgb(70,70,70)');
    g.addColorStop(0.68, 'rgb(200,200,200)');
    g.addColorStop(0.73, 'rgb(255,255,255)');
    g.addColorStop(0.8, 'rgb(90,90,90)');
    g.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    t = new CanvasTexture(c);
    return t;
  };
})();

const scanPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const TOP = 0.9;

export const makeCaptureFx = (layout: BoardLayout, pieceScale: number) => {
  const { levelY } = towerFrame(layout);
  const levelAt = (y: number) =>
    levelY.reduce((best, ly, z) => (Math.abs(ly - y) < Math.abs(levelY[best] - y) ? z : best), 0);

  const CaptureFx = ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => {
    const gl = useThree((s) => s.gl);
    const level = levelAt(floor[1]);
    const plane = useMemo(
      () => new Plane(new Vector3(0, -1, 0), floor[1] + TOP * pieceScale),
      [floor],
    );
    const materials = useMemo(() => {
      const clip = (m: MeshStandardMaterial) => {
        m.clippingPlanes = [plane];
        return m;
      };
      return {
        body: clip(freshSkin(victim.color, 'body', 'check')),
        collar: clip(freshSkin(victim.color, 'collar', 'check')),
        accent: clip(freshSkin(victim.color, 'accent', 'check')),
        foot: clip(footFor(level, false).clone()),
      };
    }, [plane, victim.color, level]);
    useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);
    const scanMaterial = useMemo(
      () =>
        new MeshBasicMaterial({
          color: new Color(CAPTURE).lerp(new Color('#ffffff'), 0.25),
          alphaMap: glowTexture(),
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          toneMapped: false,
          side: DoubleSide,
        }),
      [],
    );
    useEffect(() => () => scanMaterial.dispose(), [scanMaterial]);
    useEffect(() => {
      gl.localClippingEnabled = true;
    }, [gl]);

    const piece = useRef<Group>(null);
    const scan = useRef<Mesh>(null);
    const start = durationMs * 0.1;
    const sweep = durationMs * 0.85;
    const [landed, setLanded] = useState(false);
    const done = useTimeline((ms) => {
      const k = Math.min(Math.max((ms - start) / sweep, 0), 1);
      // Eased in and out: the scan settles onto the glass
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const h = TOP * (1 - e);
      plane.constant = floor[1] + h * pieceScale;
      const s = scan.current;
      if (s) {
        s.position.y = h * pieceScale;
        s.visible = k > 0 && k < 1;
        const width = 0.5 + 0.12 * Math.sin(Math.PI * k);
        s.scale.set(width, 1, width);
        scanMaterial.opacity = Math.sin(Math.PI * Math.min(k * 1.2, 1)) * 0.9 + 0.1;
      }
      if (piece.current) piece.current.visible = k < 1;
      if (k >= 1 && !landed) setLanded(true);
      return ms < start + sweep + 520;
    });
    if (done) return null;
    return (
      <group position={floor}>
        <group ref={piece} scale={pieceScale}>
          <group rotation={[0, victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0, 0]}>
            <ChessPiece type={victim.type} parts={materials} />
          </group>
        </group>
        <mesh
          ref={scan}
          geometry={scanPlane}
          material={scanMaterial}
          renderOrder={LAYER.trace + 0.7}
          raycast={noRaycast}
          visible={false}
        />
        {landed && (
          <>
            <OpeningRing
              floor={[0, 0, 0]}
              color={CAPTURE}
              count={12}
              from={0.3}
              to={0.7}
              ms={500}
              dot={0.026}
              halo={0.6}
              line={0.4}
              fill={0.08}
            />
            <Burst
              position={[0, 0.05, 0]}
              colors={[CAPTURE, '#ffd0d6', '#ffffff']}
              count={26}
              speed={1.6}
              gravity={1.2}
              lifeMs={520}
              size={0.05}
              upward={0.75}
              seed={9}
            />
          </>
        )}
      </group>
    );
  };
  return CaptureFx;
};

// --- Mate ---------------------------------------------------------------------------------

/** Three rings of light sweep out across the mated king's deck. */
export const Celebration = ({ floor, winner }: CelebrationProps) => {
  const color = winner === null ? DOCK : TRAIL;
  return (
    <>
      {[0, 1, 2].map((i) => (
        <OpeningRing
          key={i}
          floor={floor}
          color={i === 1 ? DOCK : color}
          count={16 + i * 8}
          from={0.45}
          to={2.6 + i * 0.5}
          ms={1300}
          delayMs={500 + i * 260}
          dot={0.03}
          halo={0.55}
          line={0.3}
        />
      ))}
    </>
  );
};
