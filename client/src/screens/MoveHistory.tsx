import React from 'react';
import type { MoveRecord } from '../types/messages';
import { formatMove, plyNumber, STEP_KEY, stepOfKey, stepTo } from '../game/review';
import { notationWords } from '../game/notation';
import type { MoveNotation } from '../game/notation';
import type { ReviewStep } from '../game/review';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { sideName } from '../game/sides';
import { GRADE_GLYPH, GRADES } from '../game/analysis';
import type { Grade, GradeCounts } from '../game/analysis';
import type { Turn } from '../game/history';
import { focusFromCode } from '../lib/focus';
import { Stone } from './TurnPill';
import { MoveText } from './MoveText';

/** The game's review, once the game is over (screens/useAnalysis.ts). */
export interface HistoryAnalysis {
  /**
   * Not begun yet ("Review", or a step through the record, begins it), under
   * way, done, or stopped short ("Retry").
   */
  state: 'idle' | 'running' | 'done' | 'stopped';
  /** Positions done, of `total`. */
  done: number;
  total: number;
  /** Each move's grade (move `n` at `n - 1`), as far as the review has come. */
  grades: readonly (Grade | null | undefined)[];
  counts: GradeCounts;
  /** The best move where the move shown was played, when the move shown is marked. */
  best: Pick<MoveRecord, 'from' | 'to' | 'promotion'> | null;
  /** How the record writes it (game/notation.ts), with `best`. */
  bestNotation: MoveNotation | null;
  /** Goes on with a review that stopped short, from the positions it has. */
  onRetry: () => void;
}

export interface MoveHistoryProps {
  /** The whole move record, as the server holds it. */
  moves: MoveRecord[];
  /** How many of them can be shown (all but a record past one the replay could not play). */
  applied: number;
  /** How the record writes each move shown (GameHistory.notation), move `n` at `n - 1`. */
  notation: readonly MoveNotation[];
  /** The ply the board shows: `applied` at the live position. */
  shown: number;
  /** Shows the position after `ply` moves (`applied`: the live position). */
  onShow: (ply: number) => void;
  /**
   * Whether the steps act (the buttons, the moves, ← → Home End): not
   * behind a dialog, nor while the game's entrance plays.
   */
  enabled: boolean;
  /**
   * The game is over and its result card put away: in a narrow window the
   * steps take the pill's place at the top, the list opening under them
   * (index.css), clear of the rematch under the tower.
   */
  ended?: boolean;
  /**
   * The game is on: the record is out of sight, kept in the page as words for
   * screen readers, and takes no step. It comes into sight with the result.
   */
  hidden?: boolean;
  /** The review of the game (in sight with the record): its marks, as they come. */
  analysis?: HistoryAnalysis;
  /**
   * Counts the player's asks for the review (the result card's "Review"):
   * each new one opens the list and puts the focus on the move shown.
   */
  reviewAsked?: number;
}

/** Moves a block of the list holds (an even number: a row is two moves). */
const BLOCK = 64;

/** A window too narrow for the list beside the tower: it opens on asking (index.css). */
const NARROW = '(max-aspect-ratio: 13/9) and (min-height: 481px)';

/** Whether a key went to a text field, which keeps its own keys. */
const inField = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

interface BlockProps {
  moves: MoveRecord[];
  notation: readonly MoveNotation[];
  start: number;
  applied: number;
  /** The ply shown, if it is one of this block's moves (else -1). */
  shown: number;
  /** The list is open: its shown move takes Tab. */
  open: boolean;
  /** The moves are words only (the record out of sight while the game is on). */
  words: boolean;
  /** The review's grades, move `n` at `n - 1` (none before it is asked for). */
  grades: readonly (Grade | null | undefined)[];
  onShow: (ply: number) => void;
}

const NO_GRADES: readonly (Grade | null | undefined)[] = [];

/**
 * A move in words for a screen reader (notationWords), or as the wire writes
 * it where the replay stopped short of it.
 */
const moveWords = (moves: MoveRecord[], notation: readonly MoveNotation[], i: number) =>
  notation[i] ? notationWords(notation[i]) : formatMove(moves[i]);

