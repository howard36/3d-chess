import React from 'react';
import { useNavigate } from 'react-router';
import type { GameOver, Turn } from '../game/history';
import type { RematchState } from '../game/ending';
import { DRAW_BY, isDecisive, resultWords } from '../game/announce';
import { Stone } from './TurnPill';
import { PlayButton } from './PlayButton';
import { autoFocusRef } from '../lib/focus';

/** The rematch: against a friend, offered between the players; against the computer, at once. */
export interface RematchProps {
  state: RematchState;
  /** This player's colour. */
  seat: Turn;
  /** Nothing can be sent (disconnected, not yet back in the game, another tab has the seat). */
  disabled: boolean;
  /** Offers a rematch (against the computer, starts it). */
  onOffer: () => void;
  onAnswer: (accept: boolean) => void;
  /** Opens the rematch's game. */
  onJoin: () => void;
}

interface EndGameModalProps {
  result: GameOver['result'];
  winner?: Turn;
  /** This player's colour: the result is said to them. */
  seat: Turn;
  /** Puts the card away, leaving the final board to study (Escape and a click outside it too). */
  onClose: () => void;
  /** The rematch and the way home (none until the page knows its seat). */
  rematch?: RematchProps;
}

/**
 * The result, over the final position: "You win" or "You lose" by checkmate
 * or a resignation ("White resigned"), or a draw (by stalemate, repetition,
 * the 50-move rule or agreement), with the winner's stone lit. Its call to
 * action, which has focus, is the rematch, with the way home under it
 * (Rematch). It can be closed (its close button, Escape, a click outside it)
 * to study the final board, which keeps its buttons below the tower
 * (RematchBar).
 */
const EndGameModal: React.FC<EndGameModalProps> = ({ result, winner, seat, onClose, rematch }) => {
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
        <button className="button-icon hud-close" aria-label="Close" onClick={onClose}>
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
        {rematch && <Rematch {...rematch} />}
      </div>
    </div>
  );
};

export default EndGameModal;

/** The rematch and the way home, below the tower, once the result card has been put away. */
export const RematchBar: React.FC<{ rematch: RematchProps }> = ({ rematch }) => (
  <div className="hud-new-game">
    <Rematch {...rematch} bar />
  </div>
);

type RematchPhase = 'none' | 'mine' | 'theirs' | 'declined' | 'begun';

/**
 * A game over: the rematch, and the way home. One call to action, which
 * follows the offer: "Rematch"; "Rematch offered" while the player's own
 * waits; "Accept rematch" (with "Decline") for the opponent's; "Join rematch"
 * for one accepted before the page opened. Once the player's own has been
 * declined, "Home" takes its place. The button stays one element throughout,
 * so the focus stays on it as the offer changes. Against the computer it is
 * only ever "Rematch", which starts the game at once.
 */
function Rematch({
  state,
  seat,
  disabled,
  onOffer,
  onAnswer,
  onJoin,
  bar = false,
}: RematchProps & { bar?: boolean }) {
  const navigate = useNavigate();
  const home = () => navigate('/');
  const phase: RematchPhase = state.gameId
    ? 'begun'
    : state.declined === seat
      ? 'declined'
      : !state.standing
        ? 'none'
        : state.standing === seat
          ? 'mine'
          : 'theirs';
  const [label, act] = (
    {
      none: ['Rematch', onOffer],
      mine: ['Rematch offered', null],
      theirs: ['Accept rematch', () => onAnswer(true)],
      declined: ['Home', home],
      begun: ['Join rematch', onJoin],
    } as const
  )[phase];
  // Waiting on the opponent, or on the connection to send: shown, but not pressed
  const waiting = phase === 'mine' || (disabled && phase !== 'declined' && phase !== 'begun');
  return (
    <div className="hud-rematch" data-testid="rematch" data-bar={bar ? '' : undefined}>
      {phase === 'declined' && (
        <p className="hud-rematch-note" data-testid="rematch-declined">
          Rematch declined
        </p>
      )}
      <PlayButton
        // The dialog takes focus: a keyboard player lands on its call to action
        ref={bar ? undefined : autoFocusRef}
        // Its turning rim urges the next game on, not the way home
        rim={phase !== 'declined'}
        className={bar ? undefined : 'hud-result-go'}
        data-testid="rematch-go"
        data-state={phase}
        aria-disabled={waiting || undefined}
        onClick={() => {
          if (!waiting) act?.();
        }}
      >
        {phase === 'mine' && <span className="hud-dot" aria-hidden />}
        {label}
      </PlayButton>
      {phase !== 'declined' && (
        <span className="hud-rematch-other">
          {phase === 'theirs' && (
            <button
              className="button-link"
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (!disabled) onAnswer(false);
              }}
            >
              Decline
            </button>
          )}
          <button className="button-link" onClick={home}>
            Home
          </button>
        </span>
      )}
    </div>
  );
}
