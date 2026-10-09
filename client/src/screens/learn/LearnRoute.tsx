import React from 'react';
import { useNavigate } from 'react-router';
import { ChunkBoundary } from '../../components/ChunkBoundary';
import { learnScreen } from './learnChunk';

/**
 * The tutorial's page (/learn), a chunk of its own: the start page and a
 * game's page carry none of it. Should it fail to load, the page says so.
 */
const LearnRoute = () => {
  const [failed, setFailed] = React.useState(false);
  const navigate = useNavigate();
  const LearnScreen = learnScreen.Component;
  if (failed) {
    return (
      <main className="lobby" data-testid="learn-failed">
        <header className="lobby-top">
          <button className="lobby-link" onClick={() => navigate('/')}>
            <span aria-hidden>←</span> Home
          </button>
        </header>
        <div className="lobby-heading">
          <p role="alert">Couldn't load the tutorial.</p>
        </div>
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
