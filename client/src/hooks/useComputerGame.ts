import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebSocketMessage } from '../types/messages';
import type { GameSocket } from './useGameSocket';
import {
  answer,
  answerDrawOffer,
  computerMove,
  computerToMove,
  fallbackMove,
  snapshot,
  standingOffer,
  startGame,
} from '../game/computerGame';
import type { Answer, ComputerGame } from '../game/computerGame';
import { loadComputerGame, saveComputerGame } from '../lib/computerGames';
import { createComputer } from '../ai/computer';
import type { Computer, ComputerMove } from '../ai/computer';
import { thinkTime } from '../ai/levels';

export interface ComputerGameOptions {
  /** The computer player (a worker by default). */
  computer?: () => Computer;
  /** How long the computer takes over a move, start to finish (levels.ts thinkTime by default). */
  pace?: (game: ComputerGame, move: ComputerMove) => number;
  /** While set, the computer does not start on its move (the page is not ready for it). */
  hold?: boolean;
  /** How long the computer takes to answer a draw offer, at the least (DRAW_ANSWER_MS by default). */
  drawAnswerMs?: number;
}

/** The computer answers a draw offer after a beat, as a person would, never at once. */
export const DRAW_ANSWER_MS = 900;

const defaultPace = (game: ComputerGame, move: ComputerMove) =>
  thinkTime(game.difficulty, move, Math.random());

/**
 * A game against the computer, as a GameSocket: the game screen sends its
 * messages here and reads the replies from `messages` exactly as it would a
 * server's (game/computerGame.ts answers them). The connection is always up
 * and never drops, and the game's seat is held from the first render: the
 * log opens with the game as it stands, as a rejoin's answer would (so the
 * page never draws a moment without its lobby or its board), the computer
 * sitting down at once in a game not yet begun. When it is the computer's
 * move, the computer thinks (in a worker) and its move arrives as a
 * move_made after a human pause. A draw the player offers it, it weighs up
 * (in the same worker) and answers after a beat, before it plays on.
 */
export function useComputerGame(gameId: string, options: ComputerGameOptions = {}): GameSocket {
  const gameRef = useRef<ComputerGame | null>(null);
  const loadedFor = useRef<string | null>(null);
  if (loadedFor.current !== gameId) {
    loadedFor.current = gameId;
    gameRef.current = loadComputerGame(gameId);
  }
  const [messages, setMessages] = useState<WebSocketMessage[]>(() => {
    const game = gameRef.current;
    if (!game) return [];
    const state = snapshot(game);
    if (game.started) return [state];
    const begun = startGame(game);
    gameRef.current = begun.game;
    saveComputerGame(begun.game!);
    return [state, ...begun.replies];
  });
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const apply = useCallback((result: Answer) => {
    if (result.game && result.game !== gameRef.current) saveComputerGame(result.game);
    gameRef.current = result.game;
    if (result.replies.length) setMessages((prev) => [...prev, ...result.replies]);
  }, []);

  const send = useCallback(
    (msg: WebSocketMessage) => {
      apply(answer(gameRef.current, gameId, msg));
      return true;
    },
    [apply, gameId],
  );

  const answered = messages.some((m) => m.type === 'game_state');

  // One computer for the page's life
  const computerRef = useRef<Computer | null>(null);
  useEffect(
    () => () => {
      computerRef.current?.dispose();
      computerRef.current = null;
    },
    [],
  );

  // Its move: asked for whenever the record changes to one where it is to
  // move, played after its thinking time (counted from the question)
  const moveCount = gameRef.current?.moves.length ?? 0;
  const started = gameRef.current?.started ?? false;
  const hold = options.hold ?? false;
  // A draw offered to it is answered first: it plays on only once it has
  // declined (an offer made while it thinks drops that thought)
  const offered = standingOffer(gameRef.current) !== null;
  useEffect(() => {
    const game = gameRef.current;
    if (!answered || hold || offered || !computerToMove(game)) return;
    let live = true;
    let timer: number | undefined;
    const asked = performance.now();
    computerRef.current ??= (optionsRef.current.computer ?? createComputer)();
    const play = (move: ComputerMove | null) => {
      if (!live || gameRef.current !== game) return;
      const chosen = move?.move ?? fallbackMove(game);
      if (!chosen) return;
      const total = move ? (optionsRef.current.pace ?? defaultPace)(game, move) : 0;
      const wait = Math.max(0, total - (performance.now() - asked));
      timer = window.setTimeout(() => {
        if (live && gameRef.current === game) apply(computerMove(game, chosen));
      }, wait);
    };
    computerRef.current.think(game.moves, game.difficulty).then(play, () => play(null));
    return () => {
      live = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [answered, moveCount, started, hold, offered, apply]);

  // A draw offered to it: it weighs up the position and answers after a
  // beat (counted from the offer), unless the player has moved or resigned
  // meanwhile
  useEffect(() => {
    const game = gameRef.current;
    if (!answered || !offered || !game) return;
    let live = true;
    let timer: number | undefined;
    const asked = performance.now();
    computerRef.current ??= (optionsRef.current.computer ?? createComputer)();
    const reply = (score: number | null) => {
      if (!live || gameRef.current !== game) return;
      const beat = optionsRef.current.drawAnswerMs ?? DRAW_ANSWER_MS;
      timer = window.setTimeout(
        () => {
          if (live && gameRef.current === game) apply(answerDrawOffer(game, score));
        },
        Math.max(0, beat - (performance.now() - asked)),
      );
    };
    computerRef.current.assess(game.moves).then(reply, () => reply(null));
    return () => {
      live = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [answered, offered, moveCount, apply]);

  const noop = useCallback(() => {}, []);
  return {
    send,
    messages,
    status: 'connected',
    sessionId: 1,
    sessionStartIndex: 0,
    reconnect: noop,
    reset: noop,
  };
}
