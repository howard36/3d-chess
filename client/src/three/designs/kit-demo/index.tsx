import { MeshStandardMaterial } from 'three';
import { StauntonParts } from '../classic/pieces';
import { clarityTower, towerFrame } from '../kit/layouts';
import { clarityMarkers } from '../kit/markers';
import { ContactShadow, LevelPlates } from '../kit/plates';
import { GradientSky } from '../kit/sky';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps, PieceBodyProps, PieceColor } from '../types';

// Kit demo: the reference design for the clarity kit, and the template to
// start a new design from. It is hidden from the picker; open it with
// `?design=kit-demo`. Every part of the kit is used once, with neutral
// styling, so copying this folder and restyling it section by section gives
// a design that inherits all of the kit's clarity rules:
//
// - a compact tower (clarityTower) seen from a low, slightly turned camera,
//   with orbit limits;
// - one see-through platform per level (LevelPlates), tinted per level;
// - labels that follow the camera (SmartLabels);
// - markers flat on the platforms (clarityMarkers): destinations, the same
//   marker with a capture cue, the selection, the last move's squares and
//   trace, and the check;
// - a contact shadow under every piece, and pieces scaled to fit the gap.
//
// Keep the scene cheap (the showcase renders in software) and calm: nothing
// moves while nobody is moving.
//
// To start a design from here: copy the folder, give it a new id and name,
// add an entry to designs/registry.ts with `group: 'clarity'`, restyle the
// palette, stage, pieces and markers, and check it from both seats with
//   node scripts/showcase.mjs --design <id> --review --out <dir>

// --- Palette -------------------------------------------------------------------

const INK = '#e8edf5';
const SKY = { top: '#5d6879', horizon: '#48515f', bottom: '#2c323b' };
const WHITE_ARMY = '#f1ebdf';
const BLACK_ARMY = '#1f2329';
const ACCENT = '#4cc9f0';
// Faint per-level tints, bottom to top: a quiet colour code for the levels,
// matched by the level letters.
const LEVEL_TINTS = ['#9fc3ff', '#a6e3d4', '#e9e3a6', '#f4c3a0', '#e8b0d0'];

// --- Layout ----------------------------------------------------------------------

// Pieces are scaled so the tallest (the king) leaves clear air under the
// platform above; clarityTower centres the stack on its drawn height.
const PIECE_SCALE = 0.8;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
const { pitch } = towerFrame(layout);

// --- Stage -----------------------------------------------------------------------

/** A plain, calm backdrop: a soft gradient, a key light, a cool rim light behind. */
const Stage = () => (
  <>
    <GradientSky top={SKY.top} horizon={SKY.horizon} bottom={SKY.bottom} exponent={0.7} />
    <hemisphereLight args={['#e6eefb', '#3a4150', 1.2]} />
    <directionalLight position={[5, 9, 7]} intensity={2.1} />
    {/* From behind and above: an edge of light that lifts the dark army off the backdrop */}
    <directionalLight position={[-4, 6, -9]} intensity={1.6} color="#cfe0ff" />
  </>
);

// --- Board -----------------------------------------------------------------------

/** Platforms and coordinates. Decorative only: Board draws this outside the clickable group. */
const Grid = ({ layout: l, orientation }: GridProps) => (
  <>
    <LevelPlates
      layout={l}
      tints={LEVEL_TINTS}
      opacity={0.12}
      edgeColor="#dfe7f2"
      edgeOpacity={0.55}
    />
    <SmartLabels
      layout={l}
      orientation={orientation}
      color={INK}
      levelColors={LEVEL_TINTS}
      weight={600}
      levelWeight={700}
    />
  </>
);

// --- Pieces ----------------------------------------------------------------------

// Materials are shared between pieces, one per colour and glow (selection and
// check tint the whole piece). Anything that fades or recolours one piece
// must clone first; the kit's GhostPiece already does.
const materials = new Map<string, MeshStandardMaterial>();
const material = (color: PieceColor, emissive: string) => {
  const key = `${color}/${emissive}`;
  let m = materials.get(key);
  if (!m) {
    m =
      color === 'white'
        ? new MeshStandardMaterial({ color: WHITE_ARMY, roughness: 0.42, metalness: 0.04 })
        : new MeshStandardMaterial({ color: BLACK_ARMY, roughness: 0.3, metalness: 0.15 });
    m.emissive.set(emissive);
    materials.set(key, m);
  }
  return m;
};
const groove = {
  white: new MeshStandardMaterial({ color: '#8f8676', roughness: 0.6 }),
  black: new MeshStandardMaterial({ color: '#0f1115', roughness: 0.6 }),
};

// Board suggests a strong glow for check and selection; the markers on the
// floor already say both, so the pieces only warm a little.
const glow = ({ inCheck, selected }: PieceBodyProps) =>
  inCheck ? '#7a1414' : selected ? '#4a3a12' : '#000000';

/** A Staunton piece standing on its contact shadow (the shadow is part of the body). */
const PieceBody = (props: PieceBodyProps) => (
  <>
    <ContactShadow radius={0.36} opacity={0.38} />
    <StauntonParts
      type={props.type}
      material={material(props.color, glow(props))}
      groove={groove[props.color]}
    />
  </>
);

// --- Markers ---------------------------------------------------------------------

const markers = clarityMarkers({
  pitch,
  shape: 'square',
  color: '#ffd166',
  captureColor: '#ff6b5e',
  selectColor: '#fff0c2',
  lastMoveColor: ACCENT,
  checkColor: '#ff4040',
});

// --- Design ----------------------------------------------------------------------

const kitDemo: Design = {
  id: 'kit-demo',
  name: 'Kit Demo',
  blurb: 'The clarity kit on neutral styling: the template for new designs.',
  layout,
  continuous: false,
  canvas: { fov: 36 },
  Stage,
  Grid,
  // No cell volumes: the markers on the platforms say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 0.45,
  markers,
  hoverDestinations: true,
  motion: { style: 'hop', durationMs: 380, lift: 0.3 },
  hud: {
    vars: {
      '--hud-font': 'system-ui, sans-serif',
      '--hud-bg': 'rgba(22, 26, 34, 0.78)',
      '--hud-fg': INK,
      '--hud-muted': 'rgba(232, 237, 245, 0.6)',
      '--hud-accent': ACCENT,
      '--hud-accent-fg': '#081018',
      '--hud-border': '1px solid rgba(255, 255, 255, 0.08)',
      '--hud-radius': '10px',
      '--hud-shadow': '0 8px 24px rgba(0, 0, 0, 0.25)',
      '--hud-blur': 'blur(6px)',
      '--turn-bg': 'rgba(22, 26, 34, 0.85)',
      '--turn-fg': INK,
      '--turn-border': `1px solid rgba(76, 201, 240, 0.35)`,
      '--modal-bg': '#1f252e',
      '--modal-fg': INK,
      '--button-bg': ACCENT,
      '--button-fg': '#081018',
      '--page-bg': SKY.horizon,
      '--page-fg': INK,
    },
  },
};

export default kitDemo;
