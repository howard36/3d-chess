import React from 'react';
import { useNavigate } from 'react-router-dom';
import { prefersReducedMotion } from '../three/motion';
import { cachedImport } from '../lib/cachedImport';
import { PieceGlyph } from './PieceGlyph';
import { PieceType } from '../engine/pieces';

// The preview (three.js, the scene, a demo game) is a chunk of its own,
// asked for at once, so the page's title and button show without waiting
// for it; the preview appears where it stands once it has loaded
const loadPreview = cachedImport(() => import('./LandingPreview'));
const LandingPreview = React.lazy(() => loadPreview().then((m) => ({ default: m.LandingPreview })));

// The home page: the tower playing a game by itself, and the way in. A new
// game starts by choosing a side (/new), which asks the server for it.
const StartScreen: React.FC = () => {
  const navigate = useNavigate();
  const still = useReducedMotion();

  return (
    <main className="landing" data-testid="landing">
      <React.Suspense fallback={null}>
        <LandingPreview still={still} />
      </React.Suspense>
      <p className="sr-only">
        Preview: a sample game plays itself on the five-level tower and ends in checkmate by White.
      </p>
      <div className="landing-scrim" aria-hidden="true" />
      <header className="landing-head">
        <h1>3D Chess</h1>
      </header>
      <div className="landing-foot">
        <button className="landing-play" onClick={() => navigate('/new')}>
          <span className="landing-play-piece" aria-hidden>
            <PieceGlyph type={PieceType.Knight} color="black" size={24} />
          </span>
          Start a game
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
