import type { OcclusionData } from '../scene/occlusionData';
import type { KnightData } from './knightData';

// The set's precomputed parts (the knight's meshes, and the occlusion of
// every piece but the king, whose ships with the scene: occlusion.king.ts)
// are a chunk of their own, about a quarter of the scene's bytes: the
// lobby, which draws only kings, never waits for them. Whatever draws the
// other pieces (the game's board, the tutorial's, the start page's preview)
// loads this alongside its own chunk, before it first renders.

export interface PieceData {
  knight: KnightData;
  occlusion: OcclusionData;
}

let loaded: PieceData | null = null;
let pending: Promise<PieceData> | null = null;

/** Loads the set's precomputed parts, once (again after a failed load). */
export const loadPieceData = (): Promise<PieceData> =>
  (pending ??= import('./pieceData.files').then(
    ({ KNIGHT_MEDIUM, OCCLUSION_MEDIUM }) =>
      (loaded = { knight: KNIGHT_MEDIUM, occlusion: OCCLUSION_MEDIUM }),
    (error: unknown) => {
      pending = null;
      throw error;
    },
  ));

/** The set's precomputed parts, which must have loaded (loadPieceData). */
export const pieceData = (): PieceData => {
  if (!loaded) throw new Error('The piece set’s data has not loaded: await loadPieceData() first');
  return loaded;
};
