import React from 'react';
import type { Board } from '../engine';
import { PieceType } from '../engine/pieces';
import { materialBalance } from '../game/material';

type Side = 'white' | 'black';

// Small silhouettes on a 24-unit grid. The unicorn has no chess glyph in any
// font, so the whole set is drawn here and matches whatever font a design uses.
const GLYPHS: Record<PieceType, string> = {
  [PieceType.Pawn]:
    'M12 3.6a3.3 3.3 0 1 1 0 6.6a3.3 3.3 0 1 1 0-6.6zM9 11.4h6l1.6 7.1H7.4zM6 18.9h12V21H6z',
  [PieceType.Rook]:
    'M6 4h2.6v2.1h2.1V4h2.6v2.1h2.1V4H18v4.2l-2 1.6v6l2 2.5V21H6v-2.7l2-2.5v-6L6 8.2z',
  [PieceType.Bishop]:
    'M12 2.6a1.4 1.4 0 1 1 0 2.8a1.4 1.4 0 1 1 0-2.8zM12 5.9c3.4 2.4 4.4 5.1 2.8 7.8H9.2C7.6 11 8.6 8.3 12 5.9zM9 14.6h6l1.6 4H7.4zM6 19h12v2H6z',
  [PieceType.Knight]:
    'M7.5 21H19v-2.3l-1.1-1.2c.4-4.2-.6-9-5.6-11.8l-1-2.2-1.4 2.4C7.5 7.4 6 9.9 6.1 12.5l1.8 1.3 3-1.5c.3 1.7-.8 3.1-2.2 4.3l-1.2 2.1z',
  [PieceType.Unicorn]:
    'M7.5 21H19v-2.3l-1.1-1.2c.4-4.2-.6-9-5.6-11.8l-.4-.9L6.6 1.6l3.3 4.6C7.3 7.7 6 10 6.1 12.5l1.8 1.3 3-1.5c.3 1.7-.8 3.1-2.2 4.3l-1.2 2.1z',
  [PieceType.Queen]:
    'M4.5 7.5l3 8h9l3-8-3.8 3.4L12 4.6l-3.7 6.3zM7.4 16.6h9.2l1 2.4H6.4zM6 19.6h12V21H6z',
  [PieceType.King]:
    'M11 1.8h2v2h2v2h-2v2h-2v-2H9v-2h2zM7.6 9c2-1.3 6.8-1.3 8.8 0l-1.2 7.2H8.8zM7.6 16.8h8.8l1 2.4H6.6zM6 19.6h12V21H6z',
};

const NAMES: Record<PieceType, string> = {
  [PieceType.Pawn]: 'pawn',
  [PieceType.Rook]: 'rook',
  [PieceType.Bishop]: 'bishop',
  [PieceType.Knight]: 'knight',
  [PieceType.Unicorn]: 'unicorn',
  [PieceType.Queen]: 'queen',
  [PieceType.King]: 'king',
};

const Glyph = ({ type, side }: { type: PieceType; side: Side }) => (
  <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden style={{ flex: 'none' }}>
    <path
      d={GLYPHS[type]}
      fill={side === 'white' ? '#f6f0e4' : '#26262a'}
      stroke={side === 'white' ? '#3a3632' : '#c9c9d0'}
      strokeWidth={1.1}
      strokeLinejoin="round"
    />
  </svg>
);

const describe = (types: PieceType[]) => {
  const counts = new Map<PieceType, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${n} ${NAMES[t]}${n > 1 ? 's' : ''}`).join(', ');
};

/**
 * What the player has taken and lost so far, with the material score, as
 * two rows of small piece silhouettes. Shows nothing until the first capture.
 */
const CapturedPieces: React.FC<{ board: Board; color: Side }> = ({ board, color }) => {
  const { lost, advantage } = React.useMemo(() => materialBalance(board), [board]);
  const opponent: Side = color === 'white' ? 'black' : 'white';
  const taken = lost[opponent];
  const given = lost[color];
  if (taken.length === 0 && given.length === 0) return null;
  const lead = color === 'white' ? advantage : -advantage;
  const row = (types: PieceType[], side: Side, label: string, score?: number) =>
    types.length > 0 && (
      <div
        role="listitem"
        aria-label={`${label}: ${describe(types)}`}
        style={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
      >
        {types.map((t, i) => (
          <Glyph key={i} type={t} side={side} />
        ))}
        {score !== undefined && score > 0 && (
          <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.85 }}>+{score}</span>
        )}
      </div>
    );
  return (
    <div
      role="list"
      aria-label="Captured pieces"
      data-testid="captured-pieces"
      style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}
    >
      {row(taken, opponent, 'You captured', lead)}
      {row(given, color, 'You lost', -lead)}
    </div>
  );
};

export default CapturedPieces;
