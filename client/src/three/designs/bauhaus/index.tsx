import '@fontsource/josefin-sans/400.css';
import '@fontsource/josefin-sans/700.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  MultiplyBlending,
  NoToneMapping,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Group, Mesh, Sprite, Texture } from 'three';
import { CELLS } from '../../layout';
import { Shards, ScreenShake } from '../kit/fx';
import { latticeLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { mixHex } from '../kit/textures';
import type {
  CaptureFxProps,
  CelebrationProps,
  Design,
  GridProps,
  LastMoveMarkerProps,
  MarkerProps,
  MoveFxProps,
  Vec3,
} from '../types';
import { PosterLabels } from './labels';
import { BauhausPiece, BLUE, INK, PAPER, PieceBody, RED, YELLOW } from './pieces';
import { drawPoster, FONT } from './poster';

// Bauhaus: a Swiss poster come to life. The board is a floating cube of
// paper tiles ruled in black, seen almost orthographically in front of a
// printed composition of primary shapes; the armies are vermilion and
// cobalt primitives with ink outlines. Everything is flat colour.

// Near-orthographic, from a little right of centre and above: a view that
// keeps the pieces on the second level clear of the first level's.
const SPACING = 1.25;
const lattice = latticeLayout(SPACING);
const layout = {
  ...lattice,
  viewDirection: [0.406, 0.375, 0.833] as Vec3,
  // Framed with room for the coordinates below and beside the cube
  halfExtents: [
    lattice.halfExtents[0] + 0.3,
    lattice.halfExtents[1] + 0.45,
    lattice.halfExtents[2],
  ] as Vec3,
};
const MAX_FRAME = 1 / 30;
const FLAT = -Math.PI / 2;

const useFontReady = (font: string) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setReady(true);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts.load(font).then(done, done);
    } else {
      done();
    }
    return () => {
      live = false;
    };
  }, [font]);
  return ready;
};

/** Seconds since mount (less a delay), advanced on r3f's clock; asks for frames until `lifeMs`. */
const useTimeline = (lifeMs: number, delayMs = 0, onFrame?: (t: number) => void) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(-delayMs / 1000);
  const [done, setDone] = useState(false);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    onFrame?.(elapsed.current);
    if (elapsed.current * 1000 > lifeMs) setDone(true);
    else invalidate();
  });
  return done;
};

/** Mounts its children once `delayMs` has passed on r3f's clock. */
const After = ({ delayMs, children }: { delayMs: number; children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  useTimeline(delayMs, 0, (t) => {
    if (!open && t * 1000 >= delayMs) setOpen(true);
  });
  return open ? <>{children}</> : null;
};

const easeOut = (k: number) => 1 - (1 - k) ** 3;
const clamp01 = (k: number) => Math.min(Math.max(k, 0), 1);

// --- Canvas-drawn marks ----------------------------------------------------

const mark = (draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 256): Texture => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

const disc = (ctx: CanvasRenderingContext2D, s: number, r: number, fill: string) => {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, r * s, 0, Math.PI * 2);
  ctx.fill();
};

const quietMark = mark((ctx, s) => {
  disc(ctx, s, 0.48, INK);
  disc(ctx, s, 0.36, YELLOW);
});

const targetMark = mark((ctx, s) => {
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.07;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  // Crosshair ticks through the ring
  ctx.lineWidth = s * 0.05;
  for (const [x0, y0, x1, y1] of [
    [0.5, 0.02, 0.5, 0.2],
    [0.5, 0.8, 0.5, 0.98],
    [0.02, 0.5, 0.2, 0.5],
    [0.8, 0.5, 0.98, 0.5],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0 * s, y0 * s);
    ctx.lineTo(x1 * s, y1 * s);
    ctx.stroke();
  }
});

const hazardMark = mark((ctx, s) => {
  const n = 16;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? INK : YELLOW;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.49, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
    ctx.arc(s / 2, s / 2, s * 0.38, ((i + 1) / n) * Math.PI * 2, (i / n) * Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
  }
}, 512);

