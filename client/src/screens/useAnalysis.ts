import React from 'react';
import type { Computer } from '../ai/computer';
import { countGrades, endedAnalysis, gradeMoves } from '../game/analysis';
import type { Grade, GradeCounts, PositionAnalysis } from '../game/analysis';
import type { GameHistory } from '../game/history';
import type { MoveRecord } from '../types/messages';

export interface Analysis {
  /** Not asked for yet, under way, or every position done. */
  state: 'idle' | 'running' | 'done';
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

/**
 * A finished game's review, asked for by the player ("Analyse"): each
 * position from the start on is searched in the computer's worker
 * (ai/computer.ts, analyse), one at a time, so the marks come in as they
 * are done and the page never waits; the position the game ended in on the
 * board (a mate, a draw) needs no search. It lasts for the page's life:
 * leaving the page, or another record (a new game), stops the work.
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

  // The run under way (its number: one stopped is passed by) and its worker,
  // stopped when the record changes or the page goes
  const runs = React.useRef(0);
  const asked = React.useRef<string | null>(null);
  const worker = React.useRef<Computer | null>(null);
  React.useEffect(
    () => () => {
      runs.current++;
      asked.current = null;
      worker.current?.dispose();
      worker.current = null;
    },
    [key],
  );

  const latest = React.useRef({ records, key, gameOver: history.gameOver });
  latest.current = { records, key, gameOver: history.gameOver };
  const start = React.useCallback(() => {
    const { records, key, gameOver } = latest.current;
    if (!gameOver || asked.current === key) return;
    asked.current = key;
    const run = ++runs.current;
    const live = () => runs.current === run;
    const ended = endedAnalysis(gameOver);
    setRun({ key, state: 'running', positions: [] });
    const put = (ply: number, analysis: PositionAnalysis) =>
      setRun((r) => {
        if (r.key !== key) return r;
        const positions = [...r.positions];
        positions[ply] = analysis;
        return { key, state: ply === records.length ? 'done' : 'running', positions };
      });
    void (async () => {
      // The computer's handle, and its worker, only once a review is asked for
      let computer: Computer;
      try {
        const { createComputer } = await import('../ai/computer');
        if (!live()) return;
        computer = createComputer();
      } catch {
        // Its chunk failed to load: "Analyse" again tries again
        if (!live()) return;
        asked.current = null;
        setRun((r) => (r.key === key ? { ...r, state: 'idle' } : r));
        return;
      }
      worker.current = computer;
      for (let ply = 0; ply <= records.length; ply++) {
        if (ply === records.length && ended) {
          put(ply, ended);
          break;
        }
        let analysis: PositionAnalysis;
        try {
          analysis = await computer.analyse(records.slice(0, ply));
        } catch {
          // A position the search could not take: the review stops there
          if (!live()) return;
          computer.dispose();
          worker.current = null;
          setRun((r) => (r.key === key ? { ...r, state: 'done' } : r));
          return;
        }
        if (!live()) return;
        put(ply, analysis);
      }
      computer.dispose();
      worker.current = null;
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
