import React from 'react';
import { Arrow } from '../Arrow';
import { useNavigate } from 'react-router';
import { ChunkBoundary } from '../../components/ChunkBoundary';
import { learnScreen } from './learnChunk';
import { reloadPage } from '../../lib/cachedImport';

/**
 * The tutorial's page (/learn), a chunk of its own: the start page and a
 * game's page carry none of it. Should it fail to load, the page says so,
 * with a way to try again, as a game's page does (App.tsx, ChunkFailed).
 */
const LearnRoute = () => {
  const [failed, setFailed] = React.useState(false);
  const navigate = useNavigate();
  const LearnScreen = learnScreen.Component;
  if (failed) {
    return (
      <main className="lobby" data-testid="learn-failed">
        <header className="lobby-top">
          <button className="button-link" onClick={() => navigate('/')}>
            <Arrow to="left" />
            <span className="caps">Home</span>
          </button>
        </header>
        <div className="lobby-heading">
          <p role="alert">Couldn't load the tutorial.</p>
        </div>
        <p className="lobby-foot">
          <button className="button-secondary button-small" onClick={reloadPage}>
            <span className="caps">Retry</span>
          </button>
        </p>
      </main>
    );
  }
  return (
    <ChunkBoundary onFail={() => setFailed(true)}>
      <React.Suspense fallback={null}>
        <LearnScreen />
      </React.Suspense>
    </ChunkBoundary>
  );
};

export default LearnRoute;
