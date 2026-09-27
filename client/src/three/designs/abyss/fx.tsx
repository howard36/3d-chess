import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import type { Group } from 'three';
import { toZXY } from '../../../engine/coords';
import { PieceType } from '../../../engine/pieces';
import { GRID_SIZE } from '../../layout';
import { easeInOutCubic } from '../../motion';
import { movePoint } from '../../movePath';
import { Burst } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { Ring } from './markers';
import { CHECK, INK, LEVELS, LURE, NACRE, PLANKTON, SIGNAL } from './palette';
import { ghostMaterials } from './pieces';
import { ChessPiece } from '../../pieces';

// Abyss's moments of motion, all short and all on r3f's clock:
//
// - a move leaves a faint wake of plankton along its path, and lands with a
//   ripple spreading through the glass in its level's colour;
// - a capture: the victim's edges flare red as the capturer arrives, then it
//   dissolves upward into a swirl of red and pale sparks, with a red ripple;
// - the mate: a column of plankton light rises round the fallen king, a
//   slow ring spreads through its level, and a CHECKMATE readout docks under
//   the turn chip.

const MAX_STEP = 0.25;
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

/** Milliseconds since mount on r3f's clock, handed to `onFrame`; true once `lifeMs` has run. */
const useTimeline = (lifeMs: number, onFrame: (ms: number) => void): boolean => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const finished = useRef(false);
  const [done, setDone] = useState(false);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (finished.current) return;
    elapsed.current += Math.min(delta, MAX_STEP) * 1000;
    if (elapsed.current >= lifeMs) {
      finished.current = true;
      onFrame(lifeMs);
      setDone(true);
      return;
    }
    onFrame(elapsed.current);
    invalidate();
  });
  return done;
};

/** A ring that spreads over the glass and fades, once. */
const Ripple = ({
  at,
  color,
  delayMs = 0,
  lifeMs = 520,
  from = 0.24,
  to = 0.72,
  width = 0.03,
  opacity = 0.85,
}: {
  at: Vec3;
  color: string;
  delayMs?: number;
  lifeMs?: number;
  from?: number;
  to?: number;
  width?: number;
  opacity?: number;
}) => {
  const group = useRef<Group>(null);
  const material = useRef<ShaderMaterial | null>(null);
  const done = useTimeline(delayMs + lifeMs, (ms) => {
    const m = material.current;
    if (!m || !group.current) return;
    const k = clamp01((ms - delayMs) / lifeMs);
    group.current.visible = ms >= delayMs && k < 1;
    const e = 1 - (1 - k) ** 3;
    m.uniforms.uRadius.value = from + (to - from) * e;
    m.uniforms.uOpacity.value = opacity * (1 - k) ** 1.4;
    m.uniforms.uGlow.value = 0.5 * (1 - k) ** 1.4;
  });
  if (done) return null;
  return (
    <group ref={group} visible={false}>
      <Ring
        floor={at}
        color={color}
        radius={to}
        width={width}
        opacity={0}
        glow={0}
        glowWidth={0.05}
        lift={0.018}
        renderOrder={LAYER.trace}
        onMaterial={(m) => {
          material.current = m;
        }}
      />
    </group>
  );
};

// --- Points of light that follow a path or rise ------------------------------------

const motesVertex = /* glsl */ `
  attribute float aBorn;
  attribute float aLife;
  attribute vec3 aDrift;
  attribute float aSize;
  uniform float uMs;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    float age = (uMs - aBorn) / aLife;
    vec3 p = position + aDrift * max(age, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(aSize * uScale / -mv.z, 1.0);
    vAlpha = step(0.0, age) * smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.45, 1.0, age));
  }`;

const motesFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.15, 1.0, d)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

interface Mote {
  at: Vec3;
  born: number;
  life: number;
  drift: Vec3;
  size: number;
}

