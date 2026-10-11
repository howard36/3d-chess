import { createRoot } from 'react-dom/client';
import '../index.css';
import MoveHistory from '../screens/MoveHistory';
import type { MoveRecord } from '../types/messages';

const SHUFFLE: MoveRecord[] = [
  { by: 'white', from: 'Ab1', to: 'Aa3' },
  { by: 'black', from: 'Ed5', to: 'Ee3' },
  { by: 'white', from: 'Aa3', to: 'Ab1' },
  { by: 'black', from: 'Ee3', to: 'Ed5' },
];
const moves = Array.from({ length: 40 }, (_, i) => ({ ...SHUFFLE[i % 4] }));
const shown = Number(new URLSearchParams(location.search).get('shown') ?? 40);
createRoot(document.getElementById('root')!).render(
  <div className="game-screen" style={{ position: 'fixed', inset: 0 }}>
    <div className="hud">
      <div className="hud-side">
        <MoveHistory moves={moves} applied={40} shown={shown} newer={false} onShow={() => {}} enabled />
      </div>
    </div>
  </div>,
);