const flat = (color: string, opacity = 1) =>
  new MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    side: DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

const inkFlat = flat(INK);
const yellowFlat = flat(YELLOW);

// --- Board ----------------------------------------------------------------

const TILE = 0.98;

// Paper tiles, one under every cell, in a 3D checker that greys with depth.
const buildTiles = () => {
  const positions: number[] = [];
  const colors: number[] = [];
  const lines: number[] = [];
  const lineColors: number[] = [];
  const h = TILE / 2;
  const depth = (z: number) => (2 * SPACING - z) / (4 * SPACING);
  CELLS.forEach((cell) => {
    const [x, y, z] = layout.toWorld(cell, 'white');
    const fy = y + layout.floorY - 0.002;
    const k = clamp01(depth(z));
    const light = (cell.x + cell.y + cell.z) % 2 === 0;
    const rgb = light ? mixHex('#fdfbf6', '#f1ece2', k) : mixHex('#ece5d6', '#e2d9c7', k);
    const c = new Color(`rgb(${rgb.map(Math.round).join(',')})`);
    const corners = [
      [x - h, fy, z - h],
      [x + h, fy, z - h],
      [x + h, fy, z + h],
      [x - h, fy, z + h],
    ];
    for (const i of [0, 2, 1, 0, 3, 2]) {
      positions.push(...corners[i]);
      colors.push(c.r, c.g, c.b);
    }
    // Rules fade from ink to a warm grey into the depth of the cube
    const ink = new Color(
      `rgb(${mixHex(INK, '#b3aa96', k * 0.85)
        .map(Math.round)
        .join(',')})`,
    );
    for (let i = 0; i < 4; i++) {
      lines.push(...corners[i], ...corners[(i + 1) % 4]);
      lineColors.push(ink.r, ink.g, ink.b, ink.r, ink.g, ink.b);
    }
  });
  const tiles = new BufferGeometry();
  tiles.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  tiles.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  const edges = new BufferGeometry();
  edges.setAttribute('position', new BufferAttribute(new Float32Array(lines), 3));
  edges.setAttribute('color', new BufferAttribute(new Float32Array(lineColors), 3));
  return { tiles, edges };
};
const board = buildTiles();

