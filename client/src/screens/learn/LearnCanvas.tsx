import React from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { NeutralToneMapping, Vector3 } from 'three';
import Board from '../../three/Board';
import { CameraControls } from '../../three/CameraControls';
import { FitCameraToBoard } from '../../three/FitCameraToBoard';
import { elevationOf, orbitSweep } from '../../three/cameraFit';
import { usePixelBudget } from '../../three/pixelBudget';
import { setUpRenderer } from '../../three/rendererSetup';
import { pointerEvents } from '../../three/pointerEvents';
import { BackdropCache } from '../../three/scene/backdropCache';
import { layout } from '../../three/scene/palette';
import { Stage } from '../../three/scene/stage';
import { WarmPrograms } from '../../three/scene/warm';
import type { Move } from '../../engine';
import type { Practice } from '../../game/lessons';
import { LEARN_TOP_PX, learnBottom, learnLeft, learnTop } from './learnLayout';

// The tutorial's board: the real tower and its rules, White's side nearest
// (Black's pawn too, mirroring White's), the lesson's piece picked up and its
// moves ringed. In the chunk the game's
// board shares. It never publishes __r3fState: e2e projects clicks through
// the game's canvas only.

// Kept clear of Home and the card from the opening and from below it: the
// view climbed higher, looking down, may pass under them, where a small
// window would otherwise frame the tower far smaller for every view
const SWEEP: [number, number] = [
  orbitSweep(layout.orbit)[0],
  elevationOf(new Vector3(...layout.viewDirection), new Vector3()),
];

export interface LearnCanvasProps {
  practice: Practice;
  /** A fresh board for each lesson and each start over (it plays only moves made after it mounts). */
  boardKey: string;
  onMove: (move: Move) => void;
  onChoosePromotion: (choices: Move[]) => void;
  /** The board takes no input (the promotion dialog is up). */
  disabled: boolean;
}

/** Calls `onDrawn` once the canvas has drawn its first frame. */
function FirstFrame({ onDrawn }: { onDrawn: () => void }) {
  const done = React.useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    onDrawn();
  });
  return null;
}

/**
 * The camera's fit, clear of Home and of the card: where it spans the
 * bottom, the tower in the middle of the room above it; where it stands at
 * the left, right of it should the tower, centred, run under it.
 */
const Fit = () => (
  <FitCameraToBoard
    viewDirection={layout.viewDirection}
    minDistance={layout.orbit.minDistance}
    frameRings={layout.frameRings}
    hudTopBand={learnTop}
    bottomBand={learnBottom}
    leftBand={learnLeft}
    centre="opening"
    balanceInset={LEARN_TOP_PX}
    sweep={SWEEP}
  />
);

const LearnCanvas = ({
  practice,
  boardKey,
  onMove,
  onChoosePromotion,
  disabled,
}: LearnCanvasProps) => {
  const pixelRatio = usePixelBudget();
  const [drawn, setDrawn] = React.useState(false);
  return (
    <Canvas
      data-testid="learn-canvas"
      role="img"
      aria-label="The 3D board, White's side nearest, with the lesson's pieces."
      style={{
        height: '100%',
        width: '100%',
        touchAction: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
      camera={{ position: layout.viewDirection, fov: 36 }}
      dpr={pixelRatio}
      gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
      frameloop="demand"
      onCreated={setUpRenderer}
      // The page may be left before the first commit: never connect to a gone container
      events={pointerEvents}
    >
      <BackdropCache>
        <Stage orientation="white" />
      </BackdropCache>
      <Board
        key={boardKey}
        board={practice.board}
        currentTurn={practice.side}
        // Seated as no one, so the board stays White's way round and the
        // lesson's piece (Black's pawn too) is the one on turn
        playerColor={null}
        onMove={onMove}
        onChoosePromotion={onChoosePromotion}
        lastMove={practice.lastMove}
        // A board with nothing picked up is only to look at
        disabled={disabled || !practice.focus}
        showMovesOf={practice.focus}
      />
      <CameraControls
        minPolarAngle={layout.orbit.minPolarAngle}
        maxPolarAngle={layout.orbit.maxPolarAngle}
      />
      <Fit />
      <FirstFrame onDrawn={() => setDrawn(true)} />
      {/* The marks a move brings (its line, a capture's burn) linked
          before the first move needs them, after the first frame */}
      {drawn && <WarmPrograms />}
    </Canvas>
  );
};

export default LearnCanvas;
