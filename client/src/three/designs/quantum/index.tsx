import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration, MoveFx } from './fx';
import { Capture, Check, LastMove, Quiet, Selection } from './markers';
import { KNIGHT_YAW, layout, LEVEL_COLORS, MOTION, PALETTE, PIECE_SCALE } from './palette';
import { PieceBody } from './pieces';
import { Wafers } from './plates';
import { Stage } from './stage';

// Qubit: inside a quantum computer. The board is the chip at the cold heart
// of a dilution refrigerator: five sapphire wafers, each a die traced in its
// level's colour (cyan at A through azure, periwinkle and lavender to orchid
// at E), hung under the gold chandelier of the cryostat, whose plates narrow
// away into cold blue mist below. Brushed gold plays matte black ceramic,
// each inlaid with the other. Every mark is a qubit: gold where a piece may
// go, collapsing into red for a capture; a mint photon line for the move
// just made; a red interference ripple for check. A held piece is in
// superposition, shimmering between two echoes of itself.

preloadPieceSet();

// --- Board -------------------------------------------------------------------------

const FONT = '"Space Grotesk", "Segoe UI", sans-serif';

/**
 * Wafers and coordinates. Decorative only: Board draws this outside the
 * clickable group. The level the player points at (or holds a piece on)
 * brightens its traces, edge and letter; the others step back a little.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <Wafers colors={LEVEL_COLORS} focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font={FONT}
        weight={600}
        levelWeight={700}
        color={PALETTE.ink}
        outline="rgba(3, 6, 12, 0.9)"
        outlineWidth={0.08}
        levelColors={LEVEL_COLORS}
        offset={0.5}
        levelOffset={0.62}
        focusLevel={focusLevel}
      />
    </>
  );
};

// --- HUD ---------------------------------------------------------------------------

const PANEL = 'rgba(5, 9, 17, 0.84)';
const GOLD = (alpha: number) => `rgba(231, 184, 95, ${alpha})`;
/** A hairline gold rule across a panel, at its top or bottom, with a tick at each end. */
const rule = (alpha: number, at: 'top' | 'bottom' = 'top') =>
  [
    `linear-gradient(90deg, transparent 3%, ${GOLD(alpha)} 9%, ${GOLD(alpha)} 91%, transparent 97%) ${at} / 100% 1px no-repeat`,
    `linear-gradient(${GOLD(alpha)}, ${GOLD(alpha)}) left 9% ${at} / 1px 5px no-repeat`,
    `linear-gradient(${GOLD(alpha)}, ${GOLD(alpha)}) right 9% ${at} / 1px 5px no-repeat`,
  ].join(', ');
/** A faint qubit, orbit and electron, watermarked on the result card. */
const watermark = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>" +
    "<g fill='none' stroke='rgb(231,184,95)' stroke-opacity='0.16' stroke-width='1.2'>" +
    "<circle cx='60' cy='60' r='46'/>" +
    "<ellipse cx='60' cy='60' rx='46' ry='16' transform='rotate(-24 60 60)'/></g>" +
    "<g fill='rgb(231,184,95)' fill-opacity='0.2'><circle cx='60' cy='60' r='5'/>" +
    "<circle cx='99' cy='42' r='3'/></g></svg>",
)}") right 22px center / 112px 112px no-repeat`;

// --- Design ------------------------------------------------------------------------

const quantum: Design = {
  id: 'quantum',
  name: 'Qubit',
  blurb:
    'Inside a quantum computer: gold and black ceramic on sapphire chips, under the golden chandelier.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the glyphs on the wafers say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  // A piece you may pick up stirs; a held one rises into superposition
  hoverLift: { hover: 0.06, selected: 0.16, bob: 0 },
  motion: MOTION,
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hud: {
    readout: true,
    vars: {
      '--hud-font': FONT,
      '--hud-mono': '"IBM Plex Mono", ui-monospace, monospace',
      '--hud-bg': `${rule(0.7)}, ${PANEL}`,
      '--hud-fg': PALETTE.ink,
      '--hud-muted': PALETTE.inkMuted,
      '--hud-accent': PALETTE.gold,
      '--hud-accent-fg': '#140e04',
      '--hud-border': '1px solid rgba(231, 184, 95, 0.22)',
      '--hud-radius': '2px',
      '--hud-shadow': '0 12px 32px rgba(0, 0, 0, 0.45)',
      '--hud-blur': 'blur(8px)',
      '--hud-tracking': '0.02em',
      '--turn-bg': `${rule(0.95)}, ${PANEL}`,
      '--turn-fg': '#f4ead6',
      '--turn-size': '18px',
      '--turn-border': '1px solid rgba(231, 184, 95, 0.45)',
      '--turn-shadow': '0 0 28px rgba(231, 184, 95, 0.1), 0 12px 32px rgba(0, 0, 0, 0.45)',
      '--modal-bg': `${rule(1)}, ${rule(0.8, 'bottom')}, ${watermark}, linear-gradient(180deg, rgba(10, 17, 30, 0.97), rgba(4, 7, 14, 0.98))`,
      '--modal-fg': PALETTE.ink,
      '--modal-backdrop': 'rgba(2, 4, 9, 0.55)',
      '--modal-radius': '2px',
      '--modal-shadow':
        '0 0 70px rgba(231, 184, 95, 0.2), 0 0 0 1px rgba(231, 184, 95, 0.28), 0 20px 50px rgba(0, 0, 0, 0.6)',
      '--button-bg': 'rgba(231, 184, 95, 0.12)',
      '--button-fg': '#f7e7c4',
      '--button-border': '1px solid rgb(231, 184, 95)',
      '--button-radius': '2px',
      '--page-bg': 'radial-gradient(ellipse at 50% 70%, #0c1a2c 0%, #050912 60%, #020409 100%)',
      '--page-fg': PALETTE.ink,
    },
    // A still vignette: the cryostat closes in at the corners
    overlay: {
      background:
        'radial-gradient(ellipse 80% 75% at 50% 50%, transparent 58%, rgba(1, 3, 8, 0.5) 100%)',
    },
  },
};

export default quantum;
