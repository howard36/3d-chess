import React from 'react';
import type { Board, Move } from '../engine';
import type { Color } from '../types/messages';
import { parseTypedMove } from '../game/typedMove';

export interface MoveInputProps {
  board: Board;
  color: Color | null;
  /** Whether the player may move now (their turn, connected, nothing in flight). */
  canMove: boolean;
  onMove: (move: Move) => void;
}

/**
 * Plays a move typed as text ("Ab2-Ab3", "=Q" to promote). The board itself
 * only takes pointer input, so this is how a keyboard-only or screen-reader
 * player makes a move; it also suits anyone who reads moves off the list.
 */
const MoveInput: React.FC<MoveInputProps> = ({ board, color, canMove, onMove }) => {
  const [text, setText] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!color || !canMove) return;
    const result = parseTypedMove(text, board, color);
    if ('error' in result) {
      setProblem(result.error);
      return;
    }
    setProblem(null);
    setText('');
    onMove(result.move);
  };

  return (
    <form
      onSubmit={submit}
      aria-label="Type a move"
      style={{
        pointerEvents: 'auto',
        backgroundColor: 'rgba(0,0,0,0.55)',
        color: 'white',
        borderRadius: 8,
        padding: '8px 10px',
        fontSize: 13,
        maxWidth: 260,
      }}
    >
      <label htmlFor="typed-move" style={{ display: 'block', marginBottom: 4, opacity: 0.85 }}>
        Type a move (e.g. Ab2-Ab3)
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          id="typed-move"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem !== null}
          aria-describedby={problem ? 'typed-move-problem' : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '4px 6px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.4)',
            background: 'rgba(255,255,255,0.1)',
            color: 'white',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
        <button
          type="submit"
          disabled={!canMove || text.trim() === ''}
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            background: 'white',
            color: '#222',
            fontWeight: 600,
            opacity: !canMove || text.trim() === '' ? 0.5 : 1,
          }}
        >
          Move
        </button>
      </div>
      <div id="typed-move-problem" role="status" style={{ marginTop: problem ? 4 : 0 }}>
        {problem}
      </div>
    </form>
  );
};

export default MoveInput;