/** A move's mark after it: the glyph, its grade in words for a screen reader. */
const Mark = ({ grade }: { grade: Grade }) => (
  <>
    <span className="hud-mark" data-grade={grade} aria-hidden>
      {GRADE_GLYPH[grade]}
    </span>
    <span className="sr-only">, {grade}</span>
  </>
);

/** The rows of moves `start` to `start + BLOCK` (as many as there are), each move a button. */
const MoveBlock = React.memo(
  ({ moves, notation, start, applied, shown, open, words, grades, onShow }: BlockProps) => {
    const ply = (i: number) => {
      const n = i + 1;
      const said = moveWords(moves, notation, i);
      if (words) return <span>{n % 2 === 0 ? `, ${said}` : said}</span>;
      const grade = grades[i];
      const note = notation[i];
      return (
        <button
          type="button"
          className="hud-ply"
          data-ply={n}
          data-grade={grade ?? undefined}
          // The icons are drawn only: the move is named in words
          aria-label={grade ? `${said}, ${grade}` : said}
          aria-current={n === shown ? 'step' : undefined}
          // One stop in the list for Tab, the shown move (← → step on)
          tabIndex={open && n === shown ? 0 : -1}
          // A record past one the replay could not play has no position to show
          disabled={n > applied}
          onClick={() => onShow(n)}
        >
          {/* Black's starts with the space between the two (not drawn: the
              button lays out only its words); the words are lit on their
              own, trimmed to their capitals (index.css); a move with no
              notation is written as the wire writes it */}
          {n % 2 === 0 ? ' ' : null}
          <span className="hud-ply-word">
            {note ? <MoveText notation={note} /> : said}
            {grade && <Mark grade={grade} />}
          </span>
        </button>
      );
    };
    const rows = [];
    for (let i = start; i < Math.min(moves.length, start + BLOCK); i += 2) {
      // Three nodes a row (the number, then the moves, each a button round
      // its words, each in its column: index.css), nothing else: a reopened game of thousands of moves
      // mounts its whole record, a render after the blocks in view
      // (`whole`, below). It reads "1. ♙Cb1 ♙Cd5".
      rows.push(
        <li key={i / 2 + 1}>
          <span className="hud-num">{`${i / 2 + 1}. `}</span>
          {ply(i)}
          {i + 1 < moves.length ? ply(i + 1) : null}
        </li>,
      );
    }
    return rows;
  },
  // A record grows at its end, so only the last block changes as a move
  // lands, and only the blocks holding the move shown before and after a
  // step; the others hold the same records and are left alone
  (a, b) => {
    if (a.start !== b.start || a.shown !== b.shown || a.open !== b.open) return false;
    if (a.words !== b.words) return false;
    if (a.onShow !== b.onShow) return false;
    const end = a.start + BLOCK;
    if (Math.min(a.applied, end) !== Math.min(b.applied, end)) return false;
    if (Math.min(a.moves.length, end) !== Math.min(b.moves.length, end)) return false;
    for (let i = a.start; i < Math.min(a.moves.length, end); i++) {
      if (a.moves[i] !== b.moves[i] || a.grades[i] !== b.grades[i]) return false;
      if (a.notation[i] !== b.notation[i]) return false;
    }
    return true;
  },
);

const Icon = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d={d}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const ICONS: Record<ReviewStep, string> = {
  first: 'M4 3.5v9M12 3.5 7.5 8l4.5 4.5',
  previous: 'M10 3.5 5.5 8l4.5 4.5',
  next: 'M6 3.5 10.5 8 6 12.5',
  latest: 'M12 3.5v9M4 3.5 8.5 8 4 12.5',
};
const NAMES: Record<ReviewStep, string> = {
  first: 'Start',
  previous: 'Back',
  next: 'Forward',
  latest: 'Latest',
};
/** How a step's key is written in its title. */
const GLYPHS: Partial<Record<string, string>> = { ArrowLeft: '←', ArrowRight: '→' };
const keyName = (s: ReviewStep) => GLYPHS[STEP_KEY[s]] ?? STEP_KEY[s];

