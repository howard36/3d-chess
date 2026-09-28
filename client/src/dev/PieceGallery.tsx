import { useMemo, useRef } from 'react';
import type React from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Euler, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { PieceType } from '../engine/pieces';
import { useDesign } from '../three/designs/context';
import type { PieceColor } from '../three/designs/types';
import { PIECE_PARTS, partsGeometry, pieceSet } from '../three/pieces';
import type { PieceQuality, PieceSet } from '../three/pieces';

// The piece gallery: every piece in a row, as the game draws it, from the
// side, three-quarters and directly above, in the light and the dark army,
// each standing on a level of its own in turn, under a plain studio light.
// Dev only: open http://127.0.0.1:5173/pieces.html while Vite runs, or save
// it as a PNG with scripts/pieces.mjs. Query options:
//
//   piece=<type>    one piece (e.g. knight) from 8 sides at two heights
//   cell=<px>       size of each picture (default 200)
//   silhouette      every piece of the set in solid black on white, one row
//                   per piece, from 8 sides, low down and from above: the
//                   test that each can be named by its outline alone
//   quality=<q>     the set's mesh density in the silhouette sheet: low |
//                   medium (the game's, and the default) | high

const ORDER = [
  PieceType.Pawn,
  PieceType.Rook,
  PieceType.Knight,
  PieceType.Bishop,
  PieceType.Unicorn,
  PieceType.Queen,
  PieceType.King,
];
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

const Piece = ({ cell, set }: { cell: Cell; set: PieceSet }) => {
  const { PieceBody } = useDesign();
  return cell.silhouette ? (
    // The whole piece in one plain material
    <mesh
      geometry={partsGeometry(set, cell.type, PIECE_PARTS)!}
      material={cell.view.relief ? clay : ink}
    />
  ) : (
    <PieceBody
      type={cell.type}
      color={cell.color}
      orientation="white"
      emissive={0x000000}
      selected={false}
      hovered={false}
      inCheck={false}
      level={cell.level}
    />
  );
};

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
  const design = useDesign();
  const only = params.get('piece');
  const quality = QUALITIES.find((q) => q === params.get('quality')) ?? 'medium';
  const cellPx = Number(params.get('cell') ?? 200);
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
          {silhouette ? `Piece set · ${quality}` : design.name}
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
            {rows.map((row, r) =>
              row.cells.map((cell, c) => (
                <group
                  key={`${r}/${c}`}
                  position={[c - (cols - 1) / 2, (rows.length - 1) / 2 - r, 0]}
                  rotation={new Euler(deg(cell.view.elevation), deg(cell.view.yaw), 0, 'XYZ')}
                >
                  <group position={[0, -0.43, 0]}>
                    <Piece cell={cell} set={set} />
                  </group>
                </group>
              )),
            )}
            <Ready />
          </Canvas>
        </div>
      </div>
    </div>
  );
};