/** Glowing motes, each born at its own moment, drifting and fading; unmounts when all are gone. */
const Motes = ({ motes, color }: { motes: Mote[]; color: string }) => {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);
  const { geometry, material, end } = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(motes.flatMap((m) => m.at)), 3),
    );
    g.setAttribute('aBorn', new BufferAttribute(new Float32Array(motes.map((m) => m.born)), 1));
    g.setAttribute('aLife', new BufferAttribute(new Float32Array(motes.map((m) => m.life)), 1));
    g.setAttribute(
      'aDrift',
      new BufferAttribute(new Float32Array(motes.flatMap((m) => m.drift)), 3),
    );
    g.setAttribute('aSize', new BufferAttribute(new Float32Array(motes.map((m) => m.size)), 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: new Color(color) }, uMs: { value: 0 }, uScale: { value: 1 } },
      vertexShader: motesVertex,
      fragmentShader: motesFragment,
    });
    return { geometry: g, material, end: Math.max(...motes.map((m) => m.born + m.life)) };
  }, [motes, color]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const done = useTimeline(end, (ms) => {
    material.uniforms.uMs.value = ms;
    const fov = 'fov' in camera ? (camera.fov as number) : 36;
    material.uniforms.uScale.value = (size.height * dpr * 0.5) / Math.tan((fov * Math.PI) / 360);
  });
  if (done) return null;
  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Moves -------------------------------------------------------------------------

/** The level of a floor height, from the layout's platform heights. */
export const makeLevelAt = (levelY: number[]) => (y: number) => {
  let best = 0;
  levelY.forEach((ly, z) => {
    if (Math.abs(ly - y) < Math.abs(levelY[best] - y)) best = z;
  });
  return best;
};

