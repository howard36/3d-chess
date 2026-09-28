import React from 'react';
import type { Board, Move } from '../engine';
import type { Color, MoveRecord } from '../types/messages';
import { parseTypedMove } from '../game/typedMove';
import type { HoveredCell } from '../three/Board';
import { readoutParts } from '../three/hover';
import { Stone } from './TurnPill';

export interface MoveCardProps {
  board: Board;
  color: Color | null;
  /** The whole move record, as the server holds it. */
  moves: MoveRecord[];
  /** It is this player's move and the board takes input. */
  canMove: boolean;
  /** It is this player's turn (whether or not the board takes input). */
  yourTurn: boolean;
  onMove: (move: Move) => void;
  /** The Keyboard play setting: show the list, the readout and the field. */
  shown: boolean;
  /** The cell under the pointer, while the card is shown. */
  hovered: HoveredCell | null;
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

/**
 * The moves so far and a field to type the next one ("Bb1-Cb1", "=Q" to
 * promote), at the bottom left. The Keyboard play setting shows it, with the
 * cell under the pointer on top. Without the setting it stays in the page but
 * out of sight: the list for screen readers, and the field, which appears
 * when it takes keyboard focus (Tab) and goes again when it loses it empty.
 */
const MoveCard: React.FC<MoveCardProps> = ({
  board,
  color,
  moves,
  canMove,
  yourTurn,
  onMove,
  shown,
  hovered,
}) => {
  const [text, setText] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);
  const listRef = React.useRef<HTMLOListElement | null>(null);

  // Keep the newest move in view as rows are added
  React.useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      el.scrollLeft = el.scrollWidth;
    }
  }, [moves.length, shown]);

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

  const revealed = shown || focused || text !== '';
  const rows: { number: number; white: MoveRecord; black?: MoveRecord }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ number: i / 2 + 1, white: moves[i], black: moves[i + 1] });
  }
  const last = moves.length - 1;
  const readout = hovered ? readoutParts(hovered.zxy, hovered.piece) : null;

  return (
    <section
      className="hud-card hud-glass"
      aria-label="Moves"
      data-testid="move-card"
      data-hidden={revealed ? undefined : ''}
    >
      {shown && (
        <div className="hud-readout" aria-hidden style={{ opacity: readout ? 1 : 0.5 }}>
          {readout ? (
            <>
              <b>{readout.cell}</b>
              {readout.piece && <span>{readout.piece}</span>}
            </>
          ) : (
            <span>Point at a square</span>
          )}
        </div>
      )}
      {shown && moves.length > 0 && (
        <div className="hud-heads" aria-hidden>
          <span />
          <Stone color="white" />
          <Stone color="black" />
        </div>
      )}
      {/* The record, in the page for screen readers whether or not it is shown */}
      <ol
        ref={listRef}
        className={shown ? 'hud-moves selectable' : 'sr-only'}
        aria-label="Move history"
        data-testid="move-list"
      >
        {rows.map((row) => (
          <li key={row.number}>
            <span className="hud-n">{row.number}.</span>{' '}
            <span className="hud-m" data-last={row.number * 2 - 2 === last || undefined}>
              {formatMove(row.white)}
            </span>{' '}
            <span className="hud-m" data-last={row.number * 2 - 1 === last || undefined}>
              {row.black ? formatMove(row.black) : ''}
            </span>
          </li>
        ))}
      </ol>
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
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              // Escape puts a revealed field away again (the text with it)
              if (e.key === 'Escape' && !shown) {
                setText('');
                setProblem(null);
                e.currentTarget.blur();
              }
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
        {!shown && focused && !problem && (
          <div className="hud-hint" aria-hidden>
            e.g. Bb1-Cb1, then Enter · Esc to hide
          </div>
        )}
      </form>
    </section>
  );
};

export default MoveCard;
