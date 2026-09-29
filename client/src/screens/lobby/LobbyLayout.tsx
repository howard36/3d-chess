import React from 'react';
import { Outlet } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import { LobbyScene } from '../../three/lobby/LobbyScene';
import { LOBBY_FOV } from '../../three/lobby/lobbyMotion';
import { LobbyContext } from './lobbyContext';
import type { LobbyApi, LobbyStage } from './lobbyContext';

// The lobby's stage: one canvas behind the choosing page (/new) and the game
// page while it waits for its players (/game/:id), kept across the move from
// one to the other so the scene never reloads between them. The screens say
// what it shows (useLobby().show); passing null takes it away.

type Handlers = Pick<LobbyStage, 'onHover' | 'onPick' | 'onSettled' | 'onArrived' | 'onLeft'>;

/** Whether two views show the same picture (their handlers aside). */
const samePicture = (a: LobbyStage | null, b: LobbyStage | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.beat === b.beat &&
    a.taken.white === b.taken.white &&
    a.taken.black === b.taken.black &&
    a.mine === b.mine &&
    a.hover === b.hover &&
    a.toss === b.toss &&
    a.seat === b.seat &&
    a.arriving === b.arriving &&
    a.caption === b.caption);

const LobbyLayout = () => {
  const [view, setView] = React.useState<LobbyStage | null>(null);
  const anchors = React.useRef<HTMLDivElement>(null);
  const canvasHost = React.useRef<HTMLDivElement>(null);
  // The screens pass fresh handlers every render; the scene calls whichever
  // are current, so only a change in the picture renders the stage again
  const handlers = React.useRef<Handlers>({});
  const api = React.useMemo<LobbyApi>(
    () => ({
      show: (next) => {
        if (next) handlers.current = next;
        setView((prev) =>
          samePicture(prev, next)
            ? prev
            : next && {
                ...next,
                onHover: (c) => handlers.current.onHover?.(c),
                onPick: (c) => handlers.current.onPick?.(c),
                onSettled: () => handlers.current.onSettled?.(),
                onArrived: () => handlers.current.onArrived?.(),
                onLeft: () => handlers.current.onLeft?.(),
              },
        );
      },
    }),
    [],
  );
  // Over the game while it hands over: the game mounts underneath, and the
  // lobby's picture fades off it
  const over = view?.beat === 'arrive' || view?.beat === 'leave';
  return (
    <LobbyContext.Provider value={api}>
      <div
        ref={anchors}
        className="lobby"
        data-testid="lobby"
        data-beat={view?.beat}
        data-over={over ? '' : undefined}
      >
        {view && (
          <div ref={canvasHost} className="lobby-stage" aria-hidden>
            <Canvas
              data-testid="lobby-canvas"
              camera={{ fov: LOBBY_FOV, position: [0, 0, 8], near: 0.1, far: 900 }}
              dpr={[1, 1.5]}
              gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
              frameloop="demand"
              style={{ touchAction: 'manipulation' }}
            >
              <LobbyScene view={view} anchors={anchors} canvasHost={canvasHost} />
            </Canvas>
          </div>
        )}
        {view?.caption && (
          <p className="lobby-caption" key={view.caption}>
            {view.caption}
          </p>
        )}
        <div className="sr-only" role="status">
          {view?.caption ?? ''}
        </div>
        <Outlet />
      </div>
    </LobbyContext.Provider>
  );
};

export default LobbyLayout;
