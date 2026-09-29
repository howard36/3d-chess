import React from 'react';
import type { GameOver, Turn } from '../game/history';

interface TurnPillProps {
  /** This player's colour. */
  seat: Turn;
  /** The side to move. */
  turn: Turn;
  /** The side to move is in check. */
  inCheck: boolean;
  gameOver: GameOver | null;
  /** Whether the opponent is connected; null until the server has said. */
  opponentOnline: boolean | null;
  /** This page's connection is down: what the pill says may be out of date. */
  stale: boolean;
}

const named = (side: Turn) => (side === 'white' ? 'White' : 'Black');
const other = (side: Turn): Turn => (side === 'white' ? 'black' : 'white');

/** A small disc in an army's material, ringed with light for the side to move. */
export const Stone = ({
  color,
  lit = false,
  absent = false,
  ...rest
}: {
  color: Turn;
  lit?: boolean;
  absent?: boolean;
} & React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className="hud-stone"
    data-color={color}
    data-lit={lit || undefined}
    data-absent={absent || undefined}
    {...rest}
  />
);

/** What the pill says, in words, for a screen reader reaching it. */
const describe = ({ seat, turn, inCheck, gameOver, opponentOnline }: TurnPillProps) => {
  const you = `You play ${named(seat)}.`;
  if (gameOver?.result === 'checkmate') {
    return `${you} Checkmate, ${gameOver.winner === seat ? 'you win' : 'you lose'}.`;
  }
  if (gameOver) return `${you} Stalemate, a draw.`;
  const move = turn === seat ? 'Your move' : `${named(turn)} to move`;
  const away = opponentOnline === false ? ' Your opponent is offline.' : '';
  return `${you} ${move}${inCheck ? ', in check' : ''}.${away}`;
};

/**
 * The turn, in one pill at the top of the board: you on the left, the
 * opponent on the right, each with their army's stone, and the side to move
 * lit. Once the game is over it gives the result instead. data-turn (while
 * the game is on), data-check, data-result and data-winner are for tests and
 * tools.
 */
const TurnPill: React.FC<TurnPillProps> = (props) => {
  const { seat, turn, inCheck, gameOver, opponentOnline, stale } = props;
  const them = other(seat);
  // The seat, for screen readers (and for tests: data-seat)
  const label = (
    <span className="sr-only" data-testid="seat" data-seat={seat}>
      {describe(props)}
    </span>
  );
  const common = {
    'data-testid': 'turn-indicator',
    'data-turn': gameOver ? undefined : turn,
    'data-check': (!gameOver && inCheck) || undefined,
    'data-result': gameOver?.result,
    'data-winner': gameOver?.winner,
    'data-stale': stale || undefined,
  };
  if (gameOver) {
    const verdict =
      gameOver.result === 'stalemate' ? 'draw' : gameOver.winner === seat ? 'you win' : 'you lose';
    return (
      <div className="hud-pill hud-glass hud-result" {...common}>
        {label}
        <Stone color={gameOver.winner ?? seat} lit aria-hidden />
        <span aria-hidden>
          {gameOver.result === 'stalemate' ? 'Stalemate' : 'Checkmate'}{' '}
          <span className="hud-sub">· {verdict}</span>
        </span>
      </div>
    );
  }
  const mine = turn === seat;
  const away = opponentOnline === false;
  return (
    <div className="hud-pill hud-glass" {...common}>
      {label}
      <span className="hud-half" data-side="me" data-on={mine || undefined} aria-hidden>
        <Stone color={seat} lit={mine} />
        <span>{mine ? 'Your move' : 'You'}</span>
      </span>
      <span className="hud-rule" aria-hidden />
      <span className="hud-half" data-side="them" data-on={!mine || undefined} aria-hidden>
        <span>{away ? 'Offline' : mine ? 'Opponent' : 'Their move'}</span>
        <Stone color={them} lit={!mine} absent={away} />
      </span>
    </div>
  );
};

export default TurnPill;
