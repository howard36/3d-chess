import React from 'react';
import type { Computer } from '../ai/computer';
import { countGrades, endedAnalysis, gradeMoves } from '../game/analysis';
import type { Grade, GradeCounts, PositionAnalysis } from '../game/analysis';
import type { GameHistory } from '../game/history';
import type { MoveRecord } from '../types/messages';

export interface Analysis {
  /**
   * Not asked for yet, under way, every position done, or stopped short (a
   * position the search could not take, or its code failed to load): asked
   * for again, it goes on from the positions it has.
   */
  state: 'idle' | 'running' | 'done' | 'stopped';
  /** Positions done, of `total` (the start and the position after each move). */
  done: number;
  total: number;
  /** What the engine makes of the position after `n` moves, as each is done. */
  positions: readonly (PositionAnalysis | undefined)[];
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
  Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));

/**
 * A finished game's review, asked for by the player ("Analyse"): each
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
  const [run, setRun] = React.useState<Run>({ key, state: 'idle', positions: [] });
  const current: Run = run.key === key ? run : { key, state: 'idle', positions: NONE };

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
    // Asked again after stopping short: the positions found are kept
    const found = [...was.positions];
    if (ended) found[records.length] = ended;
    const todo: number[] = [];
    for (let ply = 0; ply < total; ply++) if (!found[ply]) todo.push(ply);
    let count = total - todo.length;
    setRun({ key, state: todo.length ? 'running' : 'done', positions: found });
    if (!todo.length) return;
    const put = (ply: number, analysis: PositionAnalysis) => {
      const done = ++count === total;
      setRun((r) => {
        if (r.key !== key) return r;
        const positions = [...r.positions];
        positions[ply] = analysis;
        return { key, state: done ? 'done' : 'running', positions };
      });
    };
    void (async () => {
      // The computer's handles, and their workers, only once a review is asked for
      let computers: Computer[];
      try {
        const { createComputer } = await import('../ai/computer');
        if (!live()) return;
        computers = Array.from({ length: Math.min(reviewWorkers(), todo.length) }, () =>
          createComputer(),
        );
      } catch (e) {
        stopped(e);
        return;
      }
      workers.current = computers;
      let next = 0;
      try {
        await Promise.all(
          computers.map(async (computer) => {
            while (next < todo.length && live()) {
              const ply = todo[next++];
              const analysis = await computer.analyse(records.slice(0, ply));
              if (live()) put(ply, analysis);
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
    () => gradeMoves(records, current.positions),
    [records, current.positions],
  );
  const counts = React.useMemo(() => countGrades(grades), [grades]);
  return {
    state: current.state,
    done: current.positions.filter(Boolean).length,
    total: records.length + 1,
    positions: current.positions,
    grades,
    counts,
    start,
  };
}
