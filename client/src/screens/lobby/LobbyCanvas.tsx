import type { RefObject } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import { LobbyScene } from '../../three/lobby/LobbyScene';
import type { LobbyView } from '../../three/lobby/LobbyScene';
import { PaceOnGpu } from '../../three/framePacer';
import { linkBeforeFirstFrame, setUpRenderer } from '../../three/rendererSetup';
import { CAMERA_FOV } from '../../three/scene/palette';

// The lobby's canvas: three.js and the lobby's scene, in the chunk the game's
// board (GameCanvas) and the landing page's preview share. LobbyLayout loads it
// lazily, so the side choice's and the invitation's words and buttons show
// before three.js has arrived.

export interface LobbyCanvasProps {
  view: LobbyView;
  anchors: RefObject<HTMLElement | null>;
  canvasHost: RefObject<HTMLElement | null>;
}

/**
 * The side choice (on /new and /computer) links its first frame's programs
 * ahead of that frame, as the board does (linkBeforeFirstFrame), the page
 * free meanwhile. Not a shared game's invitation, whose Join click would find
 * the GPU busy with them.
 */
const linkingAhead = (state: RootState) => {
  setUpRenderer(state);
  linkBeforeFirstFrame(state);
};

const LobbyCanvas = ({ view, anchors, canvasHost }: LobbyCanvasProps) => (
  <Canvas
    data-testid="lobby-canvas"
    camera={{ fov: CAMERA_FOV, position: [0, 0, 8], near: 0.1, far: 900 }}
    dpr={[1, 1.5]}
    gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
    frameloop="demand"
    onCreated={view.beat === 'choose' ? linkingAhead : setUpRenderer}
    style={{ touchAction: 'manipulation' }}
  >
    <LobbyScene view={view} anchors={anchors} canvasHost={canvasHost} />
    <PaceOnGpu />
  </Canvas>
);

export default LobbyCanvas;
