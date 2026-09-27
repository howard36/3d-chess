import '@fontsource/jost/700.css';
import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Html } from '@react-three/drei';
import {
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import type { Group, Mesh, ShaderMaterial } from 'three';
import { ScreenShake, Shards } from '../kit/fx';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { PieceType } from '../../../engine/pieces';
import { layout, levelAt } from './layout';
import { Mark } from './markers';
import { clamp01, easeOutBack, easeOutCubic, useTimeline } from './motion';
import { COBALT, INK, PAPER_LIGHT, SIGNAL, VERMILION } from './palette';
import { KonturPiece } from './pieces';

// Kontur's moments of motion, all short and all on r3f's clock:
//
// - every move lands with an ink ring stamped round the piece (the piece
//   itself bounces in with a squash, and the last-move square stamps down);
// - a capture: the victim swells and pops into flat confetti of circles,
//   triangles and squares in the primaries, a vermilion ring spreads under
//   the capturer and the view gives a small knock;
// - the mate: the king topples, rings spread, confetti rains, and a
//   SCHACHMATT band is slapped across the screen like a poster strip.

/** Mounts its children once `delayMs` has passed on r3f's clock. */
const After = ({ delayMs, children }: { delayMs: number; children: ReactNode }) => {
  const open = useTimeline(delayMs, () => {});
  return open ? <>{children}</> : null;
};

/** A ring stamped on the floor that spreads and fades, once. */
const RingStamp = ({
  at,
  color,
  delayMs = 0,
  lifeMs = 360,
  from = 0.8,
  to = 1.7,
  line = 0.045,
  opacity = 0.95,
}: {
  at: Vec3;
  color: string;
  delayMs?: number;
  lifeMs?: number;
  from?: number;
  to?: number;
  line?: number;
  opacity?: number;
}) => {
  const group = useRef<Group>(null);
  const done = useTimeline(delayMs + lifeMs, (t) => {
    const g = group.current;
    if (!g) return;
    const k = clamp01((t * 1000 - delayMs) / lifeMs);
    g.visible = t * 1000 >= delayMs && k < 1;
    const s = from + (to - from) * easeOutCubic(k);
    g.scale.set(s, 1, s);
    const mesh = g.children[0] as Mesh | undefined;
    if (mesh) (mesh.material as ShaderMaterial).uniforms.uOpacity.value = opacity * (1 - k) ** 1.6;
  });
  if (done) return null;
  return (
    <group ref={group} position={at} visible={false}>
      <Mark shape="ring" color={color} radius={0.34} line={line / from} opacity={opacity} />
    </group>
  );
};

const floorOf = (centre: Vec3): Vec3 => [centre[0], centre[1] + layout.floorY, centre[2]];

export const MoveFx = ({ to, durationMs, capture }: MoveFxProps) =>
  capture ? null : <RingStamp at={floorOf(to)} color={INK} delayMs={durationMs * 0.92} />;

// --- Confetti -----------------------------------------------------------------------

const triangle = (() => {
  const g = new BufferGeometry();
  const r = 0.07;
  const pts = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    return [Math.cos(a) * r, Math.sin(a) * r, 0];
  });
  g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3));
  g.computeVertexNormals();
  return g;
})();

const SHAPES = [new CircleGeometry(0.05, 16), triangle, new PlaneGeometry(0.085, 0.085)];
const confettiMaterial = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
const CONFETTI = [VERMILION, SIGNAL, COBALT, INK, VERMILION, SIGNAL, COBALT, PAPER_LIGHT];

const Confetti = ({
  at,
  count,
  delayMs = 0,
  speed = 2.8,
  gravity = 7,
  lifeMs = 750,
  scale = 1.3,
  upward = 0.55,
  flutter = false,
  spread = 0.15,
}: {
  at: Vec3;
  count: number;
  delayMs?: number;
  speed?: number;
  gravity?: number;
  lifeMs?: number;
  scale?: number;
  upward?: number;
  flutter?: boolean;
  spread?: number;
}) => (
  <>
    {SHAPES.map((geometry, i) => (
      <Shards
        key={i}
        position={at}
        geometry={geometry}
        material={confettiMaterial}
        colors={CONFETTI.slice(i).concat(CONFETTI.slice(0, i))}
        count={count}
        scale={scale}
        speed={speed}
        gravity={gravity}
        lifeMs={lifeMs}
        upward={upward}
        spin={9}
        flutter={flutter}
        spread={spread}
        seed={11 + i * 17}
        delayMs={delayMs}
      />
    ))}
  </>
);

// --- Capture ---------------------------------------------------------------------------

/** The captured piece stands its ground under the arriving capturer, then pops. */
const Popped = ({
  floor,
  victim,
  victimFacing,
  impactMs,
}: CaptureFxProps & { impactMs: number }) => {
  const group = useRef<Group>(null);
  const done = useTimeline(impactMs + 170, (t) => {
    const g = group.current;
    if (!g) return;
    const k = clamp01((t * 1000 - impactMs) / 170);
    // Swell, then snap to nothing
    const s = k < 0.4 ? 1 + 0.28 * (k / 0.4) : 1.28 * (1 - (k - 0.4) / 0.6) ** 2;
    g.scale.setScalar(Math.max(s, 1e-4));
  });
  if (done) return null;
  return (
    <group ref={group} position={floor}>
      {/* Turned as Board turned it (a knight faces along the ranks), on its level's foot */}
      <group rotation={[0, victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0, 0]}>
        <KonturPiece type={victim.type} color={victim.color} level={levelAt(floor[1])} decor />
      </group>
    </group>
  );
};

