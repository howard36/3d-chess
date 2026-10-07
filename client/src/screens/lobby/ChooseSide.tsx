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
import type { LobbyStage } from './lobbyContext';
import { SeatLabels } from './LobbyCards';
import { SLOW_SERVER_MS, useDelayed } from '../../hooks/useDelayed';
import { DIFFICULTIES, DIFFICULTY_NAME } from '../../ai/levels';
import type { Difficulty } from '../../ai/levels';
import {
  getStoredDifficulty,
  markArriving,
  newComputerGameId,
  saveComputerGame,
  setStoredDifficulty,
} from '../../lib/computerGames';
import { computerGame } from '../computerGameChunk';
import { prefersReducedMotion } from '../../three/motion';

// The first page of a new game: the player picks a side. The three kings
// stand on the glass (LobbyScene): porcelain, the split king for Random, and
// charcoal; a button under each says what it is. A pick is final at once:
// the game is asked for straight away, while the pick plays out on the glass
// (the coin toss for Random is decided here, before it is thrown, so it can
// land on the side the server will give), and the page moves on to the game's
// own page, the invitation, once both the answer and the moment are over.
//
// Against the computer (/computer) the side is the first of two steps: once
// the pick has played out, the other seat's outline comes up for the
// computer and its level is chosen under the kings, where the side was, the
// kings framed as they were for it. Choosing it fills the computer's king,
// the game is made on the spot, in the browser (no server is asked), and its
// page opens on the computer's arrival as the page's words go.

const CHOICES: { choice: Choice; name: string }[] = [
  { choice: 'white', name: 'White' },
  { choice: 'random', name: 'Random' },
  { choice: 'black', name: 'Black' },
];

// Until the scene has placed the kings on screen
const FALLBACK_X = { white: '25%', coin: '50%', black: '75%' };

const other = (side: Side): Side => (side === 'white' ? 'black' : 'white');

const ChooseSide: React.FC<{ gameSocket: GameSocket; computer?: boolean }> = ({
  gameSocket,
  computer = false,
}) => {
  const navigate = useNavigate();
  // The computer's level, once chosen, and the game made with it...
  const [level, setLevel] = React.useState<Difficulty | null>(null);
  const [computerGameId, setComputerGameId] = React.useState<string | null>(null);
  // ...then the page's words make way, and the game's page opens on the
  // computer's arrival as they go
  const [gone, setGone] = React.useState(false);
  // Its page's code, while the player chooses
  React.useEffect(() => {
    if (computer) computerGame.preload();
  }, [computer]);
  const { messages, status } = gameSocket;
  const [hover, setHover] = React.useState<Choice | null>(null);
  const [picked, setPicked] = React.useState<{ choice: Choice; side: Side } | null>(null);
  const [settled, setSettled] = React.useState(false);
  // Random's button goes with its king: once the coin leaves the middle
  const [coinGone, setCoinGone] = React.useState(false);
  // Where in the log this page asked for its game: only what follows answers
  // it (arriving from a finished game, the log still holds that game's
  // game_created for the first render)
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
  React.useEffect(() => {
    if (!computerGameId || !gone) return;
    markArriving(computerGameId);
    navigate(`/computer/${computerGameId}`, { replace: true });
  }, [computerGameId, gone, navigate]);

  // Asked again on the next connection if this one drops before the answer
  const requestGame = useResendOnReconnect(
    gameSocket,
    computer || !picked || !!created || !!failed,
  );

  const pick = (choice: Choice) => {
    if (picked) return;
    const side: Side = choice === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : choice;
    setPicked({ choice, side });
    setHover(null);
    if (computer) return;
    setRequestIndex(messages.length);
    requestGame({ type: 'create_game', clientId: getClientId(), color: side });
  };

  // Against the computer, once the side's pick has played out: its level
  const leveling = computer && settled && !!picked;
  const pickLevel = (difficulty: Difficulty) => {
    if (!picked || level) return;
    const id = newComputerGameId();
    saveComputerGame({ id, color: picked.side, difficulty, started: false, moves: [] });
    setStoredRole(id, picked.side);
    setStoredDifficulty(difficulty);
    setLevel(difficulty);
    setComputerGameId(id);
    if (prefersReducedMotion()) setGone(true);
  };

  const side = picked?.side ?? null;
  const levelView: LobbyStage | null =
    leveling && side
      ? {
          // The kings framed as for the side, the levels hanging under them
          // where the side's buttons were; the computer's seat open, then
          // filling as its level is chosen (the arrival on the game's page
          // answers it)
          beat: 'invited',
          taken: { [side]: true, [other(side)]: !!level } as Record<Side, boolean>,
          mine: side,
          hover: null,
          toss: null,
          seat: side,
        }
      : null;
  useLobbyView(
    levelView ?? {
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
    },
  );

  const waiting = settled && !created && !failed;
  // A connection is usually open in a moment: it is only mentioned once it
  // has kept the player waiting (or would, were they to pick)
  const stalled = useDelayed(!computer && (status !== 'connected' || waiting), SLOW_SERVER_MS);
  const heading =
    picked?.choice === 'random' && !settled
      ? 'Leaving it to chance…'
      : leveling
        ? 'Choose difficulty'
        : // (against the computer the pick's seat says it: "You", with the next step)
          !picked || computer
          ? 'Choose your side'
          : // (once the coin has come to rest, what it gave)
            `You play ${picked.side === 'white' ? 'White' : 'Black'}`;
  const out = level ? '' : undefined;
  return (
    // Entering (until a pick): the page's words come in with the scene's
    // entrance, the buttons once the kings have formed
    <div className="lobby-page" data-testid="choose-side" data-enter={picked ? undefined : ''}>
      <header className="lobby-top" data-out={out}>
        <button className="lobby-link" onClick={() => navigate('/')}>
          <span aria-hidden>←</span> Home
        </button>
      </header>
      {/* The heading answers the pick at once; keyed, so each line fades in */}
      <div className="lobby-heading" key={heading} data-out={out}>
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
              data-faded={
                picked && (!chosen || (choice === 'random' && coinGone) || (computer && settled))
                  ? ''
                  : undefined
              }
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
      {leveling && side && (
        <>
          <div className="lobby-labels" data-out={out}>
            <SeatLabels labels={{ [side]: 'You', [other(side)]: 'Computer' }} />
          </div>
          {/* Under the kings and their words, where the side's buttons
              were. The chosen level holds a moment as the others go, then
              all of it; the page moves on as it goes */}
          <div
            className="lobby-levels"
            role="group"
            aria-label="Difficulty"
            data-out={out}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget && e.animationName === 'lobby-out') setGone(true);
            }}
          >
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                className="lobby-choice lobby-level"
                data-level={d}
                data-chosen={level === d ? '' : undefined}
                data-faded={level && level !== d ? '' : undefined}
                disabled={!!level}
                aria-pressed={level === d}
                autoFocus={d === getStoredDifficulty()}
                onClick={() => pickLevel(d)}
              >
                <span className="lobby-choice-name">{DIFFICULTY_NAME[d]}</span>
              </button>
            ))}
          </div>
        </>
      )}
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