export const makeMoveFx = (floorY: number, levelAt: (y: number) => number) => {
  const MoveFx = ({ from, to, durationMs, arc = 0, capture }: MoveFxProps) => {
    const a: Vec3 = [from[0], from[1] + floorY + 0.06, from[2]];
    const b: Vec3 = [to[0], to[1] + floorY + 0.06, to[2]];
    const wake = useMemo(() => {
      const random = rng(Math.round((a[0] * 7 + a[2] * 13 + b[0] * 5 + b[2] * 3) * 100));
      return Array.from({ length: 22 }, (_, i): Mote => {
        const t = (i / 22) * 0.92;
        const p = movePoint(a, b, easeInOutCubic(t), arc);
        return {
          at: [
            p[0] + (random() - 0.5) * 0.12,
            p[1] + random() * 0.1,
            p[2] + (random() - 0.5) * 0.12,
          ],
          born: t * durationMs,
          life: 520 + random() * 320,
          drift: [(random() - 0.5) * 0.08, 0.14 + random() * 0.12, (random() - 0.5) * 0.08],
          size: 0.03 + random() * 0.025,
        };
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- one wake per move
    }, []);
    const land: Vec3 = [to[0], to[1] + floorY, to[2]];
    return (
      <>
        <Motes motes={wake} color={PLANKTON} />
        {!capture && (
          <Ripple
            at={land}
            color={LEVELS[levelAt(land[1])]}
            delayMs={durationMs * 0.9}
            lifeMs={560}
            from={0.2}
            to={0.62}
          />
        )}
      </>
    );
  };
  return MoveFx;
};

// --- Captures --------------------------------------------------------------------

/** The victim flares red as the capturer arrives, then dissolves upward. */
const Victim = ({
  floor,
  victim,
  victimFacing,
  level,
  impactMs,
  pieceScale,
}: CaptureFxProps & { level: number; impactMs: number; pieceScale: number }) => {
  const group = useRef<Group>(null);
  const mats = useMemo(() => ghostMaterials(victim.color, level), [victim.color, level]);
  useEffect(() => () => mats.dispose(), [mats]);
  const fadeMs = 420;
  const red = useMemo(() => new Color(LURE), []);
  const done = useTimeline(impactMs + fadeMs, (ms) => {
    const g = group.current;
    if (!g) return;
    const flare = clamp01((ms - impactMs * 0.55) / (impactMs * 0.45));
    const k = clamp01((ms - impactMs) / fadeMs);
    const e = 1 - (1 - k) ** 2;
    g.scale.setScalar(pieceScale * (1 - 0.35 * e));
    g.position.y = floor[1] + 0.25 * e;
    mats.setOpacity(1 - e);
    // The edges flare red as the capturer arrives; the body keeps its army
    mats.setFlare(red, 1.4 * flare * (1 - k));
  });
  if (done) return null;
  return (
    <group ref={group} position={floor} scale={pieceScale}>
      <group rotation={[0, victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0, 0]}>
        <ChessPiece
          type={victim.type}
          parts={{
            body: mats.body,
            accent: victim.type === PieceType.Rook ? mats.body : mats.accent,
            foot: mats.foot,
          }}
        />
      </group>
    </group>
  );
};

export const makeCaptureFx = (pieceScale: number, levelAt: (y: number) => number) => {
  const CaptureFx = (props: CaptureFxProps) => {
    const { floor, durationMs } = props;
    const impact = durationMs * 0.62;
    const level = levelAt(floor[1]);
    return (
      <>
        <Victim {...props} level={level} impactMs={impact} pieceScale={pieceScale} />
        <Ripple at={floor} color={LURE} delayMs={impact} lifeMs={620} from={0.3} to={0.95} />
        <Burst
          position={[floor[0], floor[1] + 0.3, floor[2]]}
          colors={[LURE, LURE, PLANKTON, '#ffb199']}
          count={34}
          speed={1.1}
          gravity={-0.9}
          lifeMs={900}
          size={0.06}
          upward={0.75}
          delayMs={impact}
        />
      </>
    );
  };
  return CaptureFx;
};

// --- Mate --------------------------------------------------------------------------

const READOUT_IN_MS = 500;

/**
 * The station's log of the mate, docked under the turn chip: CHECKMATE in
 * tracked mono capitals, the mated king's square in its level's colour, a
 * keyline under it. HUD-level DOM, faded in on r3f's clock; the result card
 * arrives under it later.
 */
const MateReadout = ({ square, level }: { square: string; level: number }) => {
  const frame = useRef<HTMLDivElement>(null);
  useTimeline(READOUT_IN_MS + 600, (ms) => {
    const f = frame.current;
    if (!f) return;
    const k = clamp01((ms - READOUT_IN_MS) / 600);
    f.style.opacity = String(k);
    f.style.transform = `translate(-50%, ${(1 - k) * -8}px)`;
  });
  return (
    // Pinned to the screen (top centre, under the turn chip), not to the king
    <Html
      calculatePosition={(_, __, size) => [size.width / 2, 112]}
      zIndexRange={[400, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        ref={frame}
        aria-hidden
        style={{
          transform: 'translate(-50%, -8px)',
          opacity: 0,
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.9em',
          padding: '0.5em 1.2em 0.55em',
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
          fontWeight: 500,
          fontSize: 15,
          letterSpacing: '0.32em',
          color: INK,
          background: 'rgba(4, 18, 23, 0.72)',
          border: '1px solid rgba(191, 239, 242, 0.2)',
          borderRadius: 6,
          boxShadow: `inset 0 -1px 0 ${SIGNAL}55, 0 10px 30px rgba(0, 0, 0, 0.45)`,
          whiteSpace: 'nowrap',
        }}
      >
        <span>CHECKMATE</span>
        <span style={{ color: LEVELS[level], letterSpacing: '0.08em', fontWeight: 600 }}>
          {square}
        </span>
      </div>
    </Html>
  );
};

/**
 * The mate: a column of plankton light rising round the fallen king, a slow
 * ring through its level, and the station's log of it (MateReadout).
 */
export const makeCelebration = (levelAt: (y: number) => number, pitch: number) => {
  const Celebration = ({ floor, winner, orientation }: CelebrationProps) => {
    // Keyed on the floor's values: a re-render with an equal array keeps the column
    const [fx, fy, fz] = floor;
    const column = useMemo(() => {
      const random = rng(97);
      return Array.from({ length: 70 }, (_, i): Mote => {
        const a = random() * Math.PI * 2;
        const r = 0.25 + random() * 0.35;
        return {
          at: [fx + Math.cos(a) * r, fy + random() * 0.2, fz + Math.sin(a) * r],
          born: 250 + (i / 70) * 900,
          life: 1300 + random() * 700,
          drift: [Math.cos(a) * 0.1, 1.2 + random() * 0.9, Math.sin(a) * 0.1],
          size: 0.035 + random() * 0.035,
        };
      });
    }, [fx, fy, fz]);
    const tint = winner === 'black' ? '#b6e9ff' : winner === 'white' ? NACRE : PLANKTON;
    // The king's square, back from the tower's world position (Black's view
    // walks round the tower: files and ranks flip)
    const level = levelAt(fy);
    const half = (GRID_SIZE - 1) / 2;
    const x = Math.round(fx / pitch + half);
    const y = Math.round(half - fz / pitch);
    const square = toZXY(
      orientation === 'white' ? { x, y, z: level } : { x: 4 - x, y: 4 - y, z: level },
    );
    return (
      <>
        <Motes motes={column} color={tint} />
        <Ripple
          at={floor}
          color={CHECK}
          delayMs={150}
          lifeMs={1300}
          from={0.35}
          to={2.4}
          width={0.04}
        />
        <Ripple
          at={floor}
          color={tint}
          delayMs={650}
          lifeMs={1500}
          from={0.35}
          to={2.9}
          width={0.03}
        />
        <MateReadout square={square} level={level} />
      </>
    );
  };
  return Celebration;
};