/**
 * The game's record, every move a button that shows the board after it, and
 * the four steps through it (the start, back, on, the latest; ← → Home End
 * too, while focus is not in a field). A glass panel beside the tower where
 * the window has room, otherwise a row of the steps under it whose middle,
 * the move shown, opens the list above them. The list serves screen readers
 * too: closed, it is out of sight but in the page.
 */
const MoveHistory: React.FC<MoveHistoryProps> = ({
  moves,
  applied,
  notation,
  shown,
  onShow,
  enabled,
  ended = false,
  hidden = false,
  analysis,
  reviewAsked = 0,
}) => {
  // Where the window has room the list is always open; where it has not,
  // it opens on asking (never while the game is on)
  const narrow = useMediaQuery(NARROW);
  const [asked, setAsked] = React.useState(false);
  const open = !hidden && (!narrow || asked);
  const reviewing = shown < applied;
  // The player has stepped through the record (so a return to the game is said)
  const [stepped, setStepped] = React.useState(false);

  // The same callback from one render to the next, so a step renders only
  // the blocks it changes
  const latest = React.useRef({ onShow, shown, applied, enabled: enabled && !hidden });
  latest.current = { onShow, shown, applied, enabled: enabled && !hidden };
  const show = React.useCallback((ply: number) => {
    if (!latest.current.enabled || ply === latest.current.shown) return;
    setStepped(true);
    latest.current.onShow(ply);
  }, []);
  const step = React.useCallback(
    (s: ReviewStep) => show(stepTo(s, latest.current.shown, latest.current.applied)),
    [show],
  );

  // Opened in a narrow window, where it stands over the tower: put away by a
  // press anywhere else, or Escape (focus back on its toggle if it was in it)
  const nav = React.useRef<HTMLElement>(null);
  const toggle = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!narrow || !asked) return;
    const away = (e: PointerEvent) => {
      if (!nav.current?.contains(e.target as Node)) setAsked(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (inField(e.target)) return;
      if (nav.current?.contains(document.activeElement)) focusFromCode(toggle.current);
      setAsked(false);
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', escape);
    };
  }, [narrow, asked]);

  // ← → Home End, wherever focus is but in a field
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!latest.current.enabled || e.defaultPrevented) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const s = stepOfKey(e.key);
      if (!s) return;
      if (inField(e.target)) return;
      e.preventDefault();
      step(s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  // The blocks in view (the last two, and the shown move's) on the first
  // render, the whole record in the render after it: a reopened game of
  // thousands of moves shows its record without waiting on the list's
  // thousands of buttons, which come a moment later (a deferred render), above
  const whole = React.useDeferredValue(true, false);

  // Asked for the review: the list open, and the focus on the move shown
  // once it is (by the layout effect after this one, in the same commit
  // where the list was open already)
  const focusAsked = React.useRef(false);
  React.useLayoutEffect(() => {
    if (reviewAsked === 0) return;
    focusAsked.current = true;
    // Where the window has room the list is open already
    if (narrow) setAsked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on the ask alone
  }, [reviewAsked]);

  // The shown move kept in view in the list (the latest, as moves land),
  // and focus kept on it while it is in the list
  const list = React.useRef<HTMLOListElement>(null);
  React.useLayoutEffect(() => {
    const ol = list.current;
    if (!ol || !open) return;
    const button = ol.querySelector<HTMLElement>(`[data-ply="${shown}"]`);
    if (!button) {
      ol.scrollTop = 0;
      return;
    }
    // Scrolled by hand rather than scrollIntoView, which would scroll the
    // game's page too. Measured from the list's rects, not offsetTop: each
    // row's containment (content-visibility) makes it its button's offset parent
    const top = button.getBoundingClientRect().top - ol.getBoundingClientRect().top + ol.scrollTop;
    const pad = 6;
    if (top - pad < ol.scrollTop) ol.scrollTop = top - pad;
    else if (top + button.offsetHeight + pad > ol.scrollTop + ol.clientHeight) {
      ol.scrollTop = top + button.offsetHeight + pad - ol.clientHeight;
    }
    if (focusAsked.current) {
      focusAsked.current = false;
      focusFromCode(button, { preventScroll: true });
    } else if (ol.contains(document.activeElement) && document.activeElement !== button) {
      // Focus follows the player's own place in the list, ring as the browser
      // decides. Not focusFromCode, which is for focus the page picks with no
      // input from the player: after the player's own click it would quiet the
      // ring, and their next Tab would only show it instead of moving on as it
      // does after any click (ledger 1016:FT1, the owner's call; CLAUDE.md "Gotchas")
      // (the list was scrolled by hand above: a focus's own scroll could move
      // the page under the HUD on a phone, 1016:FT2)
      // eslint-disable-next-line no-restricted-syntax
      button.focus({ preventScroll: true });
    }
  }, [shown, moves.length, open, whole, reviewAsked]);

  const blocks = [];
  for (let start = 0; start < moves.length; start += BLOCK) {
    const inView = start + 2 * BLOCK >= moves.length || (shown > start && shown <= start + BLOCK);
    if (!whole && !inView) continue;
    blocks.push(
      <MoveBlock
        key={start}
        moves={moves}
        notation={notation}
        start={start}
        applied={applied}
        shown={shown > start && shown <= start + BLOCK ? shown : -1}
        open={open}
        words={hidden}
        grades={(!hidden && analysis?.grades) || NO_GRADES}
        onShow={show}
      />,
    );
  }

  // Nothing to show before the first move
  if (moves.length === 0) return null;
  // The last row's number, in digits
  const digits = String(Math.ceil(moves.length / 2)).length;
  // While the game is on, the record is said, not shown
  if (hidden) {
    return (
      <nav
        className="sr-only"
        aria-label="Moves played"
        data-testid="move-history"
        data-viewing-ply={shown}
        data-hidden
      >
        <ol id="move-list" ref={list} aria-label="Move history" data-testid="move-list">
          {blocks}
        </ol>
      </nav>
    );
  }
  const shownWords = shown > 0 ? moveWords(moves, notation, shown - 1) : '';
  const shownNote = shown > 0 ? notation[shown - 1] : undefined;
  const shownGrade = (shown > 0 && analysis?.grades[shown - 1]) || null;
  const best = analysis?.best ?? null;
  const bestNotation = analysis?.bestNotation ?? null;
  const stepButton = (s: ReviewStep, off: boolean) => (
    <button
      type="button"
      className="hud-step"
      data-step={s}
      aria-label={NAMES[s]}
      title={`${NAMES[s]} (${keyName(s)})`}
      aria-keyshortcuts={STEP_KEY[s]}
      // Not disabled, which would drop the focus of a player stepping with it
      aria-disabled={off || undefined}
      onClick={() => {
        if (!off) step(s);
      }}
    >
      <Icon d={ICONS[s]} />
    </button>
  );
  const steps = (
    <div className="hud-steps">
      {stepButton('first', shown === 0)}
      {stepButton('previous', shown === 0)}
      <button
        ref={toggle}
        type="button"
        className="hud-now"
        aria-expanded={open}
        aria-controls="move-list"
        onClick={() => setAsked(!open)}
      >
        <span className="sr-only">Move list, at</span> {plyNumber(shown)}
        {shownNote ? (
          <>
            {' '}
            <span aria-hidden>
              <MoveText notation={shownNote} />
            </span>
            <span className="sr-only">{shownWords}</span>
          </>
        ) : (
          shown > 0 && ` ${shownWords}`
        )}
        {shownGrade && <Mark grade={shownGrade} />}
      </button>
      {stepButton('next', !reviewing)}
      {stepButton('latest', !reviewing)}
    </div>
  );
  // In a narrow window the steps stand at the top (the pill's place, once the
  // result card is put away) and the list opens under them: first in the
  // page too, so Tab goes from the toggle into the list it opened
  const stepsFirst = narrow;
  return (
    <nav
      ref={nav}
      className="hud-history hud-glass"
      aria-label="Moves played"
      data-testid="move-history"
      data-viewing-ply={shown}
      data-review={reviewing || undefined}
      data-open={open || undefined}
      data-ended={ended || undefined}
      data-analysis={analysis && analysis.state !== 'idle' ? analysis.state : undefined}
      data-best={
        best ? `${best.from}-${best.to}${best.promotion ? `=${best.promotion}` : ''}` : undefined
      }
    >
      {stepsFirst && steps}
      {/* The review, once begun: each side's marks as they come */}
      {open && analysis && analysis.state !== 'idle' && <ReviewHead analysis={analysis} />}
      <ol
        id="move-list"
        ref={list}
        className={open ? 'hud-moves' : 'hud-moves sr-only'}
        aria-label="Move history"
        data-testid="move-list"
        // How many digits the last move's number has, from three on: the
        // numbers' column widens to hold it (index.css)
        data-digits={digits > 2 ? digits : undefined}
      >
        {blocks}
      </ol>
      {/* The better move where the move shown was played, drawn on the board too */}
      {open && best && (
        <p className="hud-best" data-testid="best-move">
          <span className="hud-best-line" aria-hidden />
          Best{' '}
          {bestNotation ? (
            <>
              <span aria-hidden>
                <MoveText notation={bestNotation} />
              </span>
              <span className="sr-only">{notationWords(bestNotation)}</span>
            </>
          ) : (
            formatMove(best as MoveRecord)
          )}
        </p>
      )}
      {!stepsFirst && steps}
      {/* Where the board stands, said as the player steps */}
      <div className="sr-only" role="status">
        {!reviewing
          ? stepped
            ? 'Latest move.'
            : ''
          : shown === 0
            ? 'Starting position.'
            : `Move ${shown} of ${applied}: ${shownWords}${shownGrade ? `, ${shownGrade}` : ''}.${
                best
                  ? ` Best ${bestNotation ? notationWords(bestNotation) : formatMove(best as MoveRecord)}.`
                  : ''
              }`}
      </div>
      {/* How the review ended, said when it does (the bar and the counts are seen) */}
      <div className="sr-only" role="status" data-testid="review-said">
        {analysis?.state === 'done'
          ? 'Review done.'
          : analysis?.state === 'stopped'
            ? 'Review stopped.'
            : ''}
      </div>
    </nav>
  );
};

