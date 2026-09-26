import '@fontsource/architects-daughter/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Line,
  LineBasicMaterial,
  LineSegments,
  LineDashedMaterial,
  MeshBasicMaterial,
  NoToneMapping,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Group, Mesh, Sprite, SpriteMaterial, Texture } from 'three';
import { PieceType } from '../../../engine/pieces';
import { CELLS } from '../../layout';
import { Burst, ScreenShake } from '../kit/fx';
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
  PieceBodyProps,
  PieceColor,
  Vec3,
} from '../types';
import { DRAWINGS, fillMaterial, hullMaterial, scatterMaterial } from './drafting';
import { DraftLabels } from './labels';
import { BLUE, drawSheet, HAND, MONO } from './sheet';

// Blueprint: the board as a technical drawing on drafting blue. The lattice
// is ruled in white (hidden floors dashed), dimensioned along its edges; the
// White army is drawn as open line art over a pale hatched wash, the Black
// army as solid sections, cross-hatched in pale blue. Moves are measured,
// captures erased, and the mate is stamped in red.

const SPACING = 1.2;
const lattice0 = latticeLayout(SPACING);
// The cube itself; the framed box is larger, to take in the dimension lines.
const [HX, HY, HZ] = lattice0.halfExtents;
const layout = {
  ...lattice0,
  halfExtents: [HX + 0.5, HY + 0.45, HZ + 0.5] as Vec3,
  viewDirection: [0.39, 0.44, 0.81] as Vec3,
};
const CUBE = { ...lattice0, viewDirection: layout.viewDirection };

const INK = '#eef5ff';
const PALE = '#a9cfff';
const HIGHLIGHT = '#ffe066';
const REDLINE = '#ff5a4f';
const MAX_FRAME = 1 / 30;
const FLAT = -Math.PI / 2;

const easeOut = (k: number) => 1 - (1 - k) ** 3;
const clamp01 = (k: number) => Math.min(Math.max(k, 0), 1);

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

/** Seconds since mount (less a delay) on r3f's clock; asks for frames until `lifeMs`. */
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

const canvasTexture = (
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  size = 256,
): Texture => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

// --- Pieces ---------------------------------------------------------------

type State = 'none' | 'hover' | 'selected' | 'check';

const lineColour = (color: PieceColor, state: State) =>
  state === 'check'
    ? REDLINE
    : state === 'selected' || state === 'hover'
      ? HIGHLIGHT
      : color === 'white'
        ? INK
        : PALE;

interface PieceMaterials {
  fill: ReturnType<typeof fillMaterial>;
  hull: ReturnType<typeof hullMaterial>;
  creases: LineBasicMaterial;
  axis: LineBasicMaterial;
}

const makeMaterials = (color: PieceColor, state: State, fade = false): PieceMaterials => {
  const white = color === 'white';
  const ink = lineColour(color, state);
  const fill = white
    ? fillMaterial({
        fill: '#cfe2ff',
        alpha: 0.14,
        hatch: '#ffffff',
        hatchAlpha: 0.5,
        spacing: 5,
        all: false,
      })
    : fillMaterial({
        fill: '#041536',
        alpha: fade ? 0.999 : 1,
        hatch: '#6f9ad8',
        hatchAlpha: 0.4,
        spacing: 6,
        all: true,
      });
  const hull = hullMaterial(ink, state === 'selected' ? 0.024 : state === 'none' ? 0.016 : 0.02);
  const creases = new LineBasicMaterial({ color: ink, transparent: true, opacity: 0.9 });
  const axis = new LineBasicMaterial({ color: ink, transparent: true, opacity: 0.45 });
  return { fill, hull, creases, axis };
};

const cache = new Map<string, PieceMaterials>();
const materialsFor = (color: PieceColor, state: State) => {
  const key = `${color}-${state}`;
  let m = cache.get(key);
  if (!m) {
    m = makeMaterials(color, state);
    cache.set(key, m);
  }
  return m;
};

