import { buildKnight } from './knight';
import { buildPieceSet, pieceSet } from './set';
import type { PieceQuality, PieceSet } from './set';

// The set at any quality, its knight sculpted here (knight.ts, on sdf.ts and
// decimate.ts), for the piece gallery, the benches and the tests. The game
// draws only the medium set, whose knight ships precomputed (pieceSet), so
// none of the sculpting is in its build.

const shared = new Map<PieceQuality, PieceSet>();

/** The set at `quality` (medium is the game's own set), built on first use and shared. */
export const sculptedPieceSet = (quality: PieceQuality): PieceSet => {
  if (quality === 'medium') return pieceSet();
  let set = shared.get(quality);
  if (!set) {
    set = buildPieceSet(quality, (d) => buildKnight(d.step, d.knight));
    shared.set(quality, set);
  }
  return set;
};
