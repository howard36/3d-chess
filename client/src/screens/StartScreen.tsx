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
  const [paused, setPaused] = React.useState(false);
  const still = useReducedMotion();
  // The preview's game stands finished: the slot names the result
  const [demoEnded, setDemoEnded] = React.useState(false);

  // One line under the button: the preview's result while its mate stands
  // (the mated king is small, far up the tower), else nothing. One slot,
  // kept open when empty so the button never moves.
  let note: React.ReactNode = null;
  if (demoEnded && !still) {
    // Part of the preview, which the page's text description already tells
    // (held still, the preview always shows the mate: nothing to announce)
    note = (
      <p key="result" className="landing-note landing-facts landing-result" aria-hidden="true">
        Checkmate · White wins
      </p>
    );
  }

  return (
    <main className="landing" data-testid="landing">
      <LandingPreview paused={paused} still={still} onEnded={setDemoEnded} />
      <p className="sr-only">
        Preview: a sample game plays itself on the five-level tower and ends in checkmate by White.
      </p>
      <div className="landing-scrim" aria-hidden="true" />
      <header className="landing-head">
        <h1>3D Chess</h1>
      </header>
      <div className="landing-foot">
        {/* A new game starts by choosing a side (/new), which asks the
            server for it */}
        <button className="landing-play" onClick={() => navigate('/new')}>
          <span className="landing-play-piece" aria-hidden>
            <PieceGlyph type={PieceType.Knight} color="black" size={24} />
          </span>
          Start a game
        </button>
        <div className="landing-slot">{note}</div>
      </div>
      {/* The preview moves on its own for more than five seconds, beside the
          page's controls: it can be stopped (nothing moves for a player who
          asked for less motion, so there is nothing to stop) */}
      {!still && (
        <button
          className="landing-pause hud-glass"
          aria-label="Pause preview"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="3.5" y="2.8" width="3" height="10.4" rx="0.6" fill="currentColor" />
              <rect x="9.5" y="2.8" width="3" height="10.4" rx="0.6" fill="currentColor" />
            </svg>
          )}
        </button>
      )}
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
