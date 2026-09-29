import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Turn } from '../game/history';
import { Stone } from './TurnPill';

interface EndGameModalProps {
  result: 'checkmate' | 'stalemate';
  winner?: Turn;
  /** This player's colour: the result is said to them. */
  seat: Turn;
}

/**
 * The result, over the final position: "You win" or "You lose" by checkmate,
 * or a draw by stalemate, with the winner's stone lit. Its one button, which
 * has focus, starts another game: the side choice.
 */
const EndGameModal: React.FC<EndGameModalProps> = ({ result, winner, seat }) => {
  const navigate = useNavigate();
  const title = result === 'stalemate' ? 'Draw' : winner === seat ? 'You win' : 'You lose';
  return (
    <div className="hud-veil" style={{ zIndex: 1000 }}>
      <div
        className="hud-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-game-title"
        aria-describedby="end-game-how"
        data-testid="end-game"
        data-result={result}
        data-winner={winner}
        style={{ padding: '22px 44px 20px' }}
      >
        <div className="hud-pair" aria-hidden>
          <Stone color="white" lit={winner === 'white'} />
          <Stone color="black" lit={winner === 'black'} />
        </div>
        <h2 id="end-game-title">{title}</h2>
        <p id="end-game-how" style={{ marginTop: 4 }}>
          {result === 'stalemate' ? 'by stalemate' : 'by checkmate'}
        </p>
        {/* The dialog takes focus: a keyboard player lands on its only action */}
        <button autoFocus className="hud-button" onClick={() => navigate('/new')}>
          Start new game
        </button>
      </div>
    </div>
  );
};

export default EndGameModal;
