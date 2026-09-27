import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Euler, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { PieceType } from '../engine/pieces';
import { DesignContext } from '../three/designs/context';
import { DESIGNS } from '../three/designs/registry';
import type { Design, PieceColor } from '../three/designs/types';
import { ChessPiece, pieceSet } from '../three/pieces';
import type { PieceQuality, PieceSet } from '../three/pieces';

// The piece gallery: every piece of the shared set in a row, from the side,
// three-quarters and directly above, in a light and a dark army, under a
// plain studio light. Dev only: open http://127.0.0.1:5173/pieces.html while
// Vite runs, or save it as a PNG with scripts/pieces.mjs. Query options:
//
//   design=<id>     draw a design's own PieceBody instead of the neutral set
//   piece=<type>    one piece (e.g. knight) from 8 sides at two heights
//   quality=<q>     low | medium (default) | high
//   cell=<px>       size of each picture (default 200)
//   silhouette      every piece in solid black on white, one row per piece,
//                   from 8 sides, low down and from above: the test that each
//                   can be named by its outline alone
//
// Materials here are neutral on purpose: ivory and ebony, the accent in
// walnut and brass, the foot band in the five level colours in turn.

const ORDER = [
  PieceType.Pawn,
  PieceType.Rook,
  PieceType.Knight,
  PieceType.Bishop,
  PieceType.Unicorn,
  PieceType.Queen,
  PieceType.King,
];
const LEVELS = ['#e0574b', '#ee9f33', '#e3cf45', '#44b184', '#4a88dd'];
const deg = (d: number) => (d * Math.PI) / 180;

interface View {
  label: string;
  /** Turn about the piece's axis, then tilt toward the camera (degrees). */
  yaw: number;
  elevation: number;
  /** In the silhouette sheet: shade this one in plain grey (relief, not outline). */
  relief?: boolean;
}
const SHEET_VIEWS: View[] = [
  { label: 'side', yaw: 0, elevation: 6 },
  { label: 'three-quarter', yaw: -40, elevation: 30 },
  { label: 'top', yaw: 0, elevation: 90 },
];

const neutral = {
  white: {
    body: new MeshStandardMaterial({ color: '#efe4cf', roughness: 0.42, metalness: 0.03 }),
    accent: new MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.5, metalness: 0.05 }),
  },
  black: {
    body: new MeshStandardMaterial({ color: '#2b2521', roughness: 0.32, metalness: 0.06 }),
    accent: new MeshStandardMaterial({ color: '#c9a263', roughness: 0.35, metalness: 0.55 }),
  },
};
const feet = LEVELS.map((c) => new MeshStandardMaterial({ color: c, roughness: 0.5 }));
const ink = new MeshBasicMaterial({ color: '#000000' });
const clay = new MeshStandardMaterial({ color: '#9a9ea6', roughness: 0.55 });

// The silhouette sheet: the pieces most easily confused first
const SILHOUETTE_ORDER = [
  PieceType.Queen,
  PieceType.King,
  PieceType.Bishop,
  PieceType.Unicorn,
  PieceType.Pawn,
  PieceType.Rook,
  PieceType.Knight,
];
const SILHOUETTE_VIEWS: View[] = [
  ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({ label: `${a}°`, yaw: -a, elevation: 15 })),
  { label: 'low', yaw: -30, elevation: 0 },
  { label: 'top', yaw: 0, elevation: 90 },
  // From above, every turned piece's outline is its base: what names it there
  // is its relief, shown in one plain material (no accent colours)
  { label: 'top, relief', yaw: 0, elevation: 90, relief: true },
];

interface Cell {
  type: PieceType;
  color: PieceColor;
  view: View;
  level: number;
  silhouette?: boolean;
}

const Piece = ({ cell, design, set }: { cell: Cell; design: Design | null; set: PieceSet }) =>
  cell.silhouette ? (
    <ChessPiece type={cell.type} set={set} parts={{ body: cell.view.relief ? clay : ink }} />
  ) : design ? (
    <design.PieceBody
      type={cell.type}
      color={cell.color}
      orientation="white"
      emissive={0x000000}
      selected={false}
      hovered={false}
      inCheck={false}
      level={cell.level}
    />
  ) : (
    <ChessPiece
      type={cell.type}
      set={set}
      parts={{
        body: neutral[cell.color].body,
        accent: neutral[cell.color].accent,
        foot: feet[cell.level],
      }}
    />
  );

/** A design's pieces may read the design from context, as they do in a game. */
const Pieces = ({ design, children }: { design: Design | null; children: React.ReactNode }) =>
  design ? <DesignContext.Provider value={design}>{children}</DesignContext.Provider> : children;

/** Tells scripts/pieces.mjs the page is ready for its screenshot. */
const markReady = () => {
  (window as unknown as { __galleryReady: boolean }).__galleryReady = true;
};

