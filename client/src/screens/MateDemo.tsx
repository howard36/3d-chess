import React from 'react';
import { deriveHistory } from '../game/history';
import type { GameHistory } from '../game/history';
import type { MoveRecord, WebSocketMessage } from '../types/messages';
import GameView from './GameView';
import { setMateTuning, useMateTuning } from '../lib/mateTuning';
import { useEndCard } from './useEndCard';

// A short game that ends in mate by White (scripts/showcase.mjs plays it too)
const GAME = [
  'Ab2-De5 Ed4-Ba1',
  'Ac2-Cc4 Dc4-Dc3',
  'Ad2-Dd5 Ec4-Dd5',
  'Aa1-Ba1 Dd5-Db3',
  'Cc4-Db3 Db4-Cb4',
  'Ad1-Cd2 Dc3-Cc3',
  'Aa2-Da5 Eb4-Ed2',
  'Da5-Db4 Ed2-Cb2',
  'Db3-Ec4',
]
  .join(' ')
  .split(' ')
  .map((m, i): MoveRecord => {
    const [from, to] = m.split('-');
    return { by: i % 2 === 0 ? 'white' : 'black', from, to };
  });
const BEFORE_MATE = GAME.length - 1;

// One snapshot per length of the record, made once, so the replay of the
// same record is the same history (deriveHistory compares by identity)
const snapshots = new Map<number, WebSocketMessage[]>();
const messagesAt = (plies: number) => {
  let messages = snapshots.get(plies);
  if (!messages) {
    messages = [{ type: 'game_state', color: 'white', started: true, moves: GAME.slice(0, plies) }];
    snapshots.set(plies, messages);
  }
  return messages;
};

/**
 * The mate preview (/mate): a game one move from mate, seen from White's
 * seat, with buttons that play the mating move and the mate (again) and
 * go back to the move before it, and sliders for its timings
 * (lib/mateTuning.ts), to look at how a mate plays out and tune it.
 * Nothing goes to the server: the board takes no input.
 */
const MateDemo: React.FC = () => {
  const [plies, setPlies] = React.useState(BEFORE_MATE);
  const [played, setPlayed] = React.useState(false);
  const historyRef = React.useRef<GameHistory | null>(null);
  const history = deriveHistory(messagesAt(plies), historyRef.current);
  historyRef.current = history;
  const showEndModal = useEndCard(history.gameOver, played);

  const tuning = useMateTuning();
  // Back to the move before mate
  const reset = () => {
    setPlies(BEFORE_MATE);
    setPlayed(false);
  };
  // Back to the move before mate for a frame, then the mate again
  const play = () => {
    setPlies(BEFORE_MATE);
    setPlayed(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setPlies(GAME.length)));
  };

  return (
    <>
      <GameView
        history={history}
        color="white"
        opponentOnline={true}
        reconnecting={false}
        boardDisabled={true}
        onMove={() => {}}
        promotionChoices={null}
        onChoosePromotion={() => {}}
        showEndModal={showEndModal}
        replaced={false}
        intro="short"
      />
      <div className="hud-glass mate-demo" data-testid="mate-demo">
        <button type="button" className="hud-retry" onClick={play}>
          Play
        </button>
        <button type="button" className="hud-retry" onClick={reset}>
          Reset
        </button>
        <label>
          Knock lead <output>{tuning.knockLeadMs} ms</output>
          <input
            type="range"
            min={0}
            max={250}
            step={5}
            value={tuning.knockLeadMs}
            onChange={(e) => setMateTuning({ knockLeadMs: Number(e.target.value) })}
          />
        </label>
        <label>
          Pulse speed <output>{tuning.pulseSpeed.toFixed(1)}</output>
          <input
            type="range"
            min={2}
            max={8}
            step={0.1}
            value={tuning.pulseSpeed}
            onChange={(e) => setMateTuning({ pulseSpeed: Number(e.target.value) })}
          />
        </label>
        <label>
          Wave speed <output>{tuning.waveSpeed}</output>
          <input
            type="range"
            min={4}
            max={30}
            step={1}
            value={tuning.waveSpeed}
            onChange={(e) => setMateTuning({ waveSpeed: Number(e.target.value) })}
          />
        </label>
        <label>
          Wave delay <output>{tuning.waveDelayMs} ms</output>
          <input
            type="range"
            min={0}
            max={600}
            step={10}
            value={tuning.waveDelayMs}
            onChange={(e) => setMateTuning({ waveDelayMs: Number(e.target.value) })}
          />
        </label>
      </div>
    </>
  );
};

export default MateDemo;
