import { describe, expect, it, vi } from 'vitest';
import { OCCLUSION_MEDIUM } from '../scene/occlusion.medium';
import { KNIGHT_MEDIUM } from './knight.medium';

describe('the set’s precomputed parts', () => {
  it('throw until loaded, so nothing draws a piece without them', async () => {
    vi.resetModules();
    const { loadPieceData, pieceData } = await import('./pieceData');
    expect(() => pieceData()).toThrow(/loadPieceData/);
    const loading = loadPieceData();
    expect(loadPieceData()).toBe(loading);
    await loading;
    expect(pieceData()).toEqual({ knight: KNIGHT_MEDIUM, occlusion: OCCLUSION_MEDIUM });
  });
});