/** Marks the page ready once a few frames are drawn. */
const Ready = () => {
  const frames = useRef(0);
  useFrame(() => {
    frames.current++;
    if (frames.current === 4) markReady();
  });
  return null;
};

const QUALITIES: PieceQuality[] = ['low', 'medium', 'high'];

export const PieceGallery = ({ params }: { params: URLSearchParams }) => {
  const designId = params.get('design');
  const only = params.get('piece');
  const quality = QUALITIES.find((q) => q === params.get('quality')) ?? 'medium';
  const cellPx = Number(params.get('cell') ?? 200);
  const [design, setDesign] = useState<Design | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!designId) return;
    const entry = DESIGNS.find((d) => d.id === designId);
    // A failure is shown on the page, and the page still counts as ready
    const fail = (message: string) => {
      setError(message);
      markReady();
    };
    if (!entry) {
      fail(`No design "${designId}"`);
      return;
    }
    entry.load().then(
      (m) => setDesign(m.default),
      (e) => fail(String(e)),
    );
  }, [designId]);
  const set = useMemo(() => pieceSet(quality), [quality]);

  const type = ORDER.find((t) => t.toLowerCase() === only?.toLowerCase());
  const silhouette = params.has('silhouette');
  const rows: { label: string; cells: Cell[] }[] = silhouette
    ? SILHOUETTE_ORDER.map((t) => ({
        label: t,
        cells: SILHOUETTE_VIEWS.map((view) => ({
          type: t,
          color: 'white' as const,
          view,
          level: 0,
          silhouette,
        })),
      }))
    : type
      ? (['white', 'black'] as const).flatMap((color) =>
          [8, 40].map((elevation) => ({
            label: `${color === 'white' ? 'light' : 'dark'} ${elevation}°`,
            cells: [0, 45, 90, 135, 180, 225, 270, 315].map((yaw, k) => ({
              type,
              color,
              view: { label: `${yaw}°`, yaw: -yaw, elevation },
              level: k % 5,
            })),
          })),
        )
      : (['white', 'black'] as const).flatMap((color) =>
          SHEET_VIEWS.map((view) => ({
            label: `${color === 'white' ? 'light' : 'dark'} ${view.label}`,
            cells: ORDER.map((t, k) => ({ type: t, color, view, level: k % 5 })),
          })),
        );
  const cols = rows[0].cells.length;
  const labelW = 110;
  const headH = 28;
  const waiting = designId && !design;

  const style: React.CSSProperties = {
    font: '13px system-ui, sans-serif',
    color: '#3b3f46',
    background: silhouette ? '#ffffff' : 'linear-gradient(#d9dce1, #b9bec6)',
    width: labelW + cols * cellPx,
    padding: '0 0 8px',
  };
  return (
    <div style={style} data-testid="piece-gallery">
      <div style={{ display: 'flex', height: headH, alignItems: 'center' }}>
        <div style={{ width: labelW, paddingLeft: 10, fontWeight: 600 }}>
          {design ? design.name : 'Shared set'} · {quality}
        </div>
        {rows[0].cells.map((c, k) => (
          <div key={k} style={{ width: cellPx, textAlign: 'center' }}>
            {type || silhouette ? c.view.label : c.type}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex' }}>
        <div style={{ width: labelW }}>
          {rows.map((r) => (
            <div
              key={r.label}
              style={{ height: cellPx, display: 'flex', alignItems: 'center', paddingLeft: 10 }}
            >
              {r.label}
            </div>
          ))}
        </div>
        {error ? (
          <div>{error}</div>
        ) : waiting ? null : (
          <div style={{ width: cols * cellPx, height: rows.length * cellPx }}>
            <Canvas
              orthographic
              gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
              camera={{ position: [0, 0, 20], zoom: cellPx, near: 0.1, far: 100 }}
              dpr={1}
            >
              <hemisphereLight args={['#ffffff', '#4a4d55', 1.0]} />
              <directionalLight position={[-4, 6, 8]} intensity={2.3} />
              <directionalLight position={[6, 1, 4]} intensity={0.6} />
              <directionalLight position={[1, 4, -8]} intensity={1.6} color="#e8eefc" />
              <Pieces design={design}>
                {rows.map((row, r) =>
                  row.cells.map((cell, c) => (
                    <group
                      key={`${r}/${c}`}
                      position={[c - (cols - 1) / 2, (rows.length - 1) / 2 - r, 0]}
                      rotation={new Euler(deg(cell.view.elevation), deg(cell.view.yaw), 0, 'XYZ')}
                    >
                      <group position={[0, -0.43, 0]}>
                        <Piece cell={cell} design={design} set={set} />
                      </group>
                    </group>
                  )),
                )}
              </Pieces>
              <Ready />
            </Canvas>
          </div>
        )}
      </div>
    </div>
  );
};
