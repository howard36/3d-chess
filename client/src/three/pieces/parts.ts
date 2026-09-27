import type { BufferGeometry } from 'three';
import type { PieceType } from '../../engine/pieces';
import { mergeShells } from './mesh';
import type { PiecePart, PieceSet } from './set';

/** The parts in drawing order. */
export const PIECE_PARTS: readonly PiecePart[] = ['body', 'collar', 'accent', 'foot'];

const merged = new WeakMap<PieceSet, Map<string, BufferGeometry>>();

/**
 * One geometry holding several parts of a piece (e.g. body and collar in one
 * material), merged once per set and shared. Parts the piece lacks are
 * skipped; one part comes back as is. Never dispose or edit the result.
 */
export const partsGeometry = (
  set: PieceSet,
  type: PieceType,
  parts: readonly PiecePart[],
): BufferGeometry | null => {
  const present = PIECE_PARTS.filter((p) => parts.includes(p) && set[type][p]);
  if (present.length === 0) return null;
  if (present.length === 1) return set[type][present[0]]!;
  let cache = merged.get(set);
  if (!cache) {
    cache = new Map();
    merged.set(set, cache);
  }
  const key = `${type}:${present.join('+')}`;
  let g = cache.get(key);
  if (!g) {
    g = mergeShells(present.map((p) => set[type][p]!));
    cache.set(key, g);
  }
  return g;
};

/** Height of a piece's top (the king's is about 0.87). */
export const pieceTop = (set: PieceSet, type: PieceType): number =>
  Math.max(...PIECE_PARTS.map((p) => set[type][p]?.boundingBox?.max.y ?? 0));
