import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebSocketMessage } from '../types/messages';
import type { GameSocket } from './useGameSocket';
import {
  answer,
  computerMove,
  computerToMove,
  fallbackMove,
  startGame,
} from '../game/computerGame';
import type { Answer, ComputerGame } from '../game/computerGame';
import { loadComputerGame, saveComputerGame } from '../lib/computerGames';
import { createComputer } from '../ai/computer';
import type { Computer, ComputerMove } from '../ai/computer';
import { thinkTime } from '../ai/levels';

/** How long after the page first shows a new game the computer takes its seat. */
export const COMPUTER_JOINS_MS = 700;

export interface ComputerGameOptions {
  /** The computer player (a worker by default). */
  computer?: () => Computer;
  /** How long the computer takes over a move, start to finish (levels.ts thinkTime by default). */
  pace?: (game: ComputerGame, move: ComputerMove) => number;
  /** How long after a new game is shown the computer sits down. */
  joinMs?: number;
  /** While set, the computer does not start on its move (the page is not ready for it). */
  hold?: boolean;
}

const defaultPace = (game: ComputerGame, move: ComputerMove) =>
  thinkTime(game.difficulty, move, Math.random());

/**
 * A game against the computer, as a GameSocket: the game screen sends its
 * messages here and reads the replies from `messages` exactly as it would a
 * server's (game/computerGame.ts answers them). The connection is always up
 * and never drops. When it is the computer's move, the computer thinks (in a
 * worker) and its move arrives as a move_made after a human pause.
 */
export function useComputerGame(gameId: string, options: ComputerGameOptions = {}): GameSocket {
  const gameRef = useRef<ComputerGame | null>(null);
  const loadedFor = useRef<string | null>(null);
  if (loadedFor.current !== gameId) {
    loadedFor.current = gameId;
    gameRef.current = loadComputerGame(gameId);
  }
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
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

  // A new game: the computer sits down a beat after the page shows it (the
  // lobby's wait, then its arrival)
  const answered = messages.some((m) => m.type === 'game_state');
  useEffect(() => {
    const game = gameRef.current;
    if (!answered || !game || game.started) return;
    const timer = window.setTimeout(
      () => gameRef.current && apply(startGame(gameRef.current)),
      optionsRef.current.joinMs ?? COMPUTER_JOINS_MS,
    );
    return () => window.clearTimeout(timer);
  }, [answered, apply]);

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
  useEffect(() => {
    const game = gameRef.current;
    if (!answered || hold || !computerToMove(game)) return;
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
  }, [answered, moveCount, started, hold, apply]);

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
