// For review only (never merged): a menu over the start page that plays one
// demo game from its start (`/?game=N`), then the rest in turn, and opens the
// chosen game in the game's own review.
import { chosenGame } from './demoChoice';
import { saveComputerGame } from '../lib/computerGames';
import { setStoredRole } from '../lib/playerRole';
import type { MoveRecord } from '../types/messages';

const GAMES = [
  '900 · White · 89',
  '952 · Black · 110',
  '107 · White · 129',
  '416 · Black · 158',
  '284 · White · 161',
];

const control: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: 8,
  font: '12px/1.2 system-ui, sans-serif',
  color: '#fff',
  background: 'rgba(20, 24, 40, 0.8)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
};

/** Stores demo game `index` as a finished game against the computer and opens it. */
async function review(index: number) {
  const { demoLog, DEMO_GAMES } = await import('../game/demo');
  const moves: MoveRecord[] = demoLog(index, DEMO_GAMES[index].length).map((m) => {
    const { by, from, to, promotion } = m as MoveRecord & { type: string };
    return { by, from, to, ...(promotion ? { promotion } : {}) };
  });
  const id = `review${GAMES[index].split(' ')[0]}`;
  saveComputerGame({ id, color: 'white', difficulty: 'hard', started: true, moves });
  setStoredRole(id, 'white');
  window.location.assign(`/computer/${id}`);
}

export function DemoPicker() {
  const chosen = chosenGame(GAMES.length);
  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        right: 10,
        zIndex: 50,
        display: 'flex',
        gap: 6,
        maxWidth: 'calc(100vw - 20px)',
      }}
    >
      <select
        aria-label="Demo game"
        value={chosen === null ? '' : String(chosen + 1)}
        // A full load, so the preview starts afresh on the game
        onChange={(e) => window.location.assign(e.target.value ? `/?game=${e.target.value}` : '/')}
        style={{ ...control, maxWidth: 150 }}
      >
        <option value="">Random order</option>
        {GAMES.map((label, i) => (
          <option key={label} value={String(i + 1)}>
            {i + 1}. {label}
          </option>
        ))}
      </select>
      {chosen !== null && (
        <button
          type="button"
          style={{ ...control, cursor: 'pointer' }}
          onClick={() => void review(chosen)}
        >
          Review
        </button>
      )}
    </div>
  );
}
