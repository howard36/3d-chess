import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameCreated, Error as ServerError } from '../../types/messages';
import type { GameSocket } from '../../hooks/useGameSocket';
import { useResendOnReconnect } from '../../hooks/useResendOnReconnect';
import { getClientId } from '../../lib/clientId';
import { setStoredRole } from '../../lib/playerRole';
import type { Choice } from '../../three/lobby/LobbyScene';
import type { Side } from '../../three/lobby/lobbyMotion';
import { useLobbyView } from './lobbyContext';

// The first page of a new game: the player picks a side. The three kings
// stand on the glass (LobbyScene): porcelain, the split king for Random, and
// charcoal; a button under each says what it is. A pick is final at once:
// the game is asked for straight away, while the pick plays out on the glass
// (the coin toss for Random is decided here, before it is thrown, so it can
// land on the side the server will give), and the page moves on to the game's
// own page, the invitation, once both the answer and the moment are over.

const CHOICES: { choice: Choice; name: string; note: string }[] = [
  { choice: 'white', name: 'White', note: 'Moves first' },
  { choice: 'random', name: 'Random', note: 'Let chance decide' },
  { choice: 'black', name: 'Black', note: 'Moves second' },
];

// Until the scene has placed the kings on screen
const FALLBACK_X = { white: '25%', coin: '50%', black: '75%' };

const other = (side: Side): Side => (side === 'white' ? 'black' : 'white');

const ChooseSide: React.FC<{ gameSocket: GameSocket }> = ({ gameSocket }) => {
  const navigate = useNavigate();
  const { messages, status } = gameSocket;
  const [hover, setHover] = React.useState<Choice | null>(null);
  const [picked, setPicked] = React.useState<{ choice: Choice; side: Side } | null>(null);
  const [settled, setSettled] = React.useState(false);
  // Where in the log this page asked for its game: only what follows answers
  // it (arriving from a finished game, the log still holds that game's
  // game_created for the first render; see StartScreen's history)
  const [requestIndex, setRequestIndex] = React.useState<number | null>(null);
  const replies = requestIndex === null ? [] : messages.slice(requestIndex);
  const created = replies.find((m): m is GameCreated => m.type === 'game_created');
  const errors = replies.filter((m): m is ServerError => m.type === 'error');
  const failed = errors.length > 0 ? errors[errors.length - 1] : null;

  // A refusal puts the kings back and lets the player choose again
  React.useEffect(() => {
    if (failed && !created) {
      setPicked(null);
      setSettled(false);
    }
  }, [failed, created]);

  React.useEffect(() => {
    if (created) setStoredRole(created.gameId, created.color);
    if (created && settled) navigate(`/game/${created.gameId}`, { replace: true });
  }, [created, settled, navigate]);

  // Asked again on the next connection if this one drops before the answer
  const requestGame = useResendOnReconnect(gameSocket, !picked || !!created || !!failed);

  const pick = (choice: Choice) => {
    if (picked) return;
    const side: Side = choice === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : choice;
    setPicked({ choice, side });
    setHover(null);
    setRequestIndex(messages.length);
    requestGame({ type: 'create_game', clientId: getClientId(), color: side });
  };

  const side = picked?.side ?? null;
  useLobbyView({
    beat: 'choose',
    taken: side
      ? ({ [side]: true, [other(side)]: false } as Record<Side, boolean>)
      : {
          white: true,
          black: true,
        },
    mine: side,
    hover: picked ? null : hover,
    toss: picked?.choice === 'random' ? picked.side : null,
    seat: side ?? 'white',
    onHover: (c) => !picked && setHover(c),
    onPick: pick,
    onSettled: () => setSettled(true),
  });

  const waiting = settled && !created && !failed;
  const heading = !picked
    ? 'Choose your side'
    : picked.choice === 'random'
      ? 'Leaving it to chance…'
      : `You play ${picked.side === 'white' ? 'White' : 'Black'}`;
  const subheading = !picked
    ? 'Then send a friend the link to take the other side.'
    : 'Setting the board…';
  return (
    <div className="lobby-page" data-testid="choose-side">
      <header className="lobby-top">
        <button className="lobby-link" onClick={() => navigate('/')}>
          <span aria-hidden>←</span> Home
        </button>
      </header>
      {/* The heading answers the pick at once; keyed, so each line fades in */}
      <div className="lobby-heading" key={heading}>
        <h1>{heading}</h1>
        <p>{subheading}</p>
      </div>
      <div className="lobby-choices" role="group" aria-label="Choose your side">
        {CHOICES.map(({ choice, name, note }) => {
          const seat = choice === 'random' ? 'coin' : choice;
          const chosen = picked?.choice === choice;
          return (
            <button
              key={choice}
              className="lobby-choice"
              data-choice={choice}
              data-chosen={chosen ? '' : undefined}
              data-faded={picked && !chosen ? '' : undefined}
              disabled={!!picked}
              aria-pressed={chosen}
              style={
                {
                  '--x': `var(--seat-${seat}-x, ${FALLBACK_X[seat]})`,
                  '--y': `var(--seat-${seat}-foot, 62%)`,
                } as React.CSSProperties
              }
              onPointerEnter={() => !picked && setHover(choice)}
              onPointerLeave={() => setHover((h) => (h === choice ? null : h))}
              onFocus={() => !picked && setHover(choice)}
              onBlur={() => setHover((h) => (h === choice ? null : h))}
              onClick={() => pick(choice)}
            >
              <span className="lobby-choice-name">{name}</span>
              <span className="lobby-choice-note">{note}</span>
            </button>
          );
        })}
      </div>
      <div className="lobby-foot" role="status">
        {failed && !created ? (
          <span className="lobby-error">Couldn't start a game: {failed.message}</span>
        ) : status === 'reconnecting' ? (
          'Reconnecting to the server…'
        ) : status !== 'connected' && !picked ? (
          'Connecting to the server…'
        ) : waiting ? (
          'Waiting for the server…'
        ) : (
          ''
        )}
      </div>
    </div>
  );
};

export default ChooseSide;
