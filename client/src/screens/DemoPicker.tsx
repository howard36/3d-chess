// For review only (never merged): a menu over the start page that plays one
// demo game from its start (`/?game=N`), then the rest in turn.
import { chosenGame } from './demoChoice';

const GAMES = [
  '900 · White · 89',
  '952 · Black · 110',
  '107 · White · 129',
  '303 · Black · 124',
  '961 · White · 147',
  '416 · Black · 158',
  '284 · White · 161',
];

export function DemoPicker() {
  const chosen = chosenGame(GAMES.length);
  return (
    <select
      aria-label="Demo game"
      value={chosen === null ? '' : String(chosen + 1)}
      // A full load, so the preview starts afresh on the game
      onChange={(e) => window.location.assign(e.target.value ? `/?game=${e.target.value}` : '/')}
      style={{
        position: 'fixed',
        top: 10,
        right: 10,
        zIndex: 50,
        maxWidth: 150,
        padding: '5px 6px',
        borderRadius: 8,
        font: '12px/1.2 system-ui, sans-serif',
        color: '#fff',
        background: 'rgba(20, 24, 40, 0.8)',
        border: '1px solid rgba(255, 255, 255, 0.3)',
      }}
    >
      <option value="">Random order</option>
      {GAMES.map((label, i) => (
        <option key={label} value={String(i + 1)}>
          {i + 1}. {label}
        </option>
      ))}
    </select>
  );
}
