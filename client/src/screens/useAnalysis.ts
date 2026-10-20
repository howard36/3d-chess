import React from 'react';
import type { Computer } from '../ai/computer';
import {
  countGrades,
  endedAnalysis,
  gradeMoves,
  recheckOf,
  whiteEvaluation,
} from '../game/analysis';
import type { Evaluation, Grade, GradeCounts, PositionAnalysis } from '../game/analysis';
import type { GameHistory } from '../game/history';
import type { MoveRecord } from '../types/messages';

export interface Analysis {
  /**
   * Not asked for yet, under way, every position done, or stopped short (a
   * position the search could not take, or its code failed to load): asked
   * for again, it goes on from the positions it has.
   */
  state: 'idle' | 'running' | 'done' | 'stopped';
  /**
   * Searches done, of `total`: the start and the position after each move,
   * and each recheck found to be needed so far.
   */
  done: number;
  total: number;
  /** What the engine makes of the position after `n` moves, as each is done. */
  positions: readonly (PositionAnalysis | undefined)[];
  /**
   * The same from White's side, as the review shows it (game/analysis.ts,
   * whiteEvaluation): one for each position of the game, undefined while still to come.
   */
  evaluations: readonly (Evaluation | undefined)[];
  /**
   * Move `n`'s position searched again deeper (at `n - 1`), where its two
   * positions disagree on a forced mate (game/analysis.ts, recheckOf).
   */
  rechecks: readonly (PositionAnalysis | undefined)[];
  /** Each move's grade (move `n` at `n - 1`): null unmarked, undefined still to come. */
  grades: readonly (Grade | null | undefined)[];
  counts: GradeCounts;
  /** Starts the review (only once the game is over, and once). */
  start: () => void;
}

interface Run {
  /** The record reviewed, as a key: another record (another game) starts afresh. */
  key: string;
  state: Analysis['state'];
  positions: (PositionAnalysis | undefined)[];
  rechecks: (PositionAnalysis | undefined)[];
}

const NONE: (PositionAnalysis | undefined)[] = [];
const NO_RECORDS: MoveRecord[] = [];

const recordKey = (records: readonly MoveRecord[]) =>
  records.map((r) => `${r.from}${r.to}${r.promotion ?? ''}`).join(' ');

const stopAll = (workers: React.RefObject<Computer[]>) => {
  for (const w of workers.current) w.dispose();
  workers.current = [];
};

/**
 * How many workers a review searches in: the positions are independent (a
 * fresh search each, bounded by nodes), so the marks are the same however
 * many there are; one core is left to the page.
 */
const reviewWorkers = () =>
  // Without workers the searches run on the page itself: one at a time
  typeof Worker === 'undefined'
    ? 1
    : Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));

/**
 * A finished game's review, asked for by the player ("Review", or a step
 * through the record): each
 * position from the start on is searched in the computer's workers
 * (ai/computer.ts, analyse), several at once, handed out from the start, so
 * the marks come in from the first move on and the page never waits; the
 * position the game ended in on the board (a mate, a draw) needs no search.
 * It lasts for the page's life: leaving the page, or another record (a new
 * game), stops the work.
 */
