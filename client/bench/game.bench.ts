// The game as the client derives it from the socket's message log
// (client/src/game): the replay of the move record, the per-render selectors,
// the move box's parser and the HUD's words, over logs from real sessions
// (a live game, a reload, a flaky connection) and adversarial ones (a game
// thousands of moves long, which the rules allow, a flood of presence
// messages, a pasted wall of text).

import { bench, describe } from 'vitest';
import { Board } from '../src/engine';
import { announceLastMove, describeLastMove } from '../src/game/announce';
import { deriveHistory } from '../src/game/history';
import type { GameHistory } from '../src/game/history';
import { describeTaken, groupTaken, materialLead } from '../src/game/material';
import {
  hasSessionSince,
  selectErrors,
  selectOpponentOnline,
  selectSeat,
} from '../src/game/session';
import { parseTypedMove } from '../src/game/typedMove';
import type { MoveRecord, WebSocketMessage } from '../src/types/messages';
import {
  QUICK,
  flappingLog,
  liveLog,
  moveMade,
  promotionRush,
  reconnectingLog,
  rejoinLog,
  sharedGames,
  shuffleRecords,
  inRounds,
} from './fixtures';
import { emit } from './report';

export let sink: unknown;

const { decisive, casual } = sharedGames();
const marathon = (plies: number) => shuffleRecords(plies);
const records: { label: string; records: MoveRecord[] }[] = [
  { label: 'new game (0 plies)', records: [] },
  {
    label: `decisive game (${decisive.records.length} plies, ends in mate)`,
    records: decisive.records,
  },
  {
    label: `casual game (${casual.records.length} plies, ${casual.records.filter((r) => r.promotion).length} promotions)`,
    records: casual.records,
  },
  { label: 'marathon ⚠ (1,000 plies)', records: marathon(1000) },
  { label: 'marathon ⚠ (3,000 plies)', records: marathon(3000) },
];

// --- What GameScreen does with the log on every incoming message -------------

/**
 * The work client/src/screens/GameScreen.tsx (and three/Board.tsx) do per
 * incoming message, in the same order, minus React: the socket hook copies
 * the log to append, the memoized selectors rerun (their dependency is the
 * log), the replay is asked (and hands back its previous result unless the
 * record changed), and the check tests run for the pill and both kings.
 */
const perMessage = (log: WebSocketMessage[], next: WebSocketMessage, prev: GameHistory | null) => {
  const messages = [...log, next];
  const seat = selectSeat(messages);
  const online = selectOpponentOnline(messages, seat.color);
  const errors = selectErrors(messages).filter((e) => e.code !== 'seat_in_use');
  const ready = hasSessionSince(messages, 0);
  const seatInUse = messages.slice(0).some((m) => m.type === 'error' && m.code === 'seat_in_use');
  const history = deriveHistory(messages, prev);
  const endedLive =
    [...messages].reverse().find((m) => m.type === 'move_made' || m.type === 'game_state')?.type ===
    'move_made';
  const inCheck = !history.gameOver && history.board.inCheck(history.currentTurn);
  const kings = [history.board.inCheck('white'), history.board.inCheck('black')];
  return { online, errors, ready, seatInUse, endedLive, inCheck, kings, history };
};

const OPEN = 'G1 · Open a game (replay the whole record)';
const MOVE = 'G2 · A move arrives';
const OTHER = 'G3 · Any other message arrives';
const WHOLE = 'G4 · A whole game, played live';
const TAX = 'G5 · Per incoming message, everything the game screen derives';
const TYPED = 'G6 · Type a move';
const HUD = 'G7 · Announcement and captured pieces';

const presence: WebSocketMessage = { type: 'presence', color: 'black', online: true };
const flaky = flappingLog(decisive.records, 5000);
const reconnecting = reconnectingLog(casual.records, 10);

