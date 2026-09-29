import type { RefObject } from 'react';
import { Canvas } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import { LobbyScene } from '../../three/lobby/LobbyScene';
import type { LobbyView } from '../../three/lobby/LobbyScene';
import { LOBBY_FOV } from '../../three/lobby/lobbyMotion';
import { shaderChecksInDevOnly } from '../../three/shaderChecks';

// The lobby's canvas: three.js and the lobby's scene, in the chunk the game's
// board (GameCanvas) and the landing page's preview share. LobbyLayout loads it
// lazily, so the side choice's and the invitation's words and buttons show
// before three.js has arrived.

export interface LobbyCanvasProps {
  view: LobbyView;
  anchors: RefObject<HTMLElement | null>;
  canvasHost: RefObject<HTMLElement | null>;
}

const LobbyCanvas = ({ view, anchors, canvasHost }: LobbyCanvasProps) => (
  <Canvas
    data-testid="lobby-canvas"
    camera={{ fov: LOBBY_FOV, position: [0, 0, 8], near: 0.1, far: 900 }}
    dpr={[1, 1.5]}
    gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
    frameloop="demand"
    onCreated={shaderChecksInDevOnly}
    style={{ touchAction: 'manipulation' }}
  >
    <LobbyScene view={view} anchors={anchors} canvasHost={canvasHost} />
  </Canvas>
);

export default LobbyCanvas;