export const CaptureFx = (props: CaptureFxProps) => {
  const { floor, durationMs } = props;
  // The victim pops as the capturer comes down on it
  const impact = durationMs * 0.62;
  return (
    <>
      <Popped {...props} impactMs={impact} />
      <Confetti
        at={[floor[0], floor[1] + 0.35, floor[2]]}
        count={9}
        delayMs={impact + 40}
        scale={2.1}
      />
      <RingStamp at={floor} color={VERMILION} delayMs={impact} to={2.1} line={0.06} />
      <After delayMs={impact + 30}>
        <ScreenShake intensity={3} durationMs={220} />
      </After>
    </>
  );
};

// --- Mate ------------------------------------------------------------------------------

const BAND_SIZE = 'clamp(28px, 5.6vw, 80px)';

const bandStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: '52%',
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  pointerEvents: 'none',
  fontFamily: "'Jost', 'Futura', sans-serif",
  fontSize: BAND_SIZE,
};

// When the strip docks: after it has had its moment, and before the result
// card arrives (GameScreen shows it 1.8 s after a live mate)
const DOCK_AT = 1000;
const DOCK_MS = 320;

/**
 * The poster strip: an ink band wiped across the screen, SCHACHMATT reversed
 * out of it in paper, the three Bauhaus shapes stamped at its head and the
 * winner under it. Then it docks, smaller, in the top of the screen and
 * drops the winner tag, so the result card lands under it rather than on
 * it and nothing is said twice. HUD-level DOM, animated on r3f's clock.
 */
const Banner = ({ winner, delayMs }: { winner: CelebrationProps['winner']; delayMs: number }) => {
  const frame = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLDivElement>(null);
  const shapes = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  useTimeline(delayMs + DOCK_AT + DOCK_MS, (t) => {
    const ms = t * 1000 - delayMs;
    const b = band.current;
    if (!b) return;
    b.style.visibility = ms >= 0 ? 'visible' : 'hidden';
    const wipe = easeOutCubic(clamp01(ms / 220));
    b.style.transform = `rotate(-4deg) scaleX(${Math.max(wipe, 1e-3)})`;
    const w = word.current;
    if (w) {
      const k = clamp01((ms - 120) / 260);
      w.style.opacity = String(clamp01(k * 3));
      w.style.transform = `translateX(${(1 - easeOutBack(k, 1.4)) * -60}px)`;
    }
    const sh = shapes.current;
    if (sh) {
      Array.from(sh.children).forEach((c, i) => {
        const k = clamp01((ms - 200 - i * 70) / 220);
        (c as HTMLElement).style.transform = `scale(${Math.max(easeOutBack(k, 2.4), 0)})`;
      });
    }
    // Docking: up into the top band, smaller; the tag goes
    const dock = easeOutCubic(clamp01((ms - DOCK_AT) / DOCK_MS));
    const f = frame.current;
    if (f) {
      f.style.top = `${52 - 35 * dock}%`;
      f.style.fontSize = `calc(${BAND_SIZE} * ${1 - 0.42 * dock})`;
    }
    const s = sub.current;
    if (s) {
      const k = clamp01((ms - 420) / 260) * (1 - clamp01((ms - DOCK_AT) / 160));
      s.style.opacity = String(k);
      s.style.transform = `rotate(-4deg) translateY(${(1 - easeOutCubic(clamp01((ms - 420) / 260))) * -14}px)`;
    }
  });
  const result = winner ? `${winner} wins` : 'checkmate';
  return (
    <Html fullscreen zIndexRange={[400, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={frame} style={bandStyle} aria-hidden>
        <div
          ref={band}
          style={{
            visibility: 'hidden',
            transformOrigin: 'left center',
            width: '118%',
            background: INK,
            color: PAPER_LIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5em',
            padding: '0.18em 0',
            fontWeight: 700,
            letterSpacing: '0.12em',
            boxShadow: `0 0.12em 0 ${SIGNAL}`,
          }}
        >
          <div ref={shapes} style={{ display: 'flex', gap: '0.12em', alignItems: 'center' }}>
            <span
              style={{
                width: '0.55em',
                height: '0.55em',
                background: VERMILION,
                display: 'block',
              }}
            />
            <span
              style={{
                width: '0.55em',
                height: '0.55em',
                borderRadius: '50%',
                background: SIGNAL,
                display: 'block',
              }}
            />
            <span
              style={{
                width: 0,
                height: 0,
                borderLeft: '0.3em solid transparent',
                borderRight: '0.3em solid transparent',
                borderBottom: `0.55em solid ${COBALT}`,
                display: 'block',
              }}
            />
          </div>
          <div ref={word}>SCHACHMATT</div>
        </div>
        <div
          ref={sub}
          style={{
            opacity: 0,
            marginTop: '0.9em',
            background: PAPER_LIGHT,
            color: INK,
            border: `2px solid ${INK}`,
            boxShadow: `4px 4px 0 ${INK}`,
            padding: '0.25em 0.9em',
            fontSize: '0.3em',
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
          }}
        >
          {result}
        </div>
      </div>
    </Html>
  );
};

export const Celebration = ({ floor, winner }: CelebrationProps) => {
  return (
    <>
      <RingStamp at={floor} color={VERMILION} delayMs={420} lifeMs={620} to={3.2} line={0.07} />
      <RingStamp at={floor} color={INK} delayMs={560} lifeMs={620} to={2.6} line={0.05} />
      <Confetti
        at={[floor[0], floor[1] + 0.6, floor[2]]}
        count={16}
        delayMs={480}
        speed={2.6}
        gravity={1.2}
        lifeMs={2600}
        scale={1.6}
        upward={0.75}
        flutter
        spread={0.6}
      />
      <After delayMs={450}>
        <ScreenShake intensity={6} durationMs={320} />
      </After>
      <Banner winner={winner} delayMs={450} />
    </>
  );
};
