import React from 'react';
import type { Board, Move } from '../engine';
import type { Color, MoveRecord } from '../types/messages';
import { parseTypedMove } from '../game/typedMove';

interface MoveCardProps {
  board: Board;
  color: Color | null;
  /** The whole move record, as the server holds it. */
  moves: MoveRecord[];
  /** It is this player's move and the board takes input. */
  canMove: boolean;
  /** It is this player's turn (whether or not the board takes input). */
  yourTurn: boolean;
  onMove: (move: Move) => void;
}

// A move as the wire writes it (level-file-rank), with an en dash, so a
// record this client cannot replay still lists.
const formatMove = (m: MoveRecord) => `${m.from}–${m.to}${m.promotion ? `=${m.promotion}` : ''}`;

const Enter = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden>
    <path strokeWidth="1.7" strokeLinecap="round" d="M13 3v5.5a2 2 0 0 1-2 2H3.5" />
    <path
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6.5 7.5 3.5 10.5l3 3"
    />
  </svg>
);

/** Moves a block of the list holds (an even number: a row is two moves). */
const BLOCK = 64;

/** The rows of moves `start` to `start + BLOCK` (as many as there are). */
const MoveBlock = React.memo(
  ({ moves, start }: { moves: MoveRecord[]; start: number }) => {
    const rows = [];
    for (let i = start; i < Math.min(moves.length, start + BLOCK); i += 2) {
      const white = moves[i];
      const black = moves[i + 1];
      rows.push(
        <li key={i / 2 + 1}>
          {i / 2 + 1}. {formatMove(white)} {black ? formatMove(black) : ''}
        </li>,
      );
    }
    return rows;
  },
  // A record grows at its end, so only the last block changes as a move
  // lands; the others hold the same records and are left alone
  (a, b) => {
    if (a.start !== b.start) return false;
    const end = a.start + BLOCK;
    if (Math.min(a.moves.length, end) !== Math.min(b.moves.length, end)) return false;
    for (let i = a.start; i < Math.min(a.moves.length, end); i++) {
      if (a.moves[i] !== b.moves[i]) return false;
    }
    return true;
  },
);

/**
 * The record, in the page for screen readers: a row per two moves, in
 * blocks, so a move landing in a long game renders one block, not the list,
 * and typing in the field renders none.
 */
const MoveList = React.memo(({ moves }: { moves: MoveRecord[] }) => {
  const blocks = [];
  for (let start = 0; start < moves.length; start += BLOCK) {
    blocks.push(<MoveBlock key={start} moves={moves} start={start} />);
  }
  return (
    <ol className="sr-only" aria-label="Move history" data-testid="move-list">
      {blocks}
    </ol>
  );
});

/**
 * A field to type the next move ("Bb1-Cb1", "=Q" to promote), at the bottom
 * left, and the moves so far. It stays in the page but out of sight: the list
 * for screen readers, and the field, which appears when it takes keyboard
 * focus (Tab) and goes again when it loses it empty.
 */
const MoveCard: React.FC<MoveCardProps> = ({ board, color, moves, canMove, yourTurn, onMove }) => {
  const [text, setText] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);
  // Escape put the card away: it stays out of sight, though focus waits on
  // the card itself, until its field is reached again
  const [dismissed, setDismissed] = React.useState(false);
  const cardRef = React.useRef<HTMLElement | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!color || text.trim() === '') return;
    if (!yourTurn) {
      setProblem('Wait for their move.');
      return;
    }
    if (!canMove) return;
    const result = parseTypedMove(text, board, color);
    if ('error' in result) {
      setProblem(result.error);
      return;
    }
    setProblem(null);
    setText('');
    onMove(result.move);
  };

  const revealed = (focused || text !== '') && !dismissed;
  return (
    <section
      className="hud-card hud-glass"
      aria-label="Moves"
      data-testid="move-card"
      data-hidden={revealed ? undefined : ''}
      ref={cardRef}
      // Focus rests here after Escape, so the next Tab reaches the field
      // (not the button after it) and brings the card back
      tabIndex={-1}
      // Shown while keyboard focus is on the field or its button, so Tab
      // never lands on something out of sight
      onFocus={(e) => {
        setFocused(true);
        if (e.target !== e.currentTarget) setDismissed(false);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
          setDismissed(false);
        }
      }}
      onKeyDown={(e) => {
        // Escape puts a card that Tab brought up away again (the text with it)
        if (e.key === 'Escape') {
          setText('');
          setProblem(null);
          setDismissed(true);
          cardRef.current?.focus();
        }
      }}
    >
      {/* The record, in the page for screen readers */}
      <MoveList moves={moves} />
      <form onSubmit={submit} aria-label="Type a move">
        <label htmlFor="typed-move" className="sr-only">
          Type a move, like Bb1-Cb1
        </label>
        <div className="hud-field">
          <input
            id="typed-move"
            value={text}
            placeholder="Type a move"
            onChange={(e) => {
              setText(e.target.value);
              setProblem(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-invalid={problem !== null}
            aria-describedby="typed-move-problem"
          />
          {/* Never disabled: a disabled default button would swallow Enter,
              and Enter on the opponent's turn should say why nothing happens */}
          <button
            type="submit"
            className="hud-go"
            aria-label="Play the move"
            data-ready={(canMove && text.trim() !== '') || undefined}
          >
            <Enter />
          </button>
        </div>
        <div id="typed-move-problem" className="hud-problem" role="status">
          {problem}
        </div>
        {focused && !problem && (
          <div className="hud-hint" aria-hidden>
            e.g. Bb1-Cb1, then Enter · Esc to hide
          </div>
        )}
      </form>
    </section>
  );
};

export default MoveCard;
