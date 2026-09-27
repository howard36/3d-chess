import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
} from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { Burst } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, PieceColor, Vec3 } from '../types';
import { MAX_FRAME, Mark, ripple } from './markers';
import { CHECK, LACQUER, LANTERN, LANTERN_LIGHT, SELECT } from './palette';
import { woodMaterial } from './pieces';
import type { WoodUniforms } from './pieces';

// Lantern's moments of motion, short and quiet. A piece glides and, as it
// touches the paper, two ripples roll out from it, as from a stone set in
// still water. A captured piece catches like paper in a lantern: it glows
// from its foot, burns away and its embers drift up. A mate strikes the
// temple bell: three red rings roll across the platform, and a flight of
// small sky lanterns rises from the fallen king and drifts off.

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
    const burnt = -0.08 + 1.05 * k ** 1.6;
    for (const m of [materials.body, materials.accent]) {
      const u = m.userData.uniforms as WoodUniforms;
      u.uBurn.value = burnt;
      u.uGlow.value = 0.6 * Math.min(k * 4, 1);
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
          colors={[LANTERN_LIGHT, SELECT, '#ff8a4c', '#ffe3b0']}
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

// --- Mate: the bell, and sky lanterns ---------------------------------------------------------

const SKY_LANTERNS = 18;
const FLIGHT_MS = 3600;

/** Small paper lanterns rising from the king's square, swaying, fading into the dusk. */
const SkyLanterns = ({ floor }: { floor: Vec3 }) => {
  const mesh = useRef<InstancedMesh>(null);
  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const { lantern, material, flights, halo, haloMaterial } = useMemo(() => {
    const random = rng(53);
    const flights = Array.from({ length: SKY_LANTERNS }, () => ({
      angle: random() * Math.PI * 2,
      spread: 0.2 + random() * 0.9,
      rise: 2.2 + random() * 2.2,
      delay: random() * 900,
      sway: random() * Math.PI * 2,
      size: 0.8 + random() * 0.5,
    }));
    const lantern = new CylinderGeometry(0.045, 0.035, 0.09, 8);
    const material = new MeshBasicMaterial({
      color: new Color(LANTERN_LIGHT),
      transparent: true,
      toneMapped: false,
    });
    const halo = new BufferGeometry();
    halo.setAttribute('position', new BufferAttribute(new Float32Array(SKY_LANTERNS * 3), 3));
    const haloMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uMap: { value: dotTexture(0.9) },
        uColor: { value: new Color(LANTERN_LIGHT) },
        uAlpha: { value: 1 },
      },
      vertexShader: /* glsl */ `
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 260.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        uniform float uAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * uAlpha * 0.35;
          gl_FragColor = vec4(uColor * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    return { lantern, material, flights, halo, haloMaterial };
  }, []);
  useEffect(
    () => () => {
      lantern.dispose();
      material.dispose();
      halo.dispose();
      haloMaterial.dispose();
    },
    [lantern, material, halo, haloMaterial],
  );
  const o = useMemo(() => new Object3D(), []);
  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    elapsed.current += Math.min(delta, MAX_FRAME) * 1000;
    const pos = halo.getAttribute('position') as BufferAttribute;
    flights.forEach((f, i) => {
      const t = Math.max(elapsed.current - f.delay, 0) / 1000;
      const up = f.rise * (1 - Math.exp(-t * 0.45)) + t * 0.12;
      const r = f.spread * (0.4 + 0.6 * Math.min(t / 2, 1));
      const x = floor[0] + Math.cos(f.angle) * r + Math.sin(t * 1.3 + f.sway) * 0.08;
      const z = floor[2] + Math.sin(f.angle) * r + Math.cos(t * 1.1 + f.sway) * 0.08;
      const y = floor[1] + 0.3 + up;
      const shown = elapsed.current > f.delay ? f.size : 1e-4;
      o.position.set(x, y, z);
      o.scale.setScalar(shown);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      pos.setXYZ(i, x, y, z);
    });
    m.instanceMatrix.needsUpdate = true;
    pos.needsUpdate = true;
    const k = Math.min(elapsed.current / FLIGHT_MS, 1);
    const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    material.opacity = fade;
    haloMaterial.uniforms.uAlpha.value = fade;
    if (k < 1) invalidate();
  });
  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[lantern, material, SKY_LANTERNS]}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <points geometry={halo} material={haloMaterial} raycast={noRaycast} frustumCulled={false} />
    </>
  );
};

export const makeCelebration =
  (clip: number) =>
  ({ floor }: CelebrationProps) => {
    const done = useDone(FLIGHT_MS + 1200);
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
        {!done && <SkyLanterns floor={floor} />}
      </>
    );
  };
