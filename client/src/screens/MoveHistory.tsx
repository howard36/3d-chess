import React from 'react';
import type { MoveRecord } from '../types/messages';
import { formatMove, plyLabel, stepOfKey, stepTo } from '../game/review';
import type { ReviewStep } from '../game/review';

export interface MoveHistoryProps {
  /** The whole move record, as the server holds it. */
  moves: MoveRecord[];
  /** How many of them can be shown (all but a record past one the replay could not play). */
  applied: number;
  /** The ply the board shows: `applied` at the live position. */
  shown: number;
  /** A move has landed since the player began to look back. */
  newer: boolean;
  /** Shows the position after `ply` moves (`applied`: the live position). */
  onShow: (ply: number) => void;
  /**
   * Whether the steps act (the buttons, the moves, ← → Home End): not
   * behind a dialog, nor while the game's entrance plays.
   */
  enabled: boolean;
  /** The game is over and "Play again" stands under the tower (index.css keeps clear of it). */
  ended?: boolean;
}

/** Moves a block of the list holds (an even number: a row is two moves). */
const BLOCK = 64;

/** A window too narrow for the list beside the tower: it opens on asking (index.css). */
const NARROW = '(max-aspect-ratio: 13/9) and (min-height: 481px)';
const narrowNow = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(NARROW).matches;

/** Whether the window is narrow (NARROW), following it as it changes. */
function useNarrow() {
  const [narrow, setNarrow] = React.useState(narrowNow);
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW);
    const changed = () => setNarrow(query.matches);
    query.addEventListener?.('change', changed);
    return () => query.removeEventListener?.('change', changed);
  }, []);
  return narrow;
}

interface BlockProps {
  moves: MoveRecord[];
  start: number;
  applied: number;
  /** The ply shown, if it is one of this block's moves (else -1). */
  shown: number;
  /** The list is open: its shown move takes Tab. */
  open: boolean;
  onShow: (ply: number) => void;
}

