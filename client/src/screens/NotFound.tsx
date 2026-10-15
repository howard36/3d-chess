import { useNavigate } from 'react-router';
import { PlayButton } from './PlayButton';
import { autoFocusRef } from '../lib/focus';

// Any address the app has no page for (a mistyped one, /game/ with no game):
// the lobby's heading on the page's night, and the way home under it, with
// no card round the two. No scene: it stays out of three.js's chunk.
const NotFound = () => {
  const navigate = useNavigate();
  return (
    <main className="lobby lost" data-testid="not-found">
      <section className="lobby-heading" aria-labelledby="not-found-title">
        <h1 id="not-found-title">Nothing here</h1>
        <div className="lobby-actions">
          <PlayButton ref={autoFocusRef} onClick={() => navigate('/')}>
            Home
          </PlayButton>
        </div>
      </section>
    </main>
  );
};

export default NotFound;