emit('game', {
  intros: {
    [OPEN]:
      'Opening or reloading a game page: the rejoin answers with the whole record in one ' +
      '`game_state`, and `deriveHistory` replays it from the starting position, then tests the ' +
      'final position for mate and stalemate. The rules have no repetition or fifty-move draw, so ' +
      'a game can legally run to thousands of plies (the *marathon* rows: both sides shuffling a knight).',
    [MOVE]:
      'Each `move_made` changes the record, so the replay starts again from the starting position ' +
      '(there is no incremental path). This is main-thread time between the echo arriving and the ' +
      'board updating, on both players’ screens.',
    [OTHER]:
      'A presence, error or any other message leaves the record unchanged: `deriveHistory` must ' +
      'recognise that and hand back its previous result (it scans the log for the latest snapshot ' +
      'and compares the record by identity).',
    [WHOLE]:
      'The total replay time one client spends over a whole game played live: one replay per move, ' +
      'each longer than the last, and one end-of-game test per move. The test is a fixed cost per ' +
      'move; the replay grows with the game (G2), so over a long game its total grows quadratically.',
    [TAX]:
      'Everything the game screen recomputes when any message lands (`GameScreen.tsx`: the log ' +
      'copy in `useGameSocket`, the seat/presence/error selectors, the replay or its memo, the ' +
      '`endedLive` scan, three check tests). Measured with a presence message arriving, so the ' +
      'replay itself is a memo hit: this is the fixed cost of a message, which grows with the log.',
    [TYPED]:
      'The move box (`game/typedMove.ts`), used by keyboard and screen-reader players: a regex, ' +
      'then the piece’s legal moves. The adversarial rows paste a legal move followed by a long ' +
      'run of spaces and one stray character.',
    [HUD]:
      'Per move: the live region’s sentence (`game/announce.ts`, which tests for check), and ' +
      'per render, the captured-pieces row (`game/material.ts`, which counts material over the ' +
      'whole board).',
  },
  workloads: {
    [TAX]: {
      title: 'Logs',
      intro: 'Message logs the per-message cases run on.',
      columns: ['Log', 'Messages', 'Moves'],
      align: ['l', 'r', 'r'],
      rows: [
        [
          'decisive game, live',
          String(liveLog(decisive.records).length),
          String(decisive.records.length),
        ],
        [
          'casual game, reconnecting every 10 moves',
          String(reconnecting.length),
          String(casual.records.length),
        ],
        [
          'decisive game vs a flaky opponent (5,000 presence flaps)',
          String(flaky.length),
          String(decisive.records.length),
        ],
        ['marathon, live', String(liveLog(marathon(3000)).length), '3000'],
      ],
    },
  },
});