export default MoveHistory;

const SIDES: readonly Turn[] = ['white', 'black'];
const GRADE_PLURAL: Record<Grade, string> = {
  inaccuracy: 'inaccuracies',
  mistake: 'mistakes',
  blunder: 'blunders',
};
const plural = (n: number, grade: Grade) =>
  n === 1 ? `1 ${grade}` : `${n === 0 ? 'no' : n} ${GRADE_PLURAL[grade]}`;

/**
 * The top of the list once the review has begun: each side's marks counted
 * by grade, a thin bar under them filling as the review goes, or "Retry"
 * should it stop short.
 */
function ReviewHead({ analysis }: { analysis: HistoryAnalysis }) {
  return (
    <div className="hud-review" data-testid="analysis-counts">
      {SIDES.map((side) => {
        const counts = analysis.counts[side];
        return (
          <p key={side} className="hud-counts" data-side={side}>
            <Stone color={side} aria-hidden />
            <span className="sr-only">
              {sideName(side)}: {GRADES.map((g) => plural(counts[g], g)).join(', ')}
            </span>
            {GRADES.map((g) => (
              <span key={g} className="hud-count" data-grade={g} data-count={counts[g]} aria-hidden>
                <span className="hud-mark" data-grade={g}>
                  {GRADE_GLYPH[g]}
                </span>
                {counts[g]}
              </span>
            ))}
          </p>
        );
      })}
      {analysis.state === 'stopped' && (
        <p className="hud-stopped">
          Review stopped{' '}
          <button
            type="button"
            className="hud-retry"
            data-testid="retry"
            onClick={analysis.onRetry}
          >
            Retry
          </button>
        </p>
      )}
      {analysis.state === 'running' && (
        <div
          className="hud-progress"
          role="progressbar"
          aria-label="Reviewing"
          aria-valuemin={0}
          aria-valuemax={analysis.total}
          aria-valuenow={analysis.done}
          data-testid="analysis-progress"
        >
          <span style={{ width: `${(100 * analysis.done) / Math.max(1, analysis.total)}%` }} />
        </div>
      )}
    </div>
  );
}
