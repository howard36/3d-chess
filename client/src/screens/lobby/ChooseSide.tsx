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
import { SLOW_SERVER_MS, useDelayed } from '../../hooks/useDelayed';

// The first page of a new game: the player picks a side. The three kings
// stand on the glass (LobbyScene): porcelain, the split king for Random, and
// charcoal; a button under each says what it is. A pick is final at once:
// the game is asked for straight away, while the pick plays out on the glass
// (the coin toss for Random is decided here, before it is thrown, so it can
// land on the side the server will give), and the page moves on to the game's
// own page, the invitation, once both the answer and the moment are over.

const CHOICES: { choice: Choice; name: string }[] = [
  { choice: 'white', name: 'White' },
  { choice: 'random', name: 'Random' },
  { choice: 'black', name: 'Black' },
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
  // Random's button goes with its king: once the coin leaves the middle
  const [coinGone, setCoinGone] = React.useState(false);
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
      setCoinGone(false);
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
    onGlide: () => setCoinGone(true),
    onSettled: () => setSettled(true),
  });

  const waiting = settled && !created && !failed;
  // A connection is usually open in a moment: it is only mentioned once it
  // has kept the player waiting (or would, were they to pick)
  const stalled = useDelayed(status !== 'connected' || waiting, SLOW_SERVER_MS);
  const heading = !picked
    ? 'Choose your side'
    : picked.choice === 'random'
      ? 'Leaving it to chance…'
      : `You play ${picked.side === 'white' ? 'White' : 'Black'}`;
  return (
    // Entering (until a pick): the page's words come in with the scene's
    // entrance, the buttons once the kings have formed
    <div className="lobby-page" data-testid="choose-side" data-enter={picked ? undefined : ''}>
      <header className="lobby-top">
        <button className="lobby-link" onClick={() => navigate('/')}>
          <span aria-hidden>←</span> Home
        </button>
      </header>
      {/* The heading answers the pick at once; keyed, so each line fades in */}
      <div className="lobby-heading" key={heading}>
        <h1>{heading}</h1>
      </div>
      <div className="lobby-choices" role="group" aria-label="Choose your side">
        {CHOICES.map(({ choice, name }) => {
          const seat = choice === 'random' ? 'coin' : choice;
          const chosen = picked?.choice === choice;
          return (
            <button
              key={choice}
              className="lobby-choice"
              data-choice={choice}
              data-chosen={chosen ? '' : undefined}
              data-faded={picked && (!chosen || (choice === 'random' && coinGone)) ? '' : undefined}
              data-hover={!picked && hover === choice ? '' : undefined}
              disabled={!!picked}
              aria-pressed={chosen}
              style={
                {
                  '--x': `var(--seat-${seat}-x, ${FALLBACK_X[seat]})`,
                  '--y': `var(--seat-${seat}-front, 62%)`,
                } as React.CSSProperties
              }
              // A mouse's hover only: a tap leaves nothing lit behind it
              onPointerEnter={(e) => !picked && e.pointerType === 'mouse' && setHover(choice)}
              onPointerLeave={() => setHover((h) => (h === choice ? null : h))}
              onFocus={() => !picked && setHover(choice)}
              onBlur={() => setHover((h) => (h === choice ? null : h))}
              onClick={() => pick(choice)}
            >
              <span className="lobby-choice-name">{name}</span>
            </button>
          );
        })}
      </div>
      <div className="lobby-foot" role="status">
        {failed && !created ? (
          <span className="lobby-error">Couldn't start a game: {failed.message}</span>
        ) : !stalled ? (
          ''
        ) : status === 'reconnecting' ? (
          'Reconnecting to server…'
        ) : status !== 'connected' ? (
          'Connecting to server…'
        ) : waiting ? (
          'Waiting for server…'
        ) : (
          ''
        )}
      </div>
    </div>
  );
};

export default ChooseSide;
