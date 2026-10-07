import React from 'react';
import { useNavigate } from 'react-router-dom';
import { prefersReducedMotion } from '../three/motion';
import { lazyChunk } from '../lib/cachedImport';
import { ChunkBoundary } from '../components/ChunkBoundary';
import { CHARCOAL, CHARCOAL_EDGE, PieceGlyph } from './PieceGlyph';
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
              <Bot />
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

/**
 * The computer, across the board from the player's knight: a robot's head
 * in Black's charcoal (PieceGlyph's), its face a dark screen with two pale
 * eyes. One gradient over the whole head (in the glyph's own space), so the
 * head, ears and antenna are lit as one piece.
 */
const Bot = () => {
  const id = `bot-${React.useId().replace(/[^\w-]/g, '')}`;
  const fill = `url(#${id})`;
  const edge = { stroke: CHARCOAL_EDGE, strokeWidth: 0.8, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden>
      <defs>
        <radialGradient id={id} gradientUnits="userSpaceOnUse" cx="8.2" cy="6.7" r="21.6">
          {CHARCOAL.map(([offset, stopColor]) => (
            <stop key={offset} offset={offset} stopColor={stopColor} />
          ))}
        </radialGradient>
      </defs>
      <path d="M12 7.6V5.2" stroke={fill} strokeWidth={1.2} strokeLinecap="round" />
      <circle cx="12" cy="4.3" r="1.3" fill={fill} {...edge} />
      <rect x="2.3" y="10.7" width="2.9" height="5.6" rx="1.2" fill={fill} {...edge} />
      <rect x="18.8" y="10.7" width="2.9" height="5.6" rx="1.2" fill={fill} {...edge} />
      <rect x="4.5" y="7.6" width="15" height="11.8" rx="3.6" fill={fill} {...edge} />
      <rect
        x="6.1"
        y="9.3"
        width="11.8"
        height="8.4"
        rx="2.2"
        fill="#0d0f15"
        stroke="rgba(150,162,184,0.45)"
        strokeWidth={0.5}
      />
      <rect x="8.75" y="11.3" width="1.9" height="3.6" rx="0.95" fill="rgba(214,222,236,0.92)" />
      <rect x="13.35" y="11.3" width="1.9" height="3.6" rx="0.95" fill="rgba(214,222,236,0.92)" />
    </svg>
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
