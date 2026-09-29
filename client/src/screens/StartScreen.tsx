import React from 'react';
import { useNavigate } from 'react-router-dom';
import { prefersReducedMotion } from '../three/motion';
import { LandingPreview } from './LandingPreview';
import { PieceGlyph } from './PieceGlyph';
import { PieceType } from '../engine/pieces';

// The home page: the tower playing a game by itself, and the way in. A new
// game starts by choosing a side (/new), which asks the server for it.
const StartScreen: React.FC = () => {
  const navigate = useNavigate();
  const still = useReducedMotion();

  return (
    <main className="landing" data-testid="landing">
      <LandingPreview still={still} />
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
