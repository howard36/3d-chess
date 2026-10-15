import React from 'react';
import { useNavigate } from 'react-router';
import { prefersReducedMotion } from '../three/motion';
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
const { Component: LandingPreview } = lazyChunk(() =>
  import('./LandingPreview').then((m) => ({ default: m.LandingPreview })),
);

// The home page: the tower playing a game by itself, and the ways in. A game
// with a friend starts by choosing a side (/new), which asks the server for
// it; a game against the computer by choosing a side and a level (/computer).
const StartScreen: React.FC = () => {
  const navigate = useNavigate();
  const still = useReducedMotion();
  // The live preview: loading (the picture showing), shown over the picture
  // (which then goes), or failed to load (the picture stays)
  const [preview, setPreview] = React.useState<'loading' | 'shown' | 'failed'>('loading');
  // Motion turned back on brings a new preview, which fades in over the picture again
  const [wasStill, setWasStill] = React.useState(still);
  if (wasStill !== still) {
    setWasStill(still);
    if (preview === 'shown') setPreview('loading');
  }
  const live = !still && preview !== 'failed';
  const onShown = React.useCallback(() => setPreview('shown'), []);

  return (
    <main className="landing" data-testid="landing">
      {!(live && preview === 'shown') && <LandingPicture />}
      {live && (
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
          <button ref={tileRim} className="landing-mode" onClick={() => navigate('/new')}>
            <span className="landing-mode-icon" aria-hidden>
              <span className="landing-face">
                <PieceGlyph type={PieceType.Knight} color="white" size={24} />
              </span>
              <PieceGlyph type={PieceType.Knight} color="black" size={24} />
            </span>
            <span className="landing-label">Play a friend</span>
          </button>
          <button ref={tileRim} className="landing-mode" onClick={() => navigate('/computer')}>
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
          onClick={() => navigate('/learn')}
          // The tutorial's page is a chunk of its own: asked for on the way to the button
          onPointerEnter={learnScreen.preload}
          onFocus={learnScreen.preload}
        >
          How to play
        </button>
      </div>
    </main>
  );
};

/** Whether the player asked their system for less motion, following a change while the page is open. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(prefersReducedMotion);
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

export default StartScreen;
