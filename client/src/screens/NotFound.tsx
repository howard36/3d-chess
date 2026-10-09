import { useNavigate } from 'react-router-dom';

// Any address the app has no page for (a mistyped one, /game/ with no game):
// the lobby's card on the page's night, and the way home. No scene: it
// stays out of three.js's chunk.
const NotFound = () => {
  const navigate = useNavigate();
  return (
    <main className="lobby lost" data-testid="not-found">
      <section className="lobby-card lobby-glass" aria-labelledby="not-found-title">
        <h1 id="not-found-title">Nothing here</h1>
        <div className="lobby-actions">
          <button autoFocus className="landing-play lobby-go" onClick={() => navigate('/')}>
            Home
          </button>
        </div>
      </section>
    </main>
  );
};

export default NotFound;