// Tiles overprint like ink: multiplied over whatever lies behind, so the
// pieces on lower shelves still show through the shelves above them.
const tileMaterial = new MeshBasicMaterial({
  vertexColors: true,
  side: DoubleSide,
  transparent: true,
  depthWrite: false,
  blending: MultiplyBlending,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

const Grid = ({ orientation }: GridProps) => (
  <group>
    <mesh geometry={board.tiles} material={tileMaterial} raycast={noRaycast} />
    <lineSegments geometry={board.edges} raycast={noRaycast}>
      <lineBasicMaterial vertexColors />
    </lineSegments>
    <PosterLabels layout={lattice} orientation={orientation} font={FONT} ink={INK} paper={PAPER} />
  </group>
);

// --- Stage ----------------------------------------------------------------

/** The printed poster behind the board, redrawn to the canvas's shape. */
const Poster = () => {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const fontReady = useFontReady(`700 64px ${FONT}`);
  const texture = useMemo(() => {
    const scale = Math.min(dpr, 2048 / Math.max(width, 1));
    return drawPoster(
      Math.max(2, Math.round(width * scale)),
      Math.max(2, Math.round(height * scale)),
      fontReady,
    );
  }, [width, height, dpr, fontReady]);
  useEffect(() => {
    scene.background = texture;
    invalidate();
    return () => {
      scene.background = null;
      texture.dispose();
    };
  }, [scene, texture, invalidate]);
  return null;
};

const Stage = () => <Poster />;

// --- Markers --------------------------------------------------------------

const Quiet = ({ centre }: MarkerProps) => (
  <sprite position={centre} scale={0.4} raycast={noRaycast} renderOrder={2}>
    <spriteMaterial map={quietMark} depthWrite={false} />
  </sprite>
);

const Capture = ({ floor }: MarkerProps) => (
  <sprite
    position={[floor[0], floor[1] + 0.42, floor[2]]}
    scale={1.12}
    raycast={noRaycast}
    renderOrder={2}
  >
    <spriteMaterial map={targetMark} depthWrite={false} />
  </sprite>
);

const squareOutline = (inner: number, outer: number) =>
  new RingGeometry(inner * Math.SQRT2, outer * Math.SQRT2, 4, 1, Math.PI / 4);
const selectionFrame = squareOutline(0.4, 0.49);
const selectionFill = new PlaneGeometry(0.8, 0.8);

const Selection = ({ floor }: MarkerProps) => (
  <group position={floor} rotation={[FLAT, 0, 0]}>
    <mesh geometry={selectionFill} material={yellowFlat} raycast={noRaycast} />
    <mesh geometry={selectionFrame} material={inkFlat} raycast={noRaycast} />
  </group>
);

const lastFrame = squareOutline(0.44, 0.49);
const rod = new CylinderGeometry(0.028, 0.028, 1, 10);
const arrowHead = new CylinderGeometry(0, 0.1, 0.24, 3);
const dot = new CircleGeometry(0.09, 24);
const up = new Vector3(0, 1, 0);

const LastMove = ({ from, to }: LastMoveMarkerProps) => {
  const { mid, length, quat, tip } = useMemo(() => {
    const a = new Vector3(from.floor[0], from.floor[1] + 0.03, from.floor[2]);
    const b = new Vector3(to.floor[0], to.floor[1] + 0.03, to.floor[2]);
    const dir = b.clone().sub(a);
    const full = dir.length();
    dir.normalize();
    // Stop short of the destination so the arrowhead shows beside the piece
    const end = b.clone().addScaledVector(dir, -0.36);
    const length = Math.max(0.01, end.distanceTo(a));
    return {
      mid: a.clone().lerp(end, 0.5).toArray() as Vec3,
      length: full > 0.5 ? length : 0.01,
      quat: new Quaternion().setFromUnitVectors(up, dir),
      tip: end.addScaledVector(dir, 0.12).toArray() as Vec3,
    };
  }, [from, to]);
  return (
    <>
      {[from, to].map((m, i) => (
        <mesh
          key={i}
          geometry={lastFrame}
          material={inkFlat}
          position={m.floor}
          rotation={[FLAT, 0, 0]}
          raycast={noRaycast}
        />
      ))}
      <mesh
        geometry={dot}
        material={inkFlat}
        position={[from.floor[0], from.floor[1] + 0.004, from.floor[2]]}
        rotation={[FLAT, 0, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={rod}
        material={inkFlat}
        position={mid}
        quaternion={quat}
        scale={[1, length, 1]}
        raycast={noRaycast}
      />
      <mesh
        geometry={arrowHead}
        material={inkFlat}
        position={tip}
        quaternion={quat}
        raycast={noRaycast}
      />
    </>
  );
};

const hazardPlane = new PlaneGeometry(1.1, 1.1);
const hazardMaterial = new MeshBasicMaterial({
  map: hazardMark,
  transparent: true,
  side: DoubleSide,
  depthWrite: false,
});
const pulseRing = new RingGeometry(0.5, 0.56, 48);

const haloMaterial = new SpriteMaterial({ map: hazardMark, depthWrite: false });

// Check: a hazard ring turning on the floor, a hazard halo behind the king,
// and a black ring pulsing out from its feet.
const Check = ({ floor }: MarkerProps) => {
  const hazard = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const halo = useRef<Sprite>(null);
  const camera = useThree((s) => s.camera);
  const ringMaterial = useMemo(() => flat(INK, 0.999), []);
  const away = useMemo(() => new Vector3(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (hazard.current) hazard.current.rotation.z = t * 0.9;
    if (ring.current) {
      const k = (t * 1.1) % 1;
      ring.current.scale.setScalar(0.9 + k * 0.7);
      ringMaterial.opacity = 1 - k;
    }
    const h = halo.current;
    if (h) {
      // Hung just behind the king, as seen from wherever the camera is
      away
        .set(floor[0], floor[1] + 0.45, floor[2])
        .sub(camera.position)
        .normalize();
      h.position.set(floor[0], floor[1] + 0.45, floor[2]).addScaledVector(away, 0.45);
      h.scale.setScalar(1.05 + Math.sin(t * 6) * 0.05);
      haloMaterial.rotation = -t * 0.7;
    }
    state.invalidate();
  });
  return (
    <>
      <group position={[floor[0], floor[1] + 0.01, floor[2]]} rotation={[FLAT, 0, 0]}>
        <mesh ref={hazard} geometry={hazardPlane} material={hazardMaterial} raycast={noRaycast} />
        <mesh ref={ring} geometry={pulseRing} material={ringMaterial} raycast={noRaycast} />
      </group>
      <sprite ref={halo} material={haloMaterial} raycast={noRaycast} />
    </>
  );
};

// --- Effects ---------------------------------------------------------------

/** A flat ring stamped on the floor that spreads and fades. */
const Stamp = ({
  at,
  color,
  delayMs,
  lifeMs = 420,
  from = 0.7,
  to = 1.6,
}: {
  at: Vec3;
  color: string;
  delayMs: number;
  lifeMs?: number;
  from?: number;
  to?: number;
}) => {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(() => flat(color, 0.999), [color]);
  const done = useTimeline(lifeMs + delayMs, delayMs, (t) => {
    const m = mesh.current;
    if (!m) return;
    const k = clamp01((t * 1000) / lifeMs);
    m.visible = t >= 0;
    m.scale.setScalar(from + (to - from) * easeOut(k));
    material.opacity = 1 - k * k;
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      geometry={pulseRing}
      material={material}
      position={at}
      rotation={[FLAT, 0, 0]}
      visible={false}
      raycast={noRaycast}
    />
  );
};

const MoveFx = ({ to, durationMs }: MoveFxProps) => {
  const at: Vec3 = [to[0], to[1] + layout.floorY + 0.02, to[2]];
  return (
    <>
      <Stamp at={at} color={INK} delayMs={durationMs * 0.8} />
      <Stamp at={at} color={YELLOW} delayMs={durationMs * 0.8 + 90} from={0.5} to={1.25} />
    </>
  );
};

// Shape debris: flat circles, triangles and squares in the primaries.
const shapeMaterial = new MeshBasicMaterial({ side: DoubleSide });
const SHAPES = [
  new CircleGeometry(0.075, 20),
  new CircleGeometry(0.1, 3),
  new PlaneGeometry(0.12, 0.12),
];
const PRIMARIES = [RED, BLUE, YELLOW, INK];

const ShapeBurst = ({
  at,
  count,
  scale = 1,
  speed = 2.6,
  gravity = 5,
  lifeMs = 1100,
  upward = 0.45,
  flutter = false,
  delayMs = 0,
  spread = 0.15,
}: {
  at: Vec3;
  count: number;
  scale?: number;
  speed?: number;
  gravity?: number;
  lifeMs?: number;
  upward?: number;
  flutter?: boolean;
  delayMs?: number;
  spread?: number;
}) => (
  <>
    {SHAPES.map((geometry, i) => (
      <Shards
        key={i}
        position={at}
        geometry={geometry}
        material={shapeMaterial}
        colors={PRIMARIES.slice(i % 2).concat(PRIMARIES.slice(0, i % 2))}
        count={count}
        scale={scale}
        speed={speed}
        gravity={gravity}
        lifeMs={lifeMs}
        upward={upward}
        spin={7}
        flutter={flutter}
        spread={spread}
        seed={7 + i * 13}
        delayMs={delayMs}
      />
    ))}
  </>
);

/** The captured piece holds still under the arriving capturer, then pops. */
const Popped = ({ floor, victim, impactMs }: CaptureFxProps & { impactMs: number }) => {
  const group = useRef<Group>(null);
  const done = useTimeline(impactMs + 200, 0, (t) => {
    const g = group.current;
    if (!g) return;
    const k = clamp01((t * 1000 - impactMs) / 180);
    // Swell, then snap to nothing
    const s = k < 0.35 ? 1 + 0.25 * (k / 0.35) : 1.25 * (1 - (k - 0.35) / 0.65) ** 2;
    g.scale.setScalar(Math.max(s, 1e-4));
  });
  if (done) return null;
  return (
    <group ref={group} position={floor}>
      <BauhausPiece type={victim.type} color={victim.color} decor />
    </group>
  );
};

const CaptureFx = (props: CaptureFxProps) => {
  const { floor, durationMs } = props;
  // The victim pops as the capturer closes in, so the burst is already
  // flying when it arrives.
  const impact = durationMs * 0.5;
  return (
    <>
      <Popped {...props} impactMs={impact} />
      <ShapeBurst
        at={[floor[0], floor[1] + 0.4, floor[2]]}
        count={14}
        scale={1.5}
        speed={3.2}
        delayMs={impact + 20}
      />
      <Stamp at={[floor[0], floor[1] + 0.02, floor[2]]} color={RED} delayMs={impact} to={2} />
      <After delayMs={impact + 40}>
        <ScreenShake intensity={4} durationMs={260} />
      </After>
    </>
  );
};

// The mate: a sun rises behind the fallen king, rays turning, and the
// poster's shapes rain down.
const sunDisc = new CircleGeometry(1, 64);
const sunRing = new RingGeometry(1.08, 1.16, 64);
const ray = new PlaneGeometry(0.05, 1).translate(0, 1.55, 0);
const RAYS = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);

const Sunburst = ({ at, color, delayMs }: { at: Vec3; color: string; delayMs: number }) => {
  const group = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const sun = useMemo(() => flat(color), [color]);
  const offset = useMemo(() => new Vector3(), []);
  useTimeline(60_000, delayMs, (t) => {
    const g = group.current;
    if (!g) return;
    // Face the camera from a little behind the king
    offset
      .copy(camera.position)
      .sub(new Vector3(...at))
      .normalize();
    g.position.set(at[0], at[1], at[2]).addScaledVector(offset, -1.4);
    g.quaternion.copy(camera.quaternion);
    const k = clamp01(t / 0.7);
    const pop = k === 0 ? 1e-4 : 1 + Math.sin(k * Math.PI) * 0.12 * (1 - k) - (1 - easeOut(k));
    g.scale.setScalar(Math.max(pop * 1.05, 1e-4));
    if (spin.current) spin.current.rotation.z = -t * 0.35;
  });
  return (
    <group ref={group} scale={1e-4}>
      <mesh geometry={sunDisc} material={sun} raycast={noRaycast} />
      <mesh geometry={sunRing} material={inkFlat} raycast={noRaycast} />
      <group ref={spin}>
        {RAYS.map((a) => (
          <mesh
            key={a}
            geometry={ray}
            material={inkFlat}
            rotation={[0, 0, a]}
            raycast={noRaycast}
          />
        ))}
      </group>
    </group>
  );
};

// A strip of poster type: the word reversed out of a black bar, with a
// block in the winner's colour at its head.
const bannerTexture = (text: string, block: string) => {
  const w = 1024;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = INK;
  ctx.fillRect(0, h * 0.18, w, h * 0.64);
  ctx.fillStyle = block;
  ctx.fillRect(w * 0.025, h * 0.28, h * 0.44, h * 0.44);
  ctx.fillStyle = PAPER;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let px = h * 0.46;
  ctx.font = `700 ${px}px ${FONT}`;
  const room = w * 0.8;
  const measured = ctx.measureText(text).width;
  if (measured > room) {
    px *= room / measured;
    ctx.font = `700 ${px}px ${FONT}`;
  }
  ctx.fillText(text, w * 0.56, h * 0.53);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

const Banner = ({ at, delayMs, block }: { at: Vec3; delayMs: number; block: string }) => {
  const sprite = useRef<Sprite>(null);
  const fontReady = useFontReady(`700 64px ${FONT}`);
  const texture = useMemo(
    () => (fontReady ? bannerTexture('SCHACHMATT', block) : null),
    [fontReady, block],
  );
  useEffect(() => () => texture?.dispose(), [texture]);
  useTimeline(60_000, delayMs, (t) => {
    const s = sprite.current;
    if (!s) return;
    // Slapped on: overshoots, then settles
    const k = clamp01(t / 0.3);
    const w = t < 0 ? 1e-4 : 2.5 * (k < 1 ? easeOut(k) * 1.1 : 1 + 0.1 * Math.exp(-(t - 0.3) * 14));
    s.scale.set(w, w / 4, 1);
    (s.material as SpriteMaterial).rotation = 0.12;
  });
  if (!texture) return null;
  return (
    <sprite ref={sprite} position={at} scale={1e-4} raycast={noRaycast} renderOrder={5}>
      <spriteMaterial map={texture} depthTest={false} depthWrite={false} transparent />
    </sprite>
  );
};

const Celebration = ({ floor, winner }: CelebrationProps) => {
  const color = winner === 'black' ? BLUE : winner === 'white' ? RED : YELLOW;
  return (
    <>
      <Sunburst at={[floor[0], floor[1] + 0.4, floor[2]]} color={YELLOW} delayMs={350} />
      <Banner at={[floor[0], floor[1] + 1.3, floor[2]]} delayMs={850} block={color} />
      <ShapeBurst
        at={[floor[0], floor[1] + 0.7, floor[2]]}
        count={40}
        scale={1.9}
        speed={2.8}
        gravity={1}
        upward={0.7}
        lifeMs={3600}
        flutter
        spread={0.7}
        delayMs={550}
      />
      <Stamp
        at={[floor[0], floor[1] + 0.02, floor[2]]}
        color={color}
        delayMs={500}
        lifeMs={700}
        to={2.6}
      />
      <After delayMs={520}>
        <ScreenShake intensity={7} durationMs={380} />
      </After>
    </>
  );
};

// Destination and last-move cells get no box fill: the markers say it all.
const hidden = new MeshBasicMaterial({ visible: false });

const bauhaus: Design = {
  id: 'bauhaus',
  name: 'Bauhaus',
  blurb: 'Primary-colour primitives on a floating cube of paper tiles, before a printed poster.',
  layout,
  continuous: false,
  canvas: { fov: 20, toneMapping: NoToneMapping, antialias: true },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: 0.3,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: { style: 'slide', durationMs: 300, lift: 0 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: true,
  hud: {
    vars: {
      '--hud-font': `${FONT}`,
      '--hud-mono': `${FONT}`,
      '--hud-bg': PAPER,
      '--hud-fg': INK,
      '--hud-muted': 'rgba(20, 20, 20, 0.55)',
      '--hud-accent': BLUE,
      '--hud-accent-fg': '#ffffff',
      '--hud-border': `3px solid ${INK}`,
      '--hud-radius': '0px',
      '--hud-shadow': `5px 5px 0 ${INK}`,
      '--hud-blur': 'none',
      '--hud-case': 'uppercase',
      '--hud-tracking': '0.08em',
      '--turn-bg': YELLOW,
      '--turn-fg': INK,
      '--turn-size': '22px',
      '--turn-border': `3px solid ${INK}`,
      '--turn-shadow': `5px 5px 0 ${INK}`,
      '--modal-bg': PAPER,
      '--modal-fg': INK,
      '--modal-backdrop': 'rgba(241, 235, 221, 0.35)',
      '--modal-radius': '0px',
      '--modal-shadow': `10px 10px 0 ${INK}`,
      '--button-bg': RED,
      '--button-fg': '#ffffff',
      '--button-border': `3px solid ${INK}`,
      '--button-radius': '0px',
      '--page-bg': PAPER,
      '--page-fg': INK,
    },
  },
};

export default bauhaus;