/** The rows of moves `start` to `start + BLOCK` (as many as there are), each move a button. */
const MoveBlock = React.memo(
  ({ moves, start, applied, shown, open, onShow }: BlockProps) => {
    const ply = (i: number) => {
      const n = i + 1;
      return (
        <button
          type="button"
          className="hud-ply"
          data-ply={n}
          aria-current={n === shown ? 'step' : undefined}
          // One stop in the list for Tab, the shown move (← → step on)
          tabIndex={open && n === shown ? 0 : -1}
          // A record past one the replay could not play has no position to show
          disabled={n > applied}
          onClick={() => onShow(n)}
        >
          {/* One text node; Black's starts with the space between the two
              (white space at a line's start is not drawn) */}
          {n % 2 === 0 ? ` ${formatMove(moves[i])}` : formatMove(moves[i])}
        </button>
      );
    };
    const rows = [];
    for (let i = start; i < Math.min(moves.length, start + BLOCK); i += 2) {
      // Three nodes a row and one text node each (the number, then the
      // moves), no wrappers or spacers: a reopened game of thousands of
      // moves mounts its whole record at once. It reads "1. Bb1–Cb1 Dd5–Cd5".
      rows.push(
        <li key={i / 2 + 1}>
          {`${i / 2 + 1}. `}
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
    if (a.onShow !== b.onShow) return false;
    const end = a.start + BLOCK;
    if (Math.min(a.applied, end) !== Math.min(b.applied, end)) return false;
    if (Math.min(a.moves.length, end) !== Math.min(b.moves.length, end)) return false;
    for (let i = a.start; i < Math.min(a.moves.length, end); i++) {
      if (a.moves[i] !== b.moves[i]) return false;
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
const KEYS: Record<ReviewStep, string> = {
  first: 'Home',
  previous: '←',
  next: '→',
  latest: 'End',
};

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
  shown,
  newer,
  onShow,
  enabled,
  ended = false,
}) => {
  // Where the window has room the list is always open; where it has not,
  // it opens on asking
  const narrow = useNarrow();
  const [asked, setAsked] = React.useState(false);
  const open = !narrow || asked;
  const reviewing = shown < applied;
  // The player has stepped through the record (so a return to the game is said)
  const [stepped, setStepped] = React.useState(false);

  // The same callback from one render to the next, so a step renders only
  // the blocks it changes
  const latest = React.useRef({ onShow, shown, applied, enabled });
  latest.current = { onShow, shown, applied, enabled };
  const show = React.useCallback((ply: number) => {
    if (!latest.current.enabled || ply === latest.current.shown) return;
    setStepped(true);
    latest.current.onShow(ply);
  }, []);
  const step = React.useCallback(
    (s: ReviewStep) => show(stepTo(s, latest.current.shown, latest.current.applied)),
    [show],
  );

  // ← → Home End, wherever focus is but in a field
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!latest.current.enabled || e.defaultPrevented) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const s = stepOfKey(e.key);
      if (!s) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      step(s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

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
    // game's page too
    const top = button.offsetTop - ol.offsetTop;
    const pad = 6;
    if (top - pad < ol.scrollTop) ol.scrollTop = top - pad;
    else if (top + button.offsetHeight + pad > ol.scrollTop + ol.clientHeight) {
      ol.scrollTop = top + button.offsetHeight + pad - ol.clientHeight;
    }
    if (ol.contains(document.activeElement) && document.activeElement !== button) button.focus();
  }, [shown, moves.length, open]);

  const blocks = [];
  for (let start = 0; start < moves.length; start += BLOCK) {
    blocks.push(
      <MoveBlock
        key={start}
        moves={moves}
        start={start}
        applied={applied}
        shown={shown > start && shown <= start + BLOCK ? shown : -1}
        open={open}
        onShow={show}
      />,
    );
  }

  // Nothing to show before the first move
  if (moves.length === 0) return null;
  const label = plyLabel(moves, shown);
  const stepButton = (s: ReviewStep, off: boolean, named = false) => (
    <button
      type="button"
      className="hud-step"
      data-step={s}
      aria-label={NAMES[s]}
      title={`${NAMES[s]} (${KEYS[s]})`}
      // Not disabled, which would drop the focus of a player stepping with it
      aria-disabled={off || undefined}
      onClick={() => {
        if (!off) step(s);
      }}
    >
      {/* Its name beside it where there is room (index.css): the way back lit */}
      {named && (
        <span className="hud-step-name" aria-hidden>
          {NAMES[s]}
        </span>
      )}
      <Icon d={ICONS[s]} />
    </button>
  );
  return (
    <nav
      className="hud-history hud-glass"
      aria-label="Moves played"
      data-testid="move-history"
      data-viewing-ply={shown}
      data-review={reviewing || undefined}
      data-open={open || undefined}
      data-ended={ended || undefined}
    >
      <ol
        id="move-list"
        ref={list}
        className={open ? 'hud-moves' : 'hud-moves sr-only'}
        aria-label="Move history"
        data-testid="move-list"
      >
        {blocks}
      </ol>
      <div className="hud-steps">
        {stepButton('first', shown === 0)}
        {stepButton('previous', shown === 0)}
        <button
          type="button"
          className="hud-now"
          aria-expanded={open}
          aria-controls="move-list"
          onClick={() => setAsked(!open)}
        >
          <span className="sr-only">Move list, at </span>
          {label}
        </button>
        {stepButton('next', !reviewing)}
        <span className="hud-latest" data-newer={(reviewing && newer) || undefined}>
          {stepButton('latest', !reviewing, true)}
        </span>
      </div>
      {/* Where the board stands, said as the player steps */}
      <div className="sr-only" role="status">
        {!reviewing
          ? stepped
            ? 'Latest move.'
            : ''
          : shown === 0
            ? 'Starting position.'
            : `Move ${shown} of ${applied}: ${formatMove(moves[shown - 1])}.`}
      </div>
    </nav>
  );
};

export default MoveHistory;
