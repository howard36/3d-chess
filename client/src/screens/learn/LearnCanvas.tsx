import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import Board from '../../three/Board';
import { CameraControls } from '../../three/CameraControls';
import { FitCameraToBoard } from '../../three/FitCameraToBoard';
import { orbitSweep } from '../../three/cameraFit';
import { usePixelBudget } from '../../three/pixelBudget';
import { setUpRenderer } from '../../three/rendererSetup';
import { pointerEvents } from '../../three/pointerEvents';
import { BackdropCache } from '../../three/scene/backdropCache';
import { layout } from '../../three/scene/palette';
import { Stage } from '../../three/scene/stage';
import { WarmPrograms } from '../../three/scene/warm';
import type { Move } from '../../engine';
import type { Practice } from '../../game/lessons';
import { LEARN_CARD_PX, LEARN_TOP_PX, cardBeside, learnTop } from './learnLayout';

// The tutorial's board: the real tower and its rules, the side the lesson is
// for nearest (Black's pawns are seen from Black's side, going forwards and
// down), the lesson's piece picked up and its moves ringed. In the chunk the game's
// board shares. It never publishes __r3fState: e2e projects clicks through
// the game's canvas only.

const SWEEP = orbitSweep(layout.orbit);

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

/** The camera's fit, clear of the menu and, where it spans the bottom, the card. */
function Fit() {
  const beside = useThree((s) => cardBeside(s.size.width, s.size.height));
  // The same band from one render to the next while the card stays put
  const bottomBand = React.useMemo(() => (beside ? () => 0 : () => LEARN_CARD_PX), [beside]);
  return (
    <FitCameraToBoard
      viewDirection={layout.viewDirection}
      minDistance={layout.orbit.minDistance}
      frameRings={layout.frameRings}
      hudTopBand={learnTop}
      bottomBand={bottomBand}
      balanceInset={LEARN_TOP_PX}
      sweep={SWEEP}
    />
  );
}

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
      aria-label={`The 3D board, ${practice.side === 'white' ? 'White' : 'Black'}'s side nearest, with the lesson's pieces.`}
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
        <Stage orientation={practice.side} />
      </BackdropCache>
      <Board
        key={boardKey}
        board={practice.board}
        currentTurn={practice.side}
        // Seated as the lesson's piece's side, the board turned its way
        playerColor={practice.side}
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
