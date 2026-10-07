import React from 'react';
import { useNavigate } from 'react-router-dom';
import { prefersReducedMotion } from '../three/motion';
import { lazyChunk } from '../lib/cachedImport';
import { ChunkBoundary } from '../components/ChunkBoundary';
import { PieceGlyph } from './PieceGlyph';
import { PieceType } from '../engine/pieces';
import { learnScreen } from './learn/learnChunk';

// The preview (three.js, the scene, a demo game) is a chunk of its own,
// asked for when the page first draws, so its title and button show without
// waiting for it; the preview appears where it stands once it has loaded, and should
// it fail to, the page goes without it
const { Component: LandingPreview } = lazyChunk(() =>
  import('./LandingPreview').then((m) => ({ default: m.LandingPreview })),
);

// The home page: the tower playing a game by itself, and the ways in. A game
// with a friend starts by choosing a side (/new), which asks the server for
// it; a game against the computer by choosing a side and a level (/computer).
const StartScreen: React.FC = () => {
  const navigate = useNavigate();
  const still = useReducedMotion();
  const [noPreview, setNoPreview] = React.useState(false);

  return (
    <main className="landing" data-testid="landing">
      <ChunkBoundary onFail={() => setNoPreview(true)}>
        <React.Suspense fallback={null}>
          <LandingPreview still={still} />
        </React.Suspense>
      </ChunkBoundary>
      {!noPreview && (
        <p className="sr-only">
          Preview: a sample game plays itself on the five-level tower and ends in checkmate by
          White.
        </p>
      )}
      <div className="landing-scrim" aria-hidden="true" />
      <div className="landing-menu">
        <header className="landing-head">
          <h1>
            <span>3D</span> <span>Chess</span>
          </h1>
        </header>
        <div className="landing-foot">
          <button className="landing-mode" onClick={() => navigate('/new')}>
            <span className="landing-mode-icon" aria-hidden>
              <span className="landing-face">
                <PieceGlyph type={PieceType.Knight} color="white" size={24} />
              </span>
              <PieceGlyph type={PieceType.Knight} color="black" size={24} />
            </span>
            <span className="landing-label">Play a friend</span>
          </button>
          <button className="landing-mode" onClick={() => navigate('/computer')}>
            <span className="landing-mode-icon" aria-hidden>
              <span className="landing-face">
                <PieceGlyph type={PieceType.Knight} color="white" size={24} />
              </span>
              <Chip />
            </span>
            <span className="landing-label">Play the computer</span>
          </button>
        </div>
        <button
          className="landing-learn"
          onClick={() => navigate('/learn')}
          // The tutorial's page is a chunk of its own: asked for on the way to the button
          onPointerEnter={learnScreen.preload}
          onFocus={learnScreen.preload}
        >
          <span className="landing-label">How to play</span>
        </button>
      </div>
    </main>
  );
};

/** The computer, across the board from the player's knight: a chip, in line with the glyphs. */
const Chip = () => (
  <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" aria-hidden>
    <rect x="6" y="6" width="12" height="12" rx="2" strokeWidth={1.6} />
    <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" strokeWidth={1.2} />
    <path
      d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"
      strokeWidth={1.4}
      strokeLinecap="round"
    />
  </svg>
);

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
