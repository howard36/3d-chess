import React from 'react';
import type { MoveRecord } from '../types/messages';

export interface MoveListProps {
  moves: MoveRecord[];
}

// Renders a move as it appears on the wire (level-file-rank, e.g. Ab2), which
// is also the notation the README documents — no conversion, so the list stays
// renderable even for a record the engine can't replay.
const formatMove = (m: MoveRecord) =>
  `${m.from}–${m.to}${m.promotion ? `=${m.promotion}` : ''}`;

/**
 * Scrolling history of the game so far, one row per full move (White then
 * Black). Complements the last-move highlight on the board: the highlight
 * answers "what just happened", this answers "how did we get here".
 */
const MoveList: React.FC<MoveListProps> = ({ moves }) => {
  const listRef = React.useRef<HTMLOListElement | null>(null);

  // Keep the newest move visible as rows are added.
  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [moves.length]);

  if (moves.length === 0) return null;

  const rows: { number: number; white: MoveRecord; black?: MoveRecord }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ number: i / 2 + 1, white: moves[i], black: moves[i + 1] });
  }

  return (
    <ol
      ref={listRef}
      data-testid="move-list"
      aria-label="Move history"
      style={{
        position: 'absolute',
        bottom: '16px',
        right: '10px',
        margin: 0,
        padding: '8px 12px',
        listStyle: 'none',
        maxHeight: '40vh',
        overflowY: 'auto',
        backgroundColor: 'rgba(0,0,0,0.55)',
        color: 'white',
        borderRadius: '8px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        lineHeight: 1.7,
        zIndex: 1000,
      }}
    >
      {rows.map((row) => (
        <li key={row.number}>
          <span style={{ opacity: 0.6 }}>{row.number}.</span> {formatMove(row.white)}
          {row.black ? `  ${formatMove(row.black)}` : ''}
        </li>
      ))}
    </ol>
  );
};

export default MoveList;
