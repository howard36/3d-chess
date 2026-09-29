import React from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import Board from '../three/Board';
import { CameraControls } from '../three/CameraControls';
import { FitCameraToBoard } from '../three/FitCameraToBoard';
import { hudTop } from '../three/cameraFit';
import { usePixelBudget } from '../three/pixelBudget';
import { layout } from '../three/scene/palette';
import { Stage } from '../three/scene/stage';
import type { Board as EngineBoard, Move } from '../engine';
import type { GameOver, LastMove, Turn } from '../game/history';

// The game screen's 3D board: three.js, the scene and its camera, in a
// chunk of its own (GameScreen loads it lazily), so a game's page can show
// its waiting and join screens before three.js has loaded.

export interface GameCanvasProps {
  color: Turn | null;
  board: EngineBoard;
  currentTurn: Turn;
  lastMove: LastMove | undefined;
  disabled: boolean;
  gameOver: GameOver | null;
  onMove: (move: Move) => void;
  onChoosePromotion: (choices: Move[]) => void;
}

const GameCanvas: React.FC<GameCanvasProps> = ({
  color,
  board,
  currentTurn,
  lastMove,
  disabled,
  gameOver,
  onMove,
  onChoosePromotion,
}) => {
  const pixelRatio = usePixelBudget();
  return (
    <Canvas
      data-testid="r3f-canvas"
      role="img"
      aria-label={`The 3D board, ${color ?? 'white'} side nearest. Pieces are selected and moved with a pointer; to play from the keyboard, press Tab to type a move.`}
      // Every touch on the board is the camera's or a tap on a
      // square: never a page scroll or zoom, and no grey tap flash
      style={{
        height: '100%',
        width: '100%',
        touchAction: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
      camera={{ position: layout.viewDirection, fov: 36 }}
      // A pixel budget rather than r3f's fixed cap: the screen's own
      // ratio up to 2x, a large high-density window a little under it
      dpr={pixelRatio}
      gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
      // A chess position is static: render only when something changes.
      // React commits and OrbitControls invalidate on their own; the
      // animations (the move glide, the lift, the scene's effects)
      // request frames while they run.
      frameloop="demand"
      // Test hook: r3f v9 no longer exposes its store on the canvas
      // element, so drivers (e2e/helpers/board.ts) read the live camera
      // here to project board cells to pixels — correct even after the
      // user orbits or the camera setup above changes.
      onCreated={(state: RootState) => {
        (window as Window & { __r3fState?: RootState }).__r3fState = state;
      }}
    >
      <Stage orientation={color ?? 'white'} />
      <Board
        board={board} // Pass the EngineBoard instance
        currentTurn={currentTurn}
        playerColor={color} // Pass the determined player color
        onMove={onMove}
        onChoosePromotion={onChoosePromotion}
        lastMove={lastMove}
        disabled={disabled}
        gameOver={gameOver}
      />
      {/* The only camera control is turning the view about the
            board's centre, which never moves (no pan by mouse, touch or
            keyboard), plus a zoom that FitCameraToBoard limits relative
            to the fitted view. */}
      <CameraControls
        // The tower's orbit limits: the camera stays above the ground and
        // may rise to look straight down
        minPolarAngle={layout.orbit.minPolarAngle}
        maxPolarAngle={layout.orbit.maxPolarAngle}
      />
      <FitCameraToBoard
        viewDirection={layout.viewDirection}
        minDistance={layout.orbit.minDistance}
        frameRings={layout.frameRings}
        hudTopBand={hudTop}
      />
    </Canvas>
  );
};

export default GameCanvas;
