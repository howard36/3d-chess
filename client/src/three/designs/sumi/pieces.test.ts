import { describe, expect, it } from 'vitest';
import { PieceType } from '../../../engine/pieces';
import { pieceGeometry } from './pieces';

describe('sumi piece geometry', () => {
  const types = Object.values(PieceType) as PieceType[];

  it('builds one merged body per piece type, with an outline normal per vertex', () => {
    for (const type of types) {
      const { body } = pieceGeometry(type);
      const position = body.getAttribute('position');
      const outline = body.getAttribute('aOutline');
      expect(position.count).toBeGreaterThan(0);
      expect(outline.count).toBe(position.count);
      // Outline normals are unit length, so the ink line keeps one width
      for (let i = 0; i < outline.count; i += 97) {
        const l = Math.hypot(outline.getX(i), outline.getY(i), outline.getZ(i));
        expect(l).toBeCloseTo(1, 3);
      }
    }
  });

  it('keeps every piece inside its square and under the platform above', () => {
    for (const type of types) {
      const { body, accent } = pieceGeometry(type);
      for (const g of [body, accent]) {
        if (!g) continue;
        g.computeBoundingBox();
        const box = g.boundingBox!;
        expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
        // The tallest (the king) is 0.87 in piece units
        expect(box.max.y).toBeLessThanOrEqual(0.88);
        expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z)).toBeLessThan(0.32);
      }
    }
  });

  it('gives the unicorn its gold horn and the knight its painted mane', () => {
    expect(pieceGeometry(PieceType.Unicorn).accent).toBeDefined();
    expect(pieceGeometry(PieceType.Knight).groove).toBeDefined();
    expect(pieceGeometry(PieceType.Bishop).accent).toBeUndefined();
  });
});