export function useAnalysis(history: GameHistory): Analysis {
  // Nothing at all while the game is on: a move landing costs nothing here
  const over = history.gameOver !== null;
  const records = React.useMemo(
    () => (over ? history.moveRecords.slice(0, history.appliedMoveCount) : NO_RECORDS),
    [over, history.moveRecords, history.appliedMoveCount],
  );
  const key = React.useMemo(() => recordKey(records), [records]);
  const positionCount = records.length + 1;
  const [run, setRun] = React.useState<Run>({ key, state: 'idle', positions: [], rechecks: [] });
  const current: Run =
    run.key === key ? run : { key, state: 'idle', positions: NONE, rechecks: NONE };

  // The run under way (its number: one stopped is passed by) and its
  // workers, stopped when the record changes or the page goes
  const runs = React.useRef(0);
  const asked = React.useRef<string | null>(null);
  const workers = React.useRef<Computer[]>([]);
  React.useEffect(
    () => () => {
      runs.current++;
      asked.current = null;
      stopAll(workers);
    },
    [key],
  );

  // The workers made ahead, idle, once a finished game is on screen (no
  // search: that waits for the player's asking), so a review starts in
  // workers whose code has loaded
  React.useEffect(() => {
    if (!over || typeof requestIdleCallback !== 'function') return;
    const run = runs.current;
    let gone = false;
    const ready = () => !gone && runs.current === run && !workers.current.length;
    requestIdleCallback(
      () => {
        if (!ready()) return;
        import('../ai/computer').then(
          ({ createComputer }) => {
            if (!ready()) return;
            workers.current = Array.from({ length: Math.min(reviewWorkers(), positionCount) }, () =>
              createComputer(),
            );
          },
          () => {},
        );
      },
      { timeout: 2000 },
    );
    return () => {
      gone = true;
    };
  }, [over, key, positionCount]);

  const latest = React.useRef({ records, key, gameOver: history.gameOver, run: current });
  latest.current = { records, key, gameOver: history.gameOver, run: current };
  const start = React.useCallback(() => {
    const { records, key, gameOver, run: was } = latest.current;
    if (!gameOver || asked.current === key) return;
    asked.current = key;
    const run = ++runs.current;
    const live = () => runs.current === run;
    const ended = endedAnalysis(gameOver);
    const total = records.length + 1;
    const stopped = (cause: unknown) => {
      if (!live()) return;
      // The run is over: a search still under way (on the page, which
      // disposing cannot stop) lands nowhere
      runs.current++;
      console.warn('The review stopped short.', cause);
      stopAll(workers);
      asked.current = null;
      setRun((r) => (r.key === key ? { ...r, state: 'stopped' } : r));
    };
    // Asked again after stopping short: the positions and rechecks found are kept
    const found = [...was.positions];
    const rechecked = [...was.rechecks];
    if (ended) found[records.length] = ended;
    const todo: number[] = [];
    for (let ply = 0; ply < total; ply++) if (!found[ply]) todo.push(ply);
    // The rechecks to do (by move), and how many have been found to be needed
    const recheckTodo: number[] = [];
    let needed = 0;
    const wantRecheck = (move: number) => {
      const before = found[move];
      const after = found[move + 1];
      if (!before || !after || !recheckOf(before, after)) return;
      needed++;
      if (!rechecked[move]) recheckTodo.push(move);
    };
    for (let move = 0; move < records.length; move++) wantRecheck(move);
    const snapshot = (): Run => {
      const count = found.filter(Boolean).length + rechecked.filter(Boolean).length;
      const state = count === total + needed ? 'done' : 'running';
      return { key, state, positions: [...found], rechecks: [...rechecked] };
    };
    const first = snapshot();
    setRun(first);
    if (first.state === 'done') return;
    // A recheck, once both the move's positions are in, before any other search
    const next = () => {
      if (recheckTodo.length) {
        const move = recheckTodo.shift()!;
        const recheck = recheckOf(found[move]!, found[move + 1]!)!;
        const ply = recheck.side === 'before' ? move : move + 1;
        return { ply, depth: recheck.depth, move };
      }
      return todo.length ? { ply: todo.shift()!, depth: undefined, move: -1 } : null;
    };
    void (async () => {
      // The computer's handles, and their workers, only once a review is asked for
      let computers: Computer[];
      try {
        const { createComputer } = await import('../ai/computer');
        if (!live()) return;
        computers = workers.current.length
          ? workers.current
          : Array.from(
              { length: Math.min(reviewWorkers(), todo.length + recheckTodo.length) },
              () => createComputer(),
            );
      } catch (e) {
        stopped(e);
        return;
      }
      workers.current = computers;
      try {
        // A worker that finds a recheck is needed is still at work, and takes
        // it (or another) next: none is left with nobody to do it
        await Promise.all(
          computers.map(async (computer) => {
            for (let job = next(); job && live(); job = next()) {
              const analysis = await computer.analyse(records.slice(0, job.ply), job.depth);
              if (!live()) return;
              if (job.depth) {
                rechecked[job.move] = analysis;
              } else {
                found[job.ply] = analysis;
                if (job.ply > 0) wantRecheck(job.ply - 1);
                if (job.ply < records.length) wantRecheck(job.ply);
              }
              setRun((r) => (r.key === key ? snapshot() : r));
            }
          }),
        );
      } catch (e) {
        // A position the search could not take: the review stops there
        stopped(e);
        return;
      }
      if (live()) stopAll(workers);
    })();
  }, []);

  const grades = React.useMemo(
    () => gradeMoves(records, current.positions, current.rechecks),
    [records, current.positions, current.rechecks],
  );
  const counts = React.useMemo(() => countGrades(grades), [grades]);
  const evaluations = React.useMemo(
    () =>
      Array.from({ length: records.length + 1 }, (_, n) => {
        const position = current.positions[n];
        return position && whiteEvaluation(position, n);
      }),
    [records.length, current.positions],
  );
  const needed = React.useMemo(
    () =>
      records.filter((_, n) => {
        const before = current.positions[n];
        const after = current.positions[n + 1];
        return before && after && recheckOf(before, after);
      }).length,
    [records, current.positions],
  );
  return {
    state: current.state,
    done: current.positions.filter(Boolean).length + current.rechecks.filter(Boolean).length,
    total: records.length + 1 + needed,
    positions: current.positions,
    evaluations,
    rechecks: current.rechecks,
    grades,
    counts,
    start,
  };
}
