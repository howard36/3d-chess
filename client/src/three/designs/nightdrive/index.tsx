import '@fontsource/orbitron/700.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/share-tech-mono/400.css';
import { useEffect, useMemo } from 'react';
import { Color, MeshBasicMaterial, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER } from '../kit/layers';
import { LevelPlates } from '../kit/plates';
import { noRaycast } from '../kit/noRaycast';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration, MoveFx, seat } from './fx';
import { MOTION } from './motion';
import { markers } from './markers';
import { HUD_FG, HUD_MUTED, LEVEL_EDGES, PIECE_SCALE, frame, layout } from './palette';
import { PieceBody } from './pieces';
import { Stage } from './stage';

// Nightdrive: a synthwave dusk. Five pale glass floors, each rimmed in its own
// violet neon, float high over an endless grid that rolls slowly away from a
// sun setting on one side. The armies are car paint at
// night: pearl white, and ink indigo edged in hot-pink neon. The markers are
// neon tubes on the glass: cyan where the piece can go, the same tube doubled
// and red where it can take, amber for the last move with a light trail
// between its squares.

// Knights look along the ranks turned well toward the files, so the camera
// sees each horse's profile rather than the back of its neck.
const KNIGHT_YAW = 1.0;
const MARGIN = 0.06;
const EDGE_WIDTH = 0.03;

// --- Platforms ---------------------------------------------------------------------------

/**
 * Short ticks where the squares meet the perimeter, pointing inward from the
 * neon edge: the squares are counted along the rim, never drawn across the
 * glass.
 */
const tickGeometry = (() => {
  const side = frame.half + MARGIN;
  const length = 0.1;
  const width = 0.022;
  const ticks: PlaneGeometry[] = [];
  for (let k = 1; k < 5; k++) {
    const at = -frame.half + k * frame.pitch;
    for (const s of [-1, 1]) {
      // Along the file edges (z = ±side) and the rank edges (x = ±side)
      ticks.push(
        new PlaneGeometry(width, length)
          .rotateX(-Math.PI / 2)
          .translate(at, 0, s * (side - length / 2)),
      );
      ticks.push(
        new PlaneGeometry(length, width)
          .rotateX(-Math.PI / 2)
          .translate(s * (side - length / 2), 0, at),
      );
    }
  }
  return mergeGeometries(ticks);
})();

const PerimeterTicks = () => {
  const materials = useMemo(
    () =>
      LEVEL_EDGES.map(
        (c) =>
          new MeshBasicMaterial({
            color: new Color(c),
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            toneMapped: false,
            fog: false,
          }),
      ),
    [],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <group name="perimeter-ticks">
      {frame.levelY.map((y, z) => (
        <mesh
          key={z}
          geometry={tickGeometry}
          material={materials[z]}
          position={[0, y + 0.001, 0]}
          renderOrder={LAYER.plateEdge}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};

/** Platforms and coordinates. Decorative only: Board draws this outside the clickable group. */
const Grid = ({ layout: l, orientation }: GridProps) => {
  seat.orientation = orientation;
  seat.knightYaw = KNIGHT_YAW;
  return (
    <>
      <LevelPlates
        layout={l}
        light="#f1ecff"
        dark="#a996f0"
        opacity={0.12}
        edgeColors={LEVEL_EDGES}
        edgeOpacity={0.92}
        edgeWidth={EDGE_WIDTH}
        thickness={0.04}
        margin={MARGIN}
      />
      <PerimeterTicks />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font="Orbitron, sans-serif"
        weight={700}
        levelWeight={900}
        color="#efe8ff"
        outline="rgba(10, 3, 26, 0.9)"
        outlineWidth={0.08}
        shadow="rgba(180, 110, 255, 0.7)"
        levelColors={LEVEL_EDGES}
        size={0.32}
        levelScale={1.5}
      />
    </>
  );
};

// --- Design ---------------------------------------------------------------------------------

const nightdrive: Design = {
  id: 'nightdrive',
  name: 'Nightdrive',
  blurb: 'Pearl and neon-edged ink on glass floors, over an endless grid at dusk.',
  layout,
  // The grid far below rolls slowly: the only idle motion
  continuous: true,
  canvas: { fov: 36 },
  Stage,
  Grid,
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers,
  hoverDestinations: true,
  motion: MOTION,
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hud: {
    vars: {
      '--hud-font': '"Rajdhani", "Segoe UI", sans-serif',
      '--hud-mono': '"Share Tech Mono", ui-monospace, monospace',
      '--hud-bg': 'linear-gradient(180deg, rgba(28, 13, 58, 0.8), rgba(11, 5, 28, 0.84))',
      '--hud-fg': HUD_FG,
      '--hud-muted': HUD_MUTED,
      '--hud-accent': 'linear-gradient(90deg, #ff3cac, #ff8a4c)',
      '--hud-accent-fg': '#1a0420',
      '--hud-border': '1px solid rgba(186, 148, 255, 0.42)',
      '--hud-radius': '3px',
      '--hud-shadow': '0 10px 28px rgba(4, 0, 16, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
      '--hud-blur': 'blur(8px)',
      '--hud-case': 'uppercase',
      '--hud-tracking': '0.07em',
      '--turn-bg': 'linear-gradient(180deg, rgba(44, 12, 66, 0.86), rgba(16, 4, 34, 0.9))',
      '--turn-fg': '#fff1fa',
      '--turn-size': '16px',
      '--turn-border': '1px solid rgba(255, 60, 172, 0.8)',
      '--turn-shadow': '0 0 18px rgba(255, 60, 172, 0.3), inset 0 0 14px rgba(255, 60, 172, 0.14)',
      '--modal-bg': 'linear-gradient(180deg, #1d0b3c 0%, #0d0522 70%, #2a0b36 100%)',
      '--modal-fg': HUD_FG,
      '--modal-backdrop': 'rgba(6, 2, 18, 0.55)',
      '--modal-radius': '4px',
      '--modal-shadow': '0 0 0 1px rgba(255, 60, 172, 0.5), 0 0 48px rgba(255, 60, 172, 0.28)',
      '--button-bg': 'linear-gradient(90deg, #ff3cac, #ff8a4c)',
      '--button-fg': '#1a0420',
      '--button-border': '1px solid rgba(255, 214, 236, 0.6)',
      '--button-radius': '3px',
      '--page-bg': 'radial-gradient(ellipse at 50% 115%, #5a1a5e 0%, #1a0b36 48%, #060318 100%)',
      '--page-fg': HUD_FG,
    },
    overlay: {
      background: 'radial-gradient(ellipse at 50% 48%, transparent 62%, rgba(4, 0, 14, 0.32) 100%)',
    },
  },
};

export default nightdrive;
