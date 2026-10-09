import React from 'react';
import type { Board, Move } from '../engine';
import type { Color } from '../types/messages';
import { parseTypedMove } from '../game/typedMove';

interface MoveCardProps {
  board: Board;
  color: Color | null;
  /** It is this player's move and the board takes input. */
  canMove: boolean;
  /** It is this player's turn (whether or not the board takes input). */
  yourTurn: boolean;
  /** The board shows an earlier position (the move history's): a move is played from the latest. */
  reviewing?: boolean;
  onMove: (move: Move) => void;
}

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
 * A field to type the next move ("Bb1-Cb1", "=Q" to promote), at the bottom
 * left. It stays in the page but out of sight, and appears when it takes
 * keyboard focus (Tab) and goes again when it loses it empty. (The moves so
 * far are the move history's, MoveHistory.tsx.)
 */
const MoveCard: React.FC<MoveCardProps> = ({
  board,
  color,
  canMove,
  yourTurn,
  reviewing = false,
  onMove,
}) => {
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
    if (reviewing) {
      setProblem('Go to the latest move first.');
      return;
    }
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
