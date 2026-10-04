import React from 'react';
import { Outlet } from 'react-router-dom';
import { lazyChunk } from '../../lib/cachedImport';
import { ChunkBoundary } from '../../components/ChunkBoundary';
import { LobbyContext } from './lobbyContext';
import type { LobbyApi, LobbyStage } from './lobbyContext';

// The lobby's stage: one canvas behind the choosing page (/new) and the game
// page while it waits for its players (/game/:id), kept across the move from
// one to the other so the scene never reloads between them. The screens say
// what it shows (useLobby().show); passing null takes it away.

// The canvas (three.js, the lobby's scene) is a chunk of its own, the one the
// game's board loads too, asked for as soon as the lobby loads: the pages'
// words and buttons show before it arrives, and the scene then draws
// behind them (the page's entrance waits for its first frame, data-scene).
// Should it fail to load, the pages go on without it
const lobbyCanvas = lazyChunk(() => import('./LobbyCanvas'));
const LobbyCanvas = lobbyCanvas.Component;
lobbyCanvas.preload();

type Handlers = Pick<
  LobbyStage,
  'onHover' | 'onPick' | 'onGlide' | 'onSettled' | 'onQuiet' | 'onArrived' | 'onReveal' | 'onLeft'
>;

/** Whether two views show the same picture (their handlers aside). */
const samePicture = (a: LobbyStage | null, b: LobbyStage | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.beat === b.beat &&
    a.taken.white === b.taken.white &&
    a.taken.black === b.taken.black &&
    a.mine === b.mine &&
    !!a.card === !!b.card &&
    a.hover === b.hover &&
    a.toss === b.toss &&
    a.seat === b.seat &&
    a.arriving === b.arriving &&
    a.caption === b.caption);

const LobbyLayout = () => {
  const [view, setView] = React.useState<LobbyStage | null>(null);
  const anchors = React.useRef<HTMLDivElement>(null);
  const canvasHost = React.useRef<HTMLDivElement>(null);
  const [noScene, setNoScene] = React.useState(false);
  // The page's entrance waits for the scene's first frame (data-scene); should
  // the scene never draw, the page comes in anyway
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const host = anchors.current;
      if (host && !host.dataset.scene) host.dataset.scene = 'late';
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);
  // Without the scene, each of its moments is over as soon as it begins,
  // and the page's words come in at once
  React.useEffect(() => {
    if (!noScene) return;
    const host = anchors.current;
    if (host && !host.dataset.scene) host.dataset.scene = 'late';
    if (!view) return;
    if (view.beat === 'choose' && view.mine) {
      if (view.toss) view.onGlide?.();
      view.onSettled?.();
      view.onQuiet?.();
    }
    if (view.beat === 'arrive') view.onArrived?.();
    if (view.beat === 'leave') {
      view.onReveal?.();
      view.onLeft?.();
    }
  }, [noScene, view]);
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
                onGlide: () => handlers.current.onGlide?.(),
                onSettled: () => handlers.current.onSettled?.(),
                onQuiet: () => handlers.current.onQuiet?.(),
                onArrived: () => handlers.current.onArrived?.(),
                onReveal: () => handlers.current.onReveal?.(),
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
            <ChunkBoundary onFail={() => setNoScene(true)}>
              <React.Suspense fallback={null}>
                <LobbyCanvas view={view} anchors={anchors} canvasHost={canvasHost} />
              </React.Suspense>
            </ChunkBoundary>
          </div>
        )}
        {/* The arrival's line, where the pages' headings stand */}
        {view?.caption && (
          <div className="lobby-heading lobby-caption" key={view.caption} aria-hidden>
            <h1>{view.caption}</h1>
          </div>
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
