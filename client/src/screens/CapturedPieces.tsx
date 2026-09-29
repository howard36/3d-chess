import React from 'react';
import type { Board } from '../engine';
import type { PieceType } from '../engine/pieces';
import type { Turn } from '../game/history';
import { describeTaken, groupTaken, materialLead } from '../game/material';
import type { TakenGroup } from '../game/material';
import { PieceGlyph } from './PieceGlyph';

interface CapturedPiecesProps {
  /** This player's colour. */
  seat: Turn;
  /** The pieces each side has taken (GameHistory.captured). */
  captured: Record<Turn, PieceType[]>;
  /** The position, for the material lead. */
  board: Board;
}

const other = (side: Turn): Turn => (side === 'white' ? 'black' : 'white');

/**
 * One side's haul: a silhouette per kind of piece taken, in the taken army's
 * material, with how many when more than one, and the material lead when this
 * side is ahead. Said in words to a screen reader.
 */
const Haul = ({
  side,
  groups,
  material,
  lead,
  said,
}: {
  side: 'me' | 'them';
  groups: TakenGroup[];
  material: Turn;
  lead: number;
  said: string;
}) => (
  <p className="hud-haul" data-side={side} data-empty={said === '' || undefined}>
    <span className="sr-only">{said}</span>
    {groups.map(({ type, count }) => (
      <span key={type} className="hud-taken" aria-hidden>
        <PieceGlyph type={type} color={material} size={16} />
        {count > 1 && <span className="hud-count">{count}</span>}
      </span>
    ))}
    {lead > 0 && (
      <span className="hud-lead" aria-hidden>
        +{lead}
      </span>
    )}
  </p>
);

/**
 * The pieces each side has taken, under the turn pill: yours under your half
 * (the opponent's pieces, in their material), theirs under theirs, and "+N"
 * on the side ahead on material. Quiet: nothing until the first capture, and
 * not a live region (the move announcer already says each capture as it
 * lands); a screen reader finds it after the pill.
 */
const CapturedPieces: React.FC<CapturedPiecesProps> = ({ seat, captured, board }) => {
  const them = other(seat);
  const lead = React.useMemo(() => materialLead(board, seat), [board, seat]);
  const mine = groupTaken(captured[seat]);
  const theirs = groupTaken(captured[them]);
  if (mine.length === 0 && theirs.length === 0 && lead === 0) return null;
  return (
    <div className="hud-captures" data-testid="captured-pieces">
      <Haul
        side="me"
        groups={mine}
        material={them}
        lead={Math.max(lead, 0)}
        said={describeTaken(mine, lead, 'you')}
      />
      <Haul
        side="them"
        groups={theirs}
        material={seat}
        lead={Math.max(-lead, 0)}
        said={describeTaken(theirs, -lead, 'opponent')}
      />
    </div>
  );
};

export default CapturedPieces;
