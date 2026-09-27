import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { Burst } from '../kit/fx';
import { LAYER } from '../kit/layers';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, PieceColor, Vec3 } from '../types';
import { MAX_FRAME, Mark, ripple } from './markers';
import { CHECK, LACQUER, LANTERN, SELECT } from './palette';
import { mateWave } from './stage';
import { woodMaterial } from './pieces';
import type { WoodUniforms } from './pieces';

// Lantern's moments of motion, short and quiet. A piece glides and, as it
// touches the paper, two ripples roll out from it, as from a stone set in
// still water. A captured piece catches like paper in a lantern: it glows
// from its foot, burns away and its embers drift up. A mate strikes the
// temple bell: three red rings roll across the platform, a thread of embers
// rises from the fallen king, and the garden's lanterns go out, one by one.

/** Unmounts its children once `ms` of r3f time have passed. */
const useDone = (ms: number) => {
  const [done, setDone] = useState(false);
  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME) * 1000;
    if (elapsed.current > ms) setDone(true);
    else invalidate();
  });
  return done;
};

// --- Move: ripples on landing ----------------------------------------------------------

/** The landing of every move: two ripples from the piece's base, red after a capture. */
export const makeMoveFx =
  (floorY: number, clip: number) =>
  ({ to, capture, durationMs }: MoveFxProps) => {
    const land = durationMs * 0.9;
    const done = useDone(land + 1400);
    if (done) return null;
    const floor: Vec3 = [to[0], to[1] + floorY, to[2]];
    return (
      <>
        <Mark
          floor={floor}
          color={capture ? LACQUER : LANTERN}
          quad={3}
          clip={clip}
          animate={ripple(0.3, 1.3, 950, 0.045, 0.7)}
          delayMs={land}
        />
        <Mark
          floor={floor}
          color={LANTERN}
          quad={3}
          clip={clip}
          animate={ripple(0.28, 1.0, 900, 0.03, 0.45)}
          delayMs={land + 180}
        />
        {/* The paper lights up a moment under the piece as it lands */}
        <Mark
          floor={floor}
          color={capture ? LACQUER : SELECT}
          glow={[0.5, 0.7]}
          additive
          quad={1.3}
          renderOrder={LAYER.shadow + 0.5}
          lift={0.006}
          animate={(u, t) => {
            const k = Math.min(t / 520, 1);
            u.uOpacity.value = (1 - k) ** 2;
            return k < 1;
          }}
          delayMs={land}
        />
      </>
    );
  };

// --- Capture: the victim burns away like paper ---------------------------------------------

const BURN_MS = 560;

/** The captured piece, burning away from its foot up with a glowing edge, like paper. */
const Burning = ({
  type,
  color,
  facing,
  scale,
}: {
  type: CaptureFxProps['victim']['type'];
  color: PieceColor;
  facing?: number;
  scale: number;
}) => {
  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const materials = useMemo(() => {
    const make = (part: 'body' | 'accent') => {
      const m = woodMaterial(color, part, 'rest');
      (m.userData.uniforms as WoodUniforms).uGlowColor.value.set('#ff7a2e');
      (m.userData.uniforms as WoodUniforms).uBurn.value = 0;
      return m;
    };
    const body = make('body');
    // The felt burns with the wood
    return { body, accent: make('accent'), foot: body };
  }, [color]);
  useEffect(
    () => () => {
      materials.body.dispose();
      materials.accent.dispose();
    },
    [materials],
  );
  useFrame((_, delta) => {
    elapsed.current += Math.min(delta, MAX_FRAME) * 1000;
    const k = Math.min(elapsed.current / BURN_MS, 1);
    // Catches slowly, then goes quickly
    const burnt = -0.08 + 1.05 * k ** 1.3;
    for (const m of [materials.body, materials.accent]) {
      const u = m.userData.uniforms as WoodUniforms;
      u.uBurn.value = burnt;
      u.uGlow.value = 0.9 * Math.min(k * 5, 1);
    }
    if (k < 1) invalidate();
  });
  return (
    <group scale={scale} rotation={[0, facing ?? 0, 0]}>
      <ChessPiece type={type} parts={materials} />
    </group>
  );
};

export const makeCaptureFx =
  (pieceScale: number) =>
  ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => {
    const done = useDone(Math.max(durationMs, BURN_MS) + 1300);
    if (done) return null;
    const knightFacing = victim.type === PieceType.Knight ? victimFacing : undefined;
    return (
      <group position={floor}>
        <Burning type={victim.type} color={victim.color} facing={knightFacing} scale={pieceScale} />
        <Burst
          position={[0, 0.25, 0]}
          colors={[SELECT, '#ff8a4c', '#ffe3b0']}
          count={30}
          speed={0.9}
          gravity={-0.7}
          lifeMs={1200}
          size={0.07}
          upward={0.85}
          seed={23}
          delayMs={120}
        />
      </group>
    );
  };

// --- Mate: the bell, and the garden goes dark ------------------------------------------------

const EMBERS = ['#ffb347', '#ff8a4c', '#ffd9a0'];

/**
 * The mate: the temple bell is struck three times, three red rings rolling
 * out across the platform; a thin thread of embers rises from the fallen
 * king and is gone within two seconds; and one by one, in a slow wave from
 * the tower outward, every lantern in the garden goes out.
 */
export const makeCelebration =
  (clip: number) =>
  ({ floor }: CelebrationProps) => {
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
      mateWave.value = 0;
      invalidate();
      return () => {
        mateWave.value = -1;
      };
    }, [invalidate]);
    useFrame((_, delta) => {
      // Once the last lamp is out there is nothing more to animate
      if (mateWave.value < 0 || mateWave.value > 8) return;
      mateWave.value += Math.min(delta, MAX_FRAME);
      invalidate();
    });
    return (
      <>
        {[0, 1, 2].map((i) => (
          <Mark
            key={i}
            floor={floor}
            color={CHECK}
            quad={6}
            clip={clip}
            animate={ripple(0.45, 2.8, 1800, 0.06, 0.85)}
            delayMs={300 + i * 320}
          />
        ))}
        <Burst
          position={[floor[0], floor[1] + 0.2, floor[2]]}
          colors={EMBERS}
          count={16}
          speed={0.5}
          gravity={-0.5}
          lifeMs={1800}
          size={0.05}
          upward={0.95}
          seed={31}
          delayMs={500}
        />
      </>
    );
  };
