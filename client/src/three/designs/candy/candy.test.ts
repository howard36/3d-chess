import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PieceType } from '../../../engine/pieces';
import { frame, PIECE_SCALE, TALLEST } from './palette';
import { geometriesFor } from './pieces';

// The toy set's measurements: what keeps every piece clear of the platform
// above, inside its own square, and the whole army inside the triangle
// budget of a software renderer.

const TYPES = Object.values(PieceType);

const bounds = (type: PieceType) => {
  const g = geometriesFor(type);
  const box = new Box3();
  for (const part of [g.body, g.trim, g.eyes]) {
    if (!part) continue;
    part.computeBoundingBox();
    box.union(part.boundingBox!);
  }
  return box;
};

const triangles = (type: PieceType) => {
  const g = geometriesFor(type);
  return [g.body, g.trim, g.eyes].reduce((n, part) => {
    if (!part) return n;
    return n + (part.index ? part.index.count : part.getAttribute('position').count) / 3;
  }, 0);
};

describe('candy toys', () => {
  it('stand on the floor and never reach past the tallest height the layout is framed for', () => {
    for (const type of TYPES) {
      const box = bounds(type);
      expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(box.max.y).toBeLessThanOrEqual(TALLEST + 1e-3);
    }
  });

  it('crown the king the tallest piece', () => {
    const king = bounds(PieceType.King).max.y;
    for (const type of TYPES) expect(bounds(type).max.y).toBeLessThanOrEqual(king + 1e-6);
  });

  it('leave clear air under the platform above, lifted as a selected piece is', () => {
    // Board's Lift (0.2) plus the design's own rise (0.1), in piece units
    const lifted = (TALLEST + 0.3) * PIECE_SCALE;
    expect(lifted).toBeLessThan(frame.gap * 0.72);
  });

  it('fit inside their own square', () => {
    for (const type of TYPES) {
      const box = bounds(type);
      const reach = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) * PIECE_SCALE;
      expect(reach).toBeLessThan(frame.pitch * 0.35);
    }
  });

  it('keep two full armies inside the triangle budget', () => {
    const army =
      10 * triangles(PieceType.Pawn) +
      2 * triangles(PieceType.Rook) +
      2 * triangles(PieceType.Knight) +
      2 * triangles(PieceType.Bishop) +
      2 * triangles(PieceType.Unicorn) +
      triangles(PieceType.Queen) +
      triangles(PieceType.King);
    expect(army * 2).toBeLessThan(110_000);
  });
});
