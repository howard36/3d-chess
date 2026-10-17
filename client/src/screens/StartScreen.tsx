import React from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { lazyChunk } from '../lib/cachedImport';
import { ChunkBoundary } from '../components/ChunkBoundary';
import { PieceGlyph } from './PieceGlyph';
import { BotGlyph } from './BotGlyph';
import { PieceType } from '../engine/pieces';
import { learnScreen } from './learn/learnChunk';
import { LandingPicture } from './LandingPicture';
import { glassRim } from './turningRim';

/** The tiles' rim turns while the pointer is on them. */
const tileRim = glassRim((_, pointed) => pointed);

// The preview (three.js, the scene, the demo's games) is a chunk of its own,
// asked for when the page first draws, so its title and buttons show without
// waiting for it. Meanwhile a picture of its first frame stands in for it
// (LandingPicture), and the preview fades in over the picture once it draws;
// should it fail to load, or the player ask for less motion, the picture is
// all the page shows
let previewArrived = false;
const { Component: LandingPreview } = lazyChunk(() =>
  import('./LandingPreview').then((m) => {
    previewArrived = true;
    return { default: m.LandingPreview };
  }),
);

// Whether this page's own code came from the browser's cache (a returning
// visit, the host letting it keep the built files): the preview's chunk is
// then in the cache too, and asked for in the first render it would run at
// once, ahead of the connection's opening and the page's first idle moment
const codeFromCache = () => {
  try {
    const [entry] = performance.getEntriesByName(import.meta.url) as PerformanceResourceTiming[];
    return !!entry && entry.transferSize === 0 && entry.decodedBodySize > 0;
  } catch {
    return false;
  }
};

/**
 * Calls `then` once the early connection (lib/earlySocket.ts) is no longer
 * opening and the page is next idle; returns what cancels it.
 */
const afterOpenAndIdle = (then: () => void) => {
  // (Safari has no idle callbacks: the next task)
  const idleCallbacks = typeof requestIdleCallback === 'function';
  let idle = 0;
  const whenIdle = () => {
    idle = idleCallbacks ? requestIdleCallback(then, { timeout: 500 }) : window.setTimeout(then);
  };
  const socket = window.__earlySocket?.socket;
  const opening = socket?.readyState === WebSocket.CONNECTING;
  if (opening) {
    socket.addEventListener('open', whenIdle, { once: true });
    socket.addEventListener('close', whenIdle, { once: true });
  } else whenIdle();
  return () => {
    socket?.removeEventListener('open', whenIdle);
    socket?.removeEventListener('close', whenIdle);
    if (idleCallbacks) cancelIdleCallback(idle);
    else clearTimeout(idle);
  };
};

// The home page: the tower playing a game by itself, and the ways in. A game
// with a friend starts by choosing a side (/new), which asks the server for
// it; a game against the computer by choosing a side and a level (/computer).
const StartScreen: React.FC = () => {
  const navigate = useNavigate();
  // Whether the player asked their system for less motion, following a change
  const still = useMediaQuery('(prefers-reduced-motion: reduce)');
  // The live preview: loading (the picture showing), shown over the picture
  // (which then goes), failed to load (the picture stays), or dropped on the
  // way out before it showed
  const [preview, setPreview] = React.useState<'loading' | 'shown' | 'failed' | 'left'>('loading');
  // Motion turned back on brings a new preview, which fades in over the picture again
  const [wasStill, setWasStill] = React.useState(still);
  if (wasStill !== still) {
    setWasStill(still);
    if (preview === 'shown') setPreview('loading');
  }
  // A returning visit asks for the preview once the connection has opened
  // and the page is idle, the picture standing in for it meanwhile; a first
  // visit, whose chunk comes over the network, asks in the first render
  const [held, setHeld] = React.useState(() => !previewArrived && codeFromCache());
  React.useEffect(() => (held ? afterOpenAndIdle(() => setHeld(false)) : undefined), [held]);
  const live = !still && preview !== 'failed' && preview !== 'left';
  const onShown = React.useCallback(() => setPreview('shown'), []);
  // A preview whose chunk has arrived but which has not shown yet is taken
  // down in the click's own task, before the next page renders: its build,
  // its programs' linking and its first frame, queued ahead of the
  // navigation, would otherwise all run before the next page shows (a
  // returning visit, its chunk in the cache, waited ~600 ms). The picture it
  // stands behind stays, so nothing moves. Before its chunk arrives there is
  // nothing queued, and the click is not made to render the page again
  const go = (to: string) => {
    if (previewArrived && live && preview === 'loading') flushSync(() => setPreview('left'));
    navigate(to);
  };

  return (
    <main className="landing" data-testid="landing">
      {!(live && preview === 'shown') && <LandingPicture />}
      {live && !held && (
        <ChunkBoundary canvas onFail={() => setPreview('failed')}>
          <React.Suspense fallback={null}>
            <LandingPreview onShown={onShown} />
          </React.Suspense>
        </ChunkBoundary>
      )}
      <p className="sr-only">
        {live
          ? 'Preview: games play themselves on the five-level tower, each to checkmate.'
          : 'Preview: the five-level tower, every piece on its starting square.'}
      </p>
      <div className="landing-scrim" aria-hidden="true" />
      <div className="landing-menu">
        <header className="landing-head">
          <h1>
            <span>3D</span> <span>Chess</span>
          </h1>
        </header>
        <div className="landing-foot">
          <button ref={tileRim} className="landing-mode" onClick={() => go('/new')}>
            <span className="landing-mode-icon" aria-hidden>
              <span className="landing-face">
                <PieceGlyph type={PieceType.Knight} color="white" size={24} />
              </span>
              <PieceGlyph type={PieceType.Knight} color="black" size={24} />
            </span>
            <span className="landing-label">Play a friend</span>
          </button>
          <button ref={tileRim} className="landing-mode" onClick={() => go('/computer')}>
            <span className="landing-mode-icon landing-mode-icon-wide" aria-hidden>
              <span className="landing-face">
                <PieceGlyph type={PieceType.Knight} color="white" size={24} />
              </span>
              {/* The computer, across the board from the player's knight */}
              <BotGlyph className="landing-bot" />
            </span>
            <span className="landing-label">Play the computer</span>
          </button>
        </div>
        <button
          className="button-secondary landing-learn"
          onClick={() => go('/learn')}
          // The tutorial's page is a chunk of its own: asked for on the way to the button
          onPointerEnter={learnScreen.preload}
          onFocus={learnScreen.preload}
        >
          <span className="caps">How to play</span>
        </button>
      </div>
    </main>
  );
};

export default StartScreen;
