import { CylinderGeometry, MeshStandardMaterial } from 'three';
import { clarityTower } from './kit/layouts';
import { noRaycast } from './kit/noRaycast';
import type { Design, MarkerProps, PieceBodyProps } from './types';

// A small, fast stand-in for the game's design in unit tests: the same
// layout (the compact tower), plain meshes, and markers that only record
// where Board put them. Tests render the board in jsdom, where the real
// scene (shaders, a garden of sculptures, a sky) would be slow and beside
// the point.

const pieceGeometry = new CylinderGeometry(0.2, 0.25, 0.6, 12).translate(0, 0.3, 0);
const army = {
  white: new MeshStandardMaterial({ color: '#eeeeee' }),
  black: new MeshStandardMaterial({ color: '#333333' }),
};

const PieceBody = ({ color }: PieceBodyProps) => (
  <mesh geometry={pieceGeometry} material={army[color]} />
);

const marker = (userData: Record<string, boolean>) =>
  function Marker({ floor }: MarkerProps) {
    return <group position={floor} raycast={noRaycast} userData={userData} />;
  };
const Nothing = () => null;

export const testDesign: Design = {
  id: 'test',
  name: 'Test',
  layout: clarityTower(),
  canvas: { fov: 36, toneMapping: 0, exposure: 1 },
  Stage: Nothing,
  Grid: Nothing,
  PieceBody,
  knightYaw: 0.5,
  markers: {
    Quiet: marker({ quiet: true }),
    Capture: marker({ captureRing: true }),
    Selection: marker({ selectionRing: true }),
    LastMove: Nothing,
    Check: Nothing,
  },
  motion: { durationMs: 300 },
  knightMoves: () => 'straight',
  CaptureFx: Nothing,
  Celebration: Nothing,
  resultDelayMs: () => 0,
  hoverLift: () => ({ hover: 0.08, selected: 0.2, hoverSeconds: 0.2, selectSeconds: 0.2 }),
  pieceScale: 0.8,
  hud: { vars: {} },
  settings: [],
};

export default testDesign;