inRounds(({ normal, heavy, heaviest }) => {
  describe(OPEN, () => {
    for (const { label, records: r } of records) {
      const log = rejoinLog(r);
      // A record the engine refused would stop the replay early and time less work
      const replayed = deriveHistory(log);
      if (replayed.replayFailedAt !== null || replayed.appliedMoveCount !== r.length) {
        throw new Error(`${label}: replay stopped at move ${replayed.replayFailedAt}`);
      }
      bench(
        label,
        () => {
          sink = deriveHistory(log);
        },
        r.length >= 1000 ? heavy : normal,
      );
    }
    // Before any of that, useGameSocket parses the snapshot off the wire
    for (const { label, records: r } of [records[1], records[4]]) {
      const text = JSON.stringify(rejoinLog(r)[0]);
      bench(
        `JSON.parse of the snapshot: ${label}, ${(text.length / 1024).toFixed(0)} KiB`,
        () => {
          sink = JSON.parse(text);
        },
        normal,
      );
    }
  });

  describe(MOVE, () => {
    const cases = [
      { label: 'decisive game, ply 50', records: decisive.records.slice(0, 50) },
      {
        label: `decisive game, the mating move (ply ${decisive.records.length})`,
        records: decisive.records,
      },
      { label: `casual game, ply ${casual.records.length}`, records: casual.records },
      { label: 'marathon ⚠, ply 1,000', records: marathon(1000) },
      { label: 'marathon ⚠, ply 3,000', records: marathon(3000) },
    ];
    for (const { label, records: r } of cases) {
      const before = liveLog(r.slice(0, -1));
      const prev = deriveHistory(before);
      const after = [...before, moveMade(r[r.length - 1])];
      bench(
        label,
        () => {
          sink = deriveHistory(after, prev);
        },
        r.length >= 1000 ? heavy : normal,
      );
    }
  });

  describe(OTHER, () => {
    const cases = [
      {
        label: `decisive game, live (${liveLog(decisive.records).length + 1} messages)`,
        log: liveLog(decisive.records),
      },
      {
        label: `marathon ⚠, live (${liveLog(marathon(3000)).length + 1} messages)`,
        log: liveLog(marathon(3000)),
      },
      { label: `flaky opponent ⚠, 5,000 flaps (${flaky.length + 1} messages)`, log: flaky },
    ];
    for (const { label, log } of cases) {
      const prev = deriveHistory(log);
      const after = [...log, presence];
      bench(
        label,
        () => {
          const h = deriveHistory(after, prev);
          if (h !== prev) throw new Error('memo missed');
          sink = h;
        },
        normal,
      );
    }
  });

  describe(WHOLE, () => {
    const play = (r: MoveRecord[]) => {
      const log = liveLog([]);
      let prev: GameHistory | null = null;
      for (const record of r) {
        log.push(moveMade(record));
        prev = deriveHistory(log, prev);
      }
      return prev;
    };
    // (The marathon's growth shows per move in G1 and G2; replaying a whole
    // marathon here would take seconds a sample for no more information.)
    bench(
      `decisive game (${decisive.records.length} plies)`,
      () => {
        sink = play(decisive.records);
      },
      heaviest,
    );
    bench(
      `casual game (${casual.records.length} plies)`,
      () => {
        sink = play(casual.records);
      },
      heaviest,
    );
  });

  describe(TAX, () => {
    const cases = [
      { label: 'decisive game, live', log: liveLog(decisive.records) },
      { label: 'casual game, reconnecting every 10 moves', log: reconnecting },
      { label: 'flaky opponent ⚠, 5,000 flaps', log: flaky },
      { label: 'marathon ⚠ (3,000 plies), live', log: liveLog(marathon(3000)) },
    ];
    for (const { label, log } of cases) {
      const prev = deriveHistory([...log, presence]);
      bench(
        `${label} (${log.length + 1} messages)`,
        () => {
          sink = perMessage(log, presence, prev);
        },
        normal,
      );
    }
  });

  describe(TYPED, () => {
    const opening = Board.setupStartingPosition();
    const rush = promotionRush();
    const cases: { label: string; text: string; board: Board; options?: object }[] = [
      { label: 'pawn step "Bb1-Cb1"', text: 'Bb1-Cb1', board: opening },
      { label: 'knight, loose form "ab1 aa3"', text: 'ab1 aa3', board: opening },
      { label: 'promotion "Db5-Eb5=Q"', text: 'Db5-Eb5=Q', board: rush },
      { label: 'promotion missing its piece (error)', text: 'Db5-Eb5', board: rush },
      { label: 'no piece there (error)', text: 'Cc3-Cc4', board: opening },
      { label: 'illegal destination (error)', text: 'Aa1-Ee5', board: opening },
      { label: 'not a move (error)', text: 'hello there', board: opening },
      { label: '100,000 letters ⚠', text: 'x'.repeat(100_000), board: opening },
    ];
    for (const n of QUICK ? [1000, 4000] : [1000, 4000, 16_000]) {
      cases.push({
        label: `move + ${n.toLocaleString('en-US')} spaces + "!" ⚠`,
        text: `Bb1-Cb1${' '.repeat(n)}!`,
        board: opening,
        options: n >= 16_000 ? heaviest : normal,
      });
    }
    for (const { label, text, board, options } of cases) {
      bench(
        label,
        () => {
          sink = parseTypedMove(text, board, 'white');
        },
        options ?? normal,
      );
    }
  });

  describe(HUD, () => {
    const mate = deriveHistory(rejoinLog(decisive.records));
    const mid = deriveHistory(rejoinLog(decisive.records.slice(0, 60)));
    bench(
      'announce the mating move',
      () => {
        sink = announceLastMove(mate, 'white');
      },
      normal,
    );
    bench(
      'announce a middlegame capture (ply 60)',
      () => {
        sink = announceLastMove(mid, 'black');
      },
      normal,
    );
    bench(
      'describe the last move only',
      () => {
        sink = describeLastMove(mid);
      },
      normal,
    );
    bench(
      'captured-pieces row, both sides (ply 60)',
      () => {
        const lead = materialLead(mid.board, 'white');
        sink = [
          describeTaken(groupTaken(mid.captured.white), lead, 'you'),
          describeTaken(groupTaken(mid.captured.black), -lead, 'opponent'),
        ];
      },
      normal,
    );
  });
});
