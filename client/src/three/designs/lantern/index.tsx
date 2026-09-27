import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import type { Group } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { clarityTower, towerFrame } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { makeCaptureFx, makeCelebration, makeMoveFx } from './fx';
import { FONT, hud } from './hud';
import { lanternMarkers } from './markers';
import { LEVELS, WASHI } from './palette';
import { PieceBody } from './pieces';
import { ShojiPlates } from './plates';
import { Stage } from './stage';

// Lantern: a zen garden at blue hour. Five shoji screens float, stacked,
// high over a raked gravel garden: frames of dark lacquer inlaid in the
// level's colour (moss jade at the bottom, through pond teal, dusk blue and
// wisteria, to sakura pink at the top), kumiko slats in the same colour
// dividing each into its 25 panes, and washi so thin the pieces below show
// through. The set is boxwood against rosewood, grained and varnished, on
// felt feet of the level's colour. Every mark is light on paper: a small
// lantern where a piece may go, red lacquer for a capture or a check, a
// lantern held under the piece you pick up (its glow swells and a ripple
// runs out across the screen), and firefly light for the last move.

preloadPieceSet();

const PIECE_SCALE = 0.8;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
const frame = towerFrame(layout);
const { pitch } = frame;
/** How far from the centre the platforms reach: effects are kept inside. */
const CLIP = frame.half + 0.03;

const MOTION = { style: 'slide' as const, durationMs: 440 };

/**
 * Shoji platforms and coordinates. Decorative only: Board draws this outside
 * the clickable group. The level the player points at (or holds a piece on)
 * lights its slats and inlay and grows its letter.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  // Seen from high above, the level letters crowd one corner: a second set
  // of them, smaller and further out, takes over (the files and ranks stay
  // one set). Switched per frame on the groups' visibility (not React
  // state), so the switch is in the very next frame.
  const camera = useThree((s) => s.camera);
  const low = useRef<Group>(null);
  const high = useRef<Group>(null);
  const steep = useRef(false);
  useFrame(() => {
    const y = camera.position.y / Math.max(camera.position.length(), 1e-6);
    const elevation = (Math.asin(Math.min(Math.max(y, -1), 1)) * 180) / Math.PI;
    if (!steep.current && elevation > 62) steep.current = true;
    else if (steep.current && elevation < 56) steep.current = false;
    if (low.current) low.current.visible = !steep.current;
    if (high.current) high.current.visible = steep.current;
  });
  const labels = {
    layout: l,
    orientation,
    font: FONT,
    weight: 700,
    levelWeight: 800,
    size: 0.4,
    opacity: 0.95,
    offset: 0.44,
    focusLevel,
    focusScale: 1.28,
    focusDim: 0.55,
  };
  // The level letters alone: file and rank glyphs drawn clear, the letters
  // held off the scene by a dark glow rather than an outline
  const letters = {
    ...labels,
    color: 'rgba(0, 0, 0, 0)',
    outlineWidth: 0,
    shadow: 'rgba(6, 8, 20, 0.95)',
    levelColors: LEVELS,
  };
  return (
    <>
      <ShojiPlates layout={l} colors={LEVELS} focusLevel={focusLevel} />
      {/* Files and ranks, from every angle (their level letters too small to see) */}
      <SmartLabels
        {...labels}
        color={WASHI}
        outline="rgba(8, 10, 22, 0.9)"
        outlineWidth={0.07}
        levelScale={1e-4}
      />
      <group ref={low}>
        <SmartLabels {...letters} levelScale={1.4} levelOffset={0.66} />
      </group>
      <group ref={high} visible={false}>
        <SmartLabels {...letters} levelScale={1.0} levelOffset={1.6} />
      </group>
    </>
  );
};

const lantern: Design = {
  id: 'lantern',
  name: 'Lantern',
  blurb: 'A zen garden at dusk: boxwood and rosewood on lantern-lit shoji, fireflies below.',
  layout,
  continuous: true,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the marks on the paper say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 0.45,
  markers: lanternMarkers({
    pitch,
    clip: CLIP,
    moveMs: MOTION.durationMs,
    levelY: frame.levelY,
    levels: LEVELS,
  }),
  hoverDestinations: true,
  // Hover stirs a piece and selection raises it only a little, so it stays
  // seated in its lantern's light (at the low opening view a higher lift
  // floats it a rank back, off its own glow)
  hoverLift: { hover: 0.03, selected: 0.06 },
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY, CLIP),
  CaptureFx: makeCaptureFx(PIECE_SCALE),
  Celebration: makeCelebration(CLIP),
  toppleMatedKing: true,
  hud,
};

export default lantern;