const DrawnPiece = ({
  type,
  materials: m,
  decor = false,
}: {
  type: PieceType;
  materials: PieceMaterials;
  decor?: boolean;
}) => {
  const d = DRAWINGS[type];
  return (
    <>
      <mesh
        geometry={d.solid}
        material={m.fill}
        renderOrder={1}
        raycast={decor ? noRaycast : undefined}
      />
      <mesh geometry={d.solid} material={m.hull} renderOrder={2} raycast={noRaycast} />
      <lineSegments geometry={d.creases} material={m.creases} renderOrder={2} raycast={noRaycast} />
      <lineSegments geometry={d.axis} material={m.axis} renderOrder={2} raycast={noRaycast} />
    </>
  );
};

const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => (
  <DrawnPiece
    type={type}
    materials={materialsFor(
      color,
      inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none',
    )}
  />
);

// --- Board ----------------------------------------------------------------

const toColor = (hex: string, k: number) =>
  new Color(`rgb(${mixHex(hex, BLUE, k).map(Math.round).join(',')})`);

// Cell floors dashed (hidden lines), fading into the blue with depth; the
// cube's own edges solid.
const buildLattice = () => {
  const floors: number[] = [];
  const floorColors: number[] = [];
  const h = 0.47;
  CELLS.forEach((cell) => {
    const [x, y, z] = layout.toWorld(cell, 'white');
    const fy = y + layout.floorY;
    const k = clamp01((2 * SPACING - z) / (4 * SPACING));
    const c = toColor(INK, 0.35 + k * 0.4);
    const corners = [
      [x - h, fy, z - h],
      [x + h, fy, z - h],
      [x + h, fy, z + h],
      [x - h, fy, z + h],
    ];
    for (let i = 0; i < 4; i++) {
      floors.push(...corners[i], ...corners[(i + 1) % 4]);
      floorColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  });
  const dashed = new BufferGeometry();
  dashed.setAttribute('position', new BufferAttribute(new Float32Array(floors), 3));
  dashed.setAttribute('color', new BufferAttribute(new Float32Array(floorColors), 3));

  const box: number[] = [];
  for (const [a, b] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    box.push(-HX, a * HY, b * HZ, HX, a * HY, b * HZ);
    box.push(a * HX, -HY, b * HZ, a * HX, HY, b * HZ);
    box.push(a * HX, b * HY, -HZ, a * HX, b * HY, HZ);
  }
  const solid = new BufferGeometry();
  solid.setAttribute('position', new BufferAttribute(new Float32Array(box), 3));
  return { dashed, solid };
};

// Dimension lines along three edges, with extension lines and arrowheads.
const buildDimensions = () => {
  const out: number[] = [];
  const texts: { at: Vec3; vertical: boolean }[] = [];
  const dim = (a: Vector3, b: Vector3, off: Vector3, gap: number) => {
    const along = b.clone().sub(a).normalize();
    for (const p of [a, b]) {
      const s = p.clone().addScaledVector(off, 0.12);
      const e = p.clone().addScaledVector(off, gap + 0.16);
      out.push(...s.toArray(), ...e.toArray());
    }
    const da = a.clone().addScaledVector(off, gap);
    const db = b.clone().addScaledVector(off, gap);
    const mid = da.clone().lerp(db, 0.5);
    const half = 0.42;
    out.push(...da.toArray(), ...mid.clone().addScaledVector(along, -half).toArray());
    out.push(...mid.clone().addScaledVector(along, half).toArray(), ...db.toArray());
    for (const [p, dir] of [
      [da, along],
      [db, along.clone().negate()],
    ] as const) {
      for (const side of [1, -1]) {
        const q = p
          .clone()
          .addScaledVector(dir, 0.2)
          .addScaledVector(off, side * 0.06);
        out.push(...p.toArray(), ...q.toArray());
      }
    }
    texts.push({ at: mid.toArray() as Vec3, vertical: Math.abs(along.y) > 0.9 });
  };
  const c = (x: number, y: number, z: number) => new Vector3(x, y, z);
  dim(c(-HX, -HY, HZ), c(HX, -HY, HZ), c(0, -1, 0), 0.95);
  dim(c(-HX, -HY, HZ), c(-HX, HY, HZ), c(-1, 0, 0), 0.95);
  dim(c(HX, -HY, HZ), c(HX, -HY, -HZ), c(1, 0, 0), 1.05);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
  return { lines: g, texts };
};

const lattice = buildLattice();
// Dashes are measured along each segment from its own start
new LineSegments(lattice.dashed).computeLineDistances();
const dimensions = buildDimensions();

const dashedMaterial = new LineDashedMaterial({
  vertexColors: true,
  dashSize: 0.07,
  gapSize: 0.05,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
});
const solidEdge = new LineBasicMaterial({ color: INK, transparent: true, opacity: 0.85 });
const dimLine = new LineBasicMaterial({ color: INK, transparent: true, opacity: 0.6 });

const dimText = (vertical: boolean) =>
  canvasTexture((ctx, s) => {
    ctx.translate(s / 2, s / 2);
    if (vertical) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = INK;
    ctx.globalAlpha = 0.85;
    ctx.font = `500 ${s * 0.13}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('5 × 120', 0, 0);
  }, 256);

const Dimensions = () => {
  const ready = useFontReady(`500 32px ${MONO}`);
  const textures = useMemo(() => (ready ? { h: dimText(false), v: dimText(true) } : null), [ready]);
  return (
    <>
      <lineSegments geometry={dimensions.lines} material={dimLine} raycast={noRaycast} />
      {textures &&
        dimensions.texts.map((t, i) => (
          <sprite key={i} position={t.at} scale={1.5} raycast={noRaycast}>
            <spriteMaterial map={t.vertical ? textures.v : textures.h} depthWrite={false} />
          </sprite>
        ))}
    </>
  );
};

const Grid = ({ layout: l, orientation }: GridProps) => (
  <group>
    <lineSegments geometry={lattice.dashed} material={dashedMaterial} raycast={noRaycast} />
    <lineSegments geometry={lattice.solid} material={solidEdge} raycast={noRaycast} />
    <Dimensions />
    <DraftLabels
      layout={{ ...CUBE, toWorld: l.toWorld }}
      orientation={orientation}
      font={HAND}
      ink={INK}
    />
  </group>
);

// --- Stage ----------------------------------------------------------------

/** The drawing sheet, redrawn to the canvas's shape. */
const Sheet = () => {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const handReady = useFontReady(`400 64px ${HAND}`);
  const monoReady = useFontReady(`500 64px ${MONO}`);
  const ready = handReady && monoReady;
  const texture = useMemo(() => {
    const scale = Math.min(dpr, 2048 / Math.max(width, 1));
    return drawSheet(
      Math.max(2, Math.round(width * scale)),
      Math.max(2, Math.round(height * scale)),
      ready,
    );
  }, [width, height, dpr, ready]);
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

const Stage = () => <Sheet />;

// --- Markers --------------------------------------------------------------

const crosshair = canvasTexture((ctx, s) => {
  ctx.fillStyle = 'rgba(255, 224, 102, 0.22)';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = HIGHLIGHT;
  ctx.lineWidth = s * 0.07;
  ctx.stroke();
  ctx.lineWidth = s * 0.05;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(s / 2 + dx * s * 0.1, s / 2 + dy * s * 0.1);
    ctx.lineTo(s / 2 + dx * s * 0.48, s / 2 + dy * s * 0.48);
    ctx.stroke();
  }
  ctx.fillStyle = HIGHLIGHT;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
});

const dashedCircle = canvasTexture((ctx, s) => {
  ctx.fillStyle = 'rgba(255, 90, 79, 0.1)';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = REDLINE;
  ctx.lineWidth = s * 0.045;
  ctx.setLineDash([s * 0.09, s * 0.05]);
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // A small cross at the top right, like a deletion mark
  ctx.lineWidth = s * 0.028;
  const x = s * 0.84;
  const y = s * 0.16;
  const r = s * 0.05;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
}, 512);

const Quiet = ({ centre }: MarkerProps) => (
  <sprite position={centre} scale={0.66} raycast={noRaycast}>
    <spriteMaterial map={crosshair} depthWrite={false} />
  </sprite>
);

const Capture = ({ floor }: MarkerProps) => (
  <sprite position={[floor[0], floor[1] + 0.42, floor[2]]} scale={1.2} raycast={noRaycast}>
    <spriteMaterial map={dashedCircle} depthWrite={false} />
  </sprite>
);

const flat = (color: string, opacity = 1) =>
  new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

const highlightFlat = flat(HIGHLIGHT);
const inkFlat = flat(INK, 0.9);
const selectRing = new RingGeometry(0.34, 0.37, 64);
const selectTick = new PlaneGeometry(0.16, 0.022);

const Selection = ({ floor }: MarkerProps) => (
  <group position={[floor[0], floor[1] + 0.005, floor[2]]} rotation={[FLAT, 0, 0]}>
    <mesh geometry={selectRing} material={highlightFlat} raycast={noRaycast} />
    {[0, 1, 2, 3].map((i) => (
      <mesh
        key={i}
        geometry={selectTick}
        material={highlightFlat}
        position={[Math.cos((i * Math.PI) / 2) * 0.45, Math.sin((i * Math.PI) / 2) * 0.45, 0]}
        rotation={[0, 0, (i * Math.PI) / 2]}
        raycast={noRaycast}
      />
    ))}
  </group>
);

const squareOutline = (inner: number, outer: number) =>
  new RingGeometry(inner * Math.SQRT2, outer * Math.SQRT2, 4, 1, Math.PI / 4);
const lastFrame = squareOutline(0.43, 0.46);
const rod = new CylinderGeometry(0.011, 0.011, 1, 6);
const arrow = new CylinderGeometry(0, 0.055, 0.2, 8);
const origin = new RingGeometry(0.05, 0.075, 24);
const up = new Vector3(0, 1, 0);

const lengthLabel = (text: string) =>
  canvasTexture((ctx, s) => {
    ctx.fillStyle = 'rgba(13, 63, 148, 0.9)';
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.76, s * 0.28);
    ctx.fillStyle = INK;
    ctx.font = `600 ${s * 0.17}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, s / 2, s / 2 + s * 0.01);
  });

