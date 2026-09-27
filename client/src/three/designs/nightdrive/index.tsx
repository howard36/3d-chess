import '@fontsource/orbitron/700.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/share-tech-mono/400.css';
import rajdhani700 from '@fontsource/rajdhani/files/rajdhani-latin-700-normal.woff2';
import grotesk700 from '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2';
import { useEffect, useMemo, useState } from 'react';
import { Color, MeshBasicMaterial, NeutralToneMapping, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { focusLevelOf, useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { LevelPlates } from '../kit/plates';
import { noRaycast } from '../kit/noRaycast';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration, MoveFx } from './fx';
import { MOTION } from './motion';
import { markers } from './markers';
import { HUD_FG, HUD_MUTED, LEVEL_NEON, PIECE_SCALE, frame, layout } from './palette';
import { PieceBody, focusBands } from './pieces';
import { Stage } from './stage';

// Nightdrive: a synthwave dusk. Five pale glass floors, each rimmed in its own
// neon (pink, violet, blue, jade, lime from A up), float high over an endless
// grid that rolls slowly away from a sun setting on one side. The armies are
// car paint at night: pearl white edged in cool light, and ink indigo edged
// in violet-magenta neon, every piece banded at its foot in its level's
// neon. The markers are neon tubes on the glass: cyan where the piece can
// go, the same tube doubled and red where it can take, amber for the last
// move with a thin neon line between its squares.

// Knights look along the ranks turned well toward the files, so the camera
// sees each horse's profile rather than the back of its neck.
const KNIGHT_YAW = 1.0;
const MARGIN = 0.06;
const EDGE_WIDTH = 0.032;

// --- Labels -------------------------------------------------------------------------------

/**
 * The coordinate face: level letters A–E in Rajdhani, like the HUD, and
 * files and ranks in Space Grotesk, whose double-storey "a" and flagged "1"
 * cannot be misread (Rajdhani's "a" reads as "o" at label size, and
 * Orbitron's "D" as "O"). One family, split by unicode range.
 */
const LABEL_FONT = 'Nightdrive Labels';
let labelFont: Promise<unknown> | null = null;
const loadLabelFont = () => {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve();
  }
  labelFont ??= Promise.all(
    [
      new FontFace(LABEL_FONT, `url(${rajdhani700}) format('woff2')`, {
        weight: '700',
        unicodeRange: 'U+41-45',
      }),
      new FontFace(LABEL_FONT, `url(${grotesk700}) format('woff2')`, {
        weight: '700',
        unicodeRange: 'U+20-40, U+46-7E',
      }),
    ].map((face) =>
      face.load().then((f) => {
        document.fonts.add(f);
      }),
    ),
  ).catch(() => undefined);
  return labelFont;
};

/** True once the label face is ready (labels are drawn once, so they wait for it). */
const useLabelFont = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    loadLabelFont().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  return ready;
};

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

const TICK_OPACITY = 0.55;

const PerimeterTicks = ({ focusLevel }: { focusLevel: number | null }) => {
  const materials = useMemo(
    () =>
      LEVEL_NEON.map(
        (c) =>
          new MeshBasicMaterial({
            color: new Color(c),
            transparent: true,
            opacity: TICK_OPACITY,
            depthWrite: false,
            toneMapped: false,
            fog: false,
          }),
      ),
    [],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  // The ticks follow their edge's focus, and the level bands on the pieces
  // follow it too: the focused level's bands glow, the others recede
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      materials.forEach((m, z) => {
        const w = weights[z] ?? 0;
        m.opacity = TICK_OPACITY * (1 - any * 0.5 * (1 - w)) + w * 0.35;
      });
      focusBands(weights, any);
    },
    { key: materials },
  );
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

/**
 * Platforms and coordinates. Decorative only: Board draws this outside the
 * clickable group. The level under the pointer (or of the selected piece)
 * lights up: its edge thickens and brightens, its letter grows, the bands on
 * its pieces glow, and every other level recedes a little.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  const fontReady = useLabelFont();
  return (
    <>
      <LevelPlates
        layout={l}
        light="#f1ecff"
        dark="#b4a6f2"
        opacity={0.12}
        edgeColors={LEVEL_NEON}
        edgeOpacity={0.92}
        edgeWidth={EDGE_WIDTH}
        thickness={0.04}
        margin={MARGIN}
        focusLevel={focusLevel}
        focusEdgeWidth={0.07}
        focusFill={0.04}
        focusDim={0.5}
        focusMs={180}
      />
      <PerimeterTicks focusLevel={focusLevel} />
      {fontReady && (
        <SmartLabels
          layout={l}
          orientation={orientation}
          font={`'${LABEL_FONT}', sans-serif`}
          weight={700}
          color="#efe8ff"
          outline="rgba(10, 3, 26, 0.92)"
          outlineWidth={0.08}
          shadow="rgba(160, 110, 255, 0.6)"
          levelColors={LEVEL_NEON}
          size={0.34}
          levelScale={1.55}
          focusLevel={focusLevel}
          focusScale={1.3}
          focusDim={0.5}
          focusMs={180}
        />
      )}
    </>
  );
};

// --- Design ---------------------------------------------------------------------------------

const nightdrive: Design = {
  id: 'nightdrive',
  name: 'Nightdrive',
  blurb: 'Pearl and neon-edged ink on glass floors, over an endless grid at dusk.',
  layout,
  // The grid far below rolls slowly, away from the tower: the only idle motion
  continuous: true,
  // A touch wider than the kit's 36°, so the dusk shows above the tower
  canvas: { fov: 38, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers,
  hoverDestinations: true,
  // Pieces stir under the pointer (and their rim brightens); picked up, they float
  hoverLift: true,
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
      '--hud-accent': 'linear-gradient(90deg, #d946ef, #ff5f6d)',
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
      '--turn-border': '1px solid rgba(217, 70, 239, 0.85)',
      '--turn-shadow': '0 0 18px rgba(217, 70, 239, 0.32), inset 0 0 14px rgba(217, 70, 239, 0.14)',
      '--modal-bg': 'linear-gradient(180deg, #1d0b3c 0%, #0d0522 70%, #2a0b36 100%)',
      '--modal-fg': HUD_FG,
      '--modal-backdrop': 'rgba(6, 2, 18, 0.55)',
      '--modal-radius': '4px',
      '--modal-shadow': '0 0 0 1px rgba(217, 70, 239, 0.55), 0 0 48px rgba(217, 70, 239, 0.28)',
      '--button-bg': 'linear-gradient(90deg, #d946ef, #ff5f6d)',
      '--button-fg': '#1a0420',
      '--button-border': '1px solid rgba(246, 214, 255, 0.6)',
      '--button-radius': '3px',
      '--page-bg': 'radial-gradient(ellipse at 50% 115%, #5a1a5e 0%, #1a0b36 48%, #060318 100%)',
      '--page-fg': HUD_FG,
    },
    // "Cc4 · White Bishop" under the turn chip for the cell under the pointer
    readout: true,
    overlay: {
      background: 'radial-gradient(ellipse at 50% 48%, transparent 62%, rgba(4, 0, 14, 0.32) 100%)',
    },
  },
};

export default nightdrive;
