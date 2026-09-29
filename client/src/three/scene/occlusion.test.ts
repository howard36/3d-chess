import { describe, expect, it } from 'vitest';
import { PieceType } from '../../engine/pieces';
import { pieceSet } from '../pieces';
import { PART_ID, WELL_ID, wholePiece, bakedSet } from './occlusion';

// The baked occlusion must shade crevices, not open surfaces: the rook's
// hollow is shut in, the outside of its tower open, and every value is a
// share between 0 and 1.

const samples = (type: PieceType) => {
  const g = wholePiece(type);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  return Array.from({ length: p.count }, (_, i) => ({
    x: p.getX(i),
    y: p.getY(i),
    z: p.getZ(i),
    // The normal's share pointing out from the axis (negative: facing in)
    out: (n.getX(i) * p.getX(i) + n.getZ(i) * p.getZ(i)) / (Math.hypot(p.getX(i), p.getZ(i)) || 1),
    ao: uv.getX(i),
    part: uv.getY(i),
  }));
};

describe('baked occlusion', () => {
  // Builds and bakes every piece (the sculpted knight takes a while)
  it(
    'bakes a share in 0..1 and a part id into every vertex of every piece',
    { timeout: 30000 },
    () => {
      const parts = new Set([...Object.values(PART_ID), WELL_ID]);
      for (const type of Object.values(PieceType)) {
        const s = samples(type);
        expect(s.length).toBeGreaterThan(100);
        expect(Math.min(...s.map((v) => v.ao))).toBeGreaterThanOrEqual(0);
        expect(Math.max(...s.map((v) => v.ao))).toBeLessThanOrEqual(1);
        expect(s.every((v) => parts.has(v.part))).toBe(true);
        const mean = s.reduce((a, v) => a + v.ao, 0) / s.length;
        // Mostly open: a piece is not shaded all over
        expect(mean).toBeGreaterThan(0.6);
      }
    },
  );

  it("darkens the inside of the rook's well and keeps its tower's outside open", () => {
    const s = samples(PieceType.Rook);
    const top = Math.max(...s.map((v) => v.y));
    const r = (v: { x: number; z: number }) => Math.hypot(v.x, v.z);
    // The inside of its well, below the battlements
    const hollow = s.filter(
      (v) => v.y > top - 0.1 && v.y < top - 0.07 && r(v) > 0.05 && v.out < -0.6,
    );
    const wall = s.filter((v) => v.y > 0.25 && v.y < 0.3 && r(v) > 0.1);
    const mean = (xs: typeof s) => xs.reduce((a, v) => a + v.ao, 0) / xs.length;
    expect(hollow.length).toBeGreaterThan(0);
    expect(wall.length).toBeGreaterThan(0);
    expect(mean(hollow)).toBeLessThan(mean(wall) - 0.25);
    expect(mean(wall)).toBeGreaterThan(0.85);
  });

  it('bakes into copies, never the shared set', () => {
    expect(bakedSet()[PieceType.Pawn].body).not.toBe(pieceSet()[PieceType.Pawn].body);
    expect(pieceSet()[PieceType.Pawn].body.getAttribute('uv')).not.toBe(
      bakedSet()[PieceType.Pawn].body.getAttribute('uv'),
    );
  });
});
