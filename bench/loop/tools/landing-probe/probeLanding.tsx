import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '../index.css';
import MoveHistory from '../screens/MoveHistory';
import type { MoveRecord } from '../types/messages';

const SHUFFLE: MoveRecord[] = [
  { by: 'white', from: 'Ab1', to: 'Aa3' },
  { by: 'black', from: 'Ed5', to: 'Ee3' },
  { by: 'white', from: 'Aa3', to: 'Ab1' },
  { by: 'black', from: 'Ee3', to: 'Ed5' },
];
const rec = (n: number) => Array.from({ length: n }, (_, i) => ({ ...SHUFFLE[i % 4] }));
const N = Number(new URLSearchParams(location.search).get('n') ?? 2000);
let setMoves: (m: MoveRecord[]) => void = () => {};
const App = () => {
  const [moves, set] = React.useState(() => rec(N));
  setMoves = set;
  return (
    <div className="game-screen" style={{ position: 'fixed', inset: 0 }}>
      <div className="hud">
        <div className="hud-side">
          <MoveHistory moves={moves} applied={moves.length} shown={moves.length} newer={false} onShow={() => {}} enabled />
        </div>
      </div>
    </div>
  );
};
createRoot(document.getElementById('root')!).render(<App />);
let current = rec(N);
(window as any).__land = () => {
  const next = [...current, { ...SHUFFLE[current.length % 4] }];
  current = next;
  const t0 = performance.now();
  flushSync(() => setMoves(next));
  const t1 = performance.now();
  // what the frame would cost after: a forced style + layout
  document.body.getBoundingClientRect();
  void document.querySelector('.hud-moves')!.scrollHeight;
  const t2 = performance.now();
  return [t1 - t0, t2 - t1];
};