// The last move, dimensioned: a line from the origin mark to an arrowhead,
// with its length in cells.
const LastMove = ({ from, to }: LastMoveMarkerProps) => {
  const ready = useFontReady(`600 32px ${MONO}`);
  const geo = useMemo(() => {
    const a = new Vector3(from.floor[0], from.floor[1] + 0.02, from.floor[2]);
    const b = new Vector3(to.floor[0], to.floor[1] + 0.02, to.floor[2]);
    const dir = b.clone().sub(a);
    const cells = dir.length() / SPACING;
    dir.normalize();
    const end = b.clone().addScaledVector(dir, -0.34);
    const start = a.clone().addScaledVector(dir, 0.08);
    return {
      mid: start.clone().lerp(end, 0.5).toArray() as Vec3,
      length: Math.max(0.01, end.distanceTo(start)),
      quat: new Quaternion().setFromUnitVectors(up, dir),
      tip: end.clone().addScaledVector(dir, 0.1).toArray() as Vec3,
      label: a
        .clone()
        .lerp(b, 0.5)
        .add(new Vector3(0, 0.22, 0))
        .toArray() as Vec3,
      text: cells.toFixed(2),
    };
  }, [from, to]);
  const label = useMemo(() => (ready ? lengthLabel(geo.text) : null), [ready, geo.text]);
  useEffect(() => () => label?.dispose(), [label]);
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
        geometry={origin}
        material={inkFlat}
        position={[from.floor[0], from.floor[1] + 0.02, from.floor[2]]}
        rotation={[FLAT, 0, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={rod}
        material={inkFlat}
        position={geo.mid}
        quaternion={geo.quat}
        scale={[1, geo.length, 1]}
        raycast={noRaycast}
      />
      <mesh
        geometry={arrow}
        material={inkFlat}
        position={geo.tip}
        quaternion={geo.quat}
        raycast={noRaycast}
      />
      {label && (
        <sprite position={geo.label} scale={1.1} raycast={noRaycast}>
          <spriteMaterial map={label} depthWrite={false} />
        </sprite>
      )}
    </>
  );
};

// A revision cloud in red around the king in check, with its revision tag.
const cloud = canvasTexture((ctx, s) => {
  ctx.strokeStyle = REDLINE;
  ctx.lineWidth = s * 0.022;
  ctx.lineCap = 'round';
  const n = 13;
  const r = s * 0.37;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const bump = r * Math.sin(Math.PI / n) * 1.05;
    ctx.arc(
      s / 2 + Math.cos(am) * r,
      s / 2 + Math.sin(am) * r,
      bump,
      am - Math.PI * 0.62,
      am + Math.PI * 0.62,
    );
  }
  ctx.stroke();
  // Revision triangle
  const tx = s * 0.82;
  const ty = s * 0.2;
  const t = s * 0.09;
  ctx.fillStyle = 'rgba(13, 63, 148, 0.9)';
  ctx.beginPath();
  ctx.moveTo(tx, ty - t);
  ctx.lineTo(tx + t * 1.05, ty + t * 0.75);
  ctx.lineTo(tx - t * 1.05, ty + t * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = REDLINE;
  ctx.font = `700 ${s * 0.09}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', tx, ty + t * 0.2);
}, 512);

const Check = ({ floor }: MarkerProps) => {
  const sprite = useRef<Sprite>(null);
  useFrame((state) => {
    const s = sprite.current;
    if (!s) return;
    const t = state.clock.elapsedTime;
    s.scale.setScalar(1.45 + Math.sin(t * 5) * 0.05);
    (s.material as SpriteMaterial).rotation = t * 0.25;
    state.invalidate();
  });
  return (
    <sprite ref={sprite} position={[floor[0], floor[1] + 0.45, floor[2]]} raycast={noRaycast}>
      <spriteMaterial map={cloud} depthWrite={false} />
    </sprite>
  );
};

// --- Effects ---------------------------------------------------------------

// The glide leaves a dashed trajectory, drawn out behind the piece.
const MoveFx = ({ from, to, durationMs }: MoveFxProps) => {
  const { line, material, geometry } = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const material = new LineDashedMaterial({
      color: HIGHLIGHT,
      dashSize: 0.09,
      gapSize: 0.06,
      transparent: true,
      depthWrite: false,
    });
    const line = new Line(geometry, material);
    line.raycast = noRaycast;
    line.frustumCulled = false;
    return { line, material, geometry };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const lifeMs = durationMs + 700;
  const done = useTimeline(lifeMs, 0, (t) => {
    const ms = t * 1000;
    const k = easeOut(clamp01(ms / durationMs));
    const y = layout.floorY + 0.03;
    const pos = geometry.getAttribute('position') as BufferAttribute;
    pos.setXYZ(0, from[0], from[1] + y, from[2]);
    pos.setXYZ(
      1,
      from[0] + (to[0] - from[0]) * k,
      from[1] + y + (to[1] - from[1]) * k,
      from[2] + (to[2] - from[2]) * k,
    );
    pos.needsUpdate = true;
    line.computeLineDistances();
    material.opacity = 1 - clamp01((ms - durationMs) / 700);
  });
  if (done) return null;
  return <primitive object={line} />;
};

/** The captured piece is rubbed out: it jitters, fades, and its strokes fly off. */
const Erased = ({ floor, victim, impactMs }: CaptureFxProps & { impactMs: number }) => {
  const group = useRef<Group>(null);
  const materials = useMemo(() => makeMaterials(victim.color, 'none', true), [victim.color]);
  const scatter = useMemo(
    () => scatterMaterial(victim.color === 'white' ? INK : PALE),
    [victim.color],
  );
  useEffect(
    () => () => {
      Object.values(materials).forEach((m) => m.dispose());
      scatter.dispose();
    },
    [materials, scatter],
  );
  const done = useTimeline(impactMs + 1500, 0, (t) => {
    const g = group.current;
    const s = t - impactMs / 1000;
    const fade = 1 - clamp01(s / 0.22);
    materials.fill.uniforms.uFade.value = fade;
    materials.fill.transparent = true;
    materials.hull.uniforms.uFade.value = fade;
    materials.creases.opacity = 0.9 * fade;
    materials.axis.opacity = 0.45 * fade;
    if (g) g.position.x = floor[0] + (s < 0.22 ? Math.sin(t * 90) * 0.035 : 0);
    scatter.uniforms.uT.value = s;
  });
  if (done) return null;
  return (
    <>
      <group ref={group} position={floor}>
        <DrawnPiece type={victim.type} materials={materials} decor />
      </group>
      <lineSegments
        geometry={DRAWINGS[victim.type].scatter}
        material={scatter}
        position={floor}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </>
  );
};

const CaptureFx = (props: CaptureFxProps) => {
  const { floor, durationMs } = props;
  // The rubbing-out starts as the capturer sets off; the strokes fly as it arrives
  const impact = durationMs * 0.35;
  return (
    <>
      <Erased {...props} impactMs={impact} />
      <Burst
        position={[floor[0], floor[1] + 0.3, floor[2]]}
        colors={['#e8f1ff', PALE, '#ffffff']}
        count={70}
        speed={1.3}
        gravity={3.2}
        upward={0.25}
        lifeMs={1200}
        size={0.045}
        additive={false}
        delayMs={impact}
      />
      <After delayMs={impact}>
        <ScreenShake intensity={3} durationMs={220} />
      </After>
    </>
  );
};

// The mate: a red rubber stamp slams down over the fallen king.
const stampTexture = (winner: PieceColor | null) =>
  canvasTexture((ctx, s) => {
    const w = s;
    const h = s * 0.5;
    const y0 = (s - h) / 2;
    ctx.strokeStyle = REDLINE;
    ctx.fillStyle = REDLINE;
    ctx.lineWidth = s * 0.022;
    ctx.beginPath();
    ctx.roundRect(w * 0.04, y0 + h * 0.06, w * 0.92, h * 0.88, s * 0.03);
    ctx.stroke();
    ctx.lineWidth = s * 0.007;
    ctx.beginPath();
    ctx.roundRect(w * 0.07, y0 + h * 0.13, w * 0.86, h * 0.74, s * 0.02);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${s * 0.13}px ${MONO}`;
    ctx.fillText('CHECKMATE', s / 2, s / 2 - h * 0.06);
    ctx.font = `600 ${s * 0.042}px ${MONO}`;
    const who = winner ? `${winner.toUpperCase()} WINS` : 'GAME OVER';
    ctx.fillText(`APPROVED  ·  ${who}  ·  SHEET 1/1`, s / 2, s / 2 + h * 0.27);
    // Uneven ink: knock specks out of the print
    ctx.globalCompositeOperation = 'destination-out';
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 900; i++) {
      ctx.globalAlpha = 0.25 + random() * 0.75;
      ctx.beginPath();
      ctx.arc(random() * s, y0 + random() * h, random() * s * 0.005 + 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }, 1024);

const Stamp = ({
  at,
  winner,
  delayMs,
}: {
  at: Vec3;
  winner: PieceColor | null;
  delayMs: number;
}) => {
  const sprite = useRef<Sprite>(null);
  const camera = useThree((s) => s.camera);
  const ready = useFontReady(`700 64px ${MONO}`);
  const texture = useMemo(() => (ready ? stampTexture(winner) : null), [ready, winner]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const toward = useMemo(() => new Vector3(), []);
  useTimeline(60_000, delayMs, (t) => {
    const s = sprite.current;
    if (!s) return;
    // Hang in front of the king, toward the viewer
    toward
      .copy(camera.position)
      .sub(new Vector3(...at))
      .normalize();
    s.position.set(at[0], at[1], at[2]).addScaledVector(toward, 2.2);
    const k = clamp01(t / 0.16);
    const settle = t > 0.16 ? 1 + Math.sin((t - 0.16) * 30) * 0.03 * Math.exp(-(t - 0.16) * 8) : 1;
    const scale = (2.4 - 1.4 * k * k) * settle * 3.8;
    s.scale.set(scale, scale, 1);
    const m = s.material as SpriteMaterial;
    m.opacity = t < 0 ? 0 : Math.min(1, k * 1.5) * 0.92;
    m.rotation = -0.2;
  });
  if (!texture) return null;
  return (
    <sprite ref={sprite} position={at} scale={1e-4} raycast={noRaycast} renderOrder={10}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} opacity={0} />
    </sprite>
  );
};

const shock = new RingGeometry(0.46, 0.5, 64);
const ShockRing = ({ at, delayMs }: { at: Vec3; delayMs: number }) => {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(() => flat(REDLINE), []);
  const done = useTimeline(delayMs + 700, delayMs, (t) => {
    const m = mesh.current;
    if (!m) return;
    const k = clamp01(t / 0.7);
    m.visible = t >= 0;
    m.scale.setScalar(1 + easeOut(k) * 3);
    material.opacity = 1 - k;
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      geometry={shock}
      material={material}
      position={at}
      rotation={[FLAT, 0, 0]}
      visible={false}
      raycast={noRaycast}
    />
  );
};

const Celebration = ({ floor, winner }: CelebrationProps) => {
  const slam = 650;
  return (
    <>
      <Stamp at={[floor[0], floor[1] + 0.9, floor[2]]} winner={winner} delayMs={slam - 160} />
      <ShockRing at={[floor[0], floor[1] + 0.02, floor[2]]} delayMs={slam} />
      <Burst
        position={[floor[0], floor[1] + 0.2, floor[2]]}
        colors={[REDLINE, '#ffd0cc', INK]}
        count={110}
        speed={2.2}
        gravity={2.4}
        upward={0.4}
        lifeMs={1500}
        size={0.05}
        additive={false}
        delayMs={slam}
      />
      <After delayMs={slam}>
        <ScreenShake intensity={8} durationMs={380} />
      </After>
    </>
  );
};

// Destination and last-move cells get no box fill: the markers say it all.
const hidden = new MeshBasicMaterial({ visible: false });

const grid = (a: number) =>
  `linear-gradient(rgba(255,255,255,${a}) 1px, transparent 1px) 0 0 / 14px 14px, ` +
  `linear-gradient(90deg, rgba(255,255,255,${a}) 1px, transparent 1px) 0 0 / 14px 14px`;

const blueprint: Design = {
  id: 'blueprint',
  name: 'Blueprint',
  blurb: 'Pieces drawn as technical line art on drafting blue; moves measured, captures erased.',
  layout,
  continuous: false,
  canvas: { fov: 26, toneMapping: NoToneMapping, antialias: true },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: 0.35,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: { style: 'slide', durationMs: 420, lift: 0 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: true,
  hud: {
    vars: {
      '--hud-font': HAND,
      '--hud-mono': MONO,
      '--hud-bg': 'rgba(9, 44, 110, 0.72)',
      '--hud-fg': INK,
      '--hud-muted': 'rgba(238, 245, 255, 0.55)',
      '--hud-accent': HIGHLIGHT,
      '--hud-accent-fg': '#0b2f6e',
      '--hud-border': '1px solid rgba(238, 245, 255, 0.85)',
      '--hud-radius': '0px',
      '--hud-shadow': '0 0 0 3px rgba(9, 44, 110, 0.6), 0 0 0 4px rgba(238, 245, 255, 0.35)',
      '--hud-blur': 'blur(2px)',
      '--hud-tracking': '0.03em',
      '--turn-bg': 'rgba(9, 44, 110, 0.8)',
      '--turn-fg': '#ffffff',
      '--turn-size': '22px',
      '--turn-border': '1px solid rgba(238, 245, 255, 0.9)',
      '--turn-shadow': '0 0 0 3px rgba(9, 44, 110, 0.7), 0 0 0 4px rgba(238, 245, 255, 0.5)',
      '--modal-bg': `${grid(0.07)}, #0d3f94`,
      '--modal-fg': INK,
      '--modal-backdrop': 'rgba(3, 18, 52, 0.35)',
      '--modal-radius': '0px',
      '--modal-shadow': '0 0 0 6px #0d3f94, 0 0 0 7px rgba(238, 245, 255, 0.6)',
      '--button-bg': 'transparent',
      '--button-fg': HIGHLIGHT,
      '--button-border': `1px solid ${HIGHLIGHT}`,
      '--button-radius': '0px',
      '--page-bg': `${grid(0.06)}, #0d3f94`,
      '--page-fg': INK,
    },
    overlay: {
      background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(2, 12, 40, 0.35))',
    },
  },
};

export default blueprint;
