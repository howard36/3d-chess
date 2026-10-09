import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameOver, Turn } from '../game/history';
import { DRAW_BY, isDecisive, resultWords } from '../game/announce';
import { Stone } from './TurnPill';

interface EndGameModalProps {
  result: GameOver['result'];
  winner?: Turn;
  /** This player's colour: the result is said to them. */
  seat: Turn;
  /** Puts the card away, leaving the final board to study (Escape and a click outside it too). */
  onClose: () => void;
  /** Where "Play again" leads: the same kind of game's side choice (/new by default). */
  newGamePath?: string;
}

/**
 * The result, over the final position: "You win" or "You lose" by checkmate
 * or a resignation ("White resigned"), or a draw (by stalemate, repetition,
 * the 50-move rule or agreement), with the winner's stone lit. Its button, which has
 * focus, starts another game of the same kind: its side choice. It can be closed (its close
 * button, Escape, a click outside it) to study the final board, which keeps
 * that button below the tower (NewGameBar).
 */
const EndGameModal: React.FC<EndGameModalProps> = ({
  result,
  winner,
  seat,
  onClose,
  newGamePath = '/new',
}) => {
  const navigate = useNavigate();
  const title = !isDecisive(result) ? 'Draw' : winner === seat ? 'You win' : 'You lose';
  // How: "by checkmate", "White resigned", "by agreement"
  const how = !isDecisive(result)
    ? DRAW_BY[result]
    : result === 'resignation'
      ? resultWords({ result, winner }, seat).how
      : 'by checkmate';
  return (
    <div
      className="hud-veil"
      style={{ zIndex: 1000 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="hud-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-game-title"
        aria-describedby="end-game-how"
        data-testid="end-game"
        data-result={result}
        data-winner={winner}
        style={{ position: 'relative', padding: '22px 44px 20px' }}
      >
        <button className="hud-close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="hud-pair" aria-hidden>
          <Stone color="white" lit={winner === 'white'} />
          <Stone color="black" lit={winner === 'black'} />
        </div>
        <h2 id="end-game-title">{title}</h2>
        <p id="end-game-how" style={{ marginTop: 4 }}>
          {how}
        </p>
        {/* The dialog takes focus: a keyboard player lands on its only action */}
        <button
          autoFocus
          className="landing-play lobby-go hud-result-go"
          onClick={() => navigate(newGamePath)}
        >
          Play again
        </button>
      </div>
    </div>
  );
};

export default EndGameModal;

/** Play again, below the tower, once the result card has been put away. */
export const NewGameBar: React.FC<{ newGamePath?: string }> = ({ newGamePath = '/new' }) => {
  const navigate = useNavigate();
  return (
    <div className="hud-new-game">
      <button className="landing-play lobby-go" onClick={() => navigate(newGamePath)}>
        Play again
      </button>
    </div>
  );
};
