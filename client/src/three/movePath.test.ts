import { describe, expect, it } from 'vitest';
import { PieceType } from '../engine/pieces';
import { clarityTower } from './designs/kit/layouts';
import { cellPitch, KNIGHT_ARC_PITCHES, knightArcHeight, moveArc, movePoint } from './movePath';

describe('movePath', () => {
  it('runs a move in a straight line, whatever its level change', () => {
    const from: [number, number, number] = [0, 0, 0];
    const to: [number, number, number] = [2, 2.7, -1];
    expect(movePoint(from, to, 0)).toEqual(from);
    expect(movePoint(from, to, 1)).toEqual(to);
    for (const e of [0.1, 0.25, 0.5, 0.9]) {
      const p = movePoint(from, to, e);
      p.forEach((v, i) => expect(v).toBeCloseTo(to[i] * e));
    }
  });

  it('lifts a knight’s arc to its height above the line’s midpoint, and no further', () => {
    const from: [number, number, number] = [0, 1, 0];
    const to: [number, number, number] = [1, 3.7, 2];
    const peak = movePoint(from, to, 0.5, 0.6);
    expect(peak[1]).toBeCloseTo((1 + 3.7) / 2 + 0.6);
    for (let e = 0; e <= 1; e += 0.05) {
      const lineY = 1 + 2.7 * e;
      expect(movePoint(from, to, e, 0.6)[1] - lineY).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });

  it('measures the cell pitch of any layout, and sizes the knight’s arc by it', () => {
    expect(cellPitch(clarityTower())).toBeCloseTo(1);
    expect(cellPitch(clarityTower({ pitch: 1.2 }))).toBeCloseTo(1.2);
    expect(knightArcHeight(clarityTower())).toBeCloseTo(KNIGHT_ARC_PITCHES);
  });

  it('arcs only a knight’s own move, and only when knights arc', () => {
    const layout = clarityTower();
    const h = knightArcHeight(layout);
    expect(moveArc(layout, PieceType.Knight, undefined, 'arc')).toBe(h);
    expect(moveArc(layout, PieceType.Knight, undefined, 'straight')).toBe(0);
    expect(moveArc(layout, PieceType.Queen, undefined, 'arc')).toBe(0);
    expect(moveArc(layout, null, undefined, 'arc')).toBe(0);
    // A pawn that promoted to a knight walked there
    expect(moveArc(layout, PieceType.Knight, PieceType.Knight, 'arc')).toBe(0);
  });
});
