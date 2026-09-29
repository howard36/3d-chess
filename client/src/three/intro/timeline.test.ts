import { describe, expect, it } from 'vitest';
import { Board } from '../../engine';
import { PieceType } from '../../engine/pieces';
import { CELLS } from '../layout';
import {
  dollyFactor,
  hudFade,
  introDone,
  introPlan,
  LAST_ARRIVAL,
  labelFade,
  levelBuild,
  pieceArrival,
  pieceForm,
  pieceRing,
  sceneFade,
} from './timeline';
import type { IntroPlan } from './timeline';

const full = introPlan('full');
const short = introPlan('short');
const samples = (plan: IntroPlan, n = 400) =>
  Array.from({ length: n + 1 }, (_, i) => (plan.total * i) / n);

/** The opening's pieces, with where each stands. */
const opening = () => {
  const board = Board.setupStartingPosition();
  return CELLS.flatMap((c) => {
    const p = board.getPiece(c);
    return p ? [{ ...p, ...c }] : [];
  });
};

describe('the plans', () => {
  it('last about 3.5 to 4 s in full, about 1.3 s for a rejoin, a moment with reduced motion', () => {
    expect(full.total).toBeGreaterThanOrEqual(3.5);
    expect(full.total).toBeLessThanOrEqual(4);
    expect(short.total).toBeGreaterThanOrEqual(1.1);
    expect(short.total).toBeLessThanOrEqual(1.5);
    for (const variant of ['full', 'short'] as const) {
      const reduced = introPlan(variant, true);
      expect(reduced.reduced).toBe(true);
      expect(reduced.total).toBeCloseTo(0.15);
    }
  });

  it('with none, or once over, leave everything in its final state', () => {
    for (const [plan, t] of [
      [introPlan('none'), 0],
      [introPlan('none'), Infinity],
      [introPlan('none', true), 0],
      [full, full.total],
      [full, Infinity],
      [short, short.total],
      [introPlan('short', true), 0.15],
    ] as const) {
      expect(introDone(plan, t)).toBe(true);
      expect(sceneFade(plan, t)).toBe(1);
      expect(dollyFactor(plan, t)).toBe(1);
      for (let z = 0; z < 5; z++) expect(levelBuild(plan, z, t)).toBe(1);
      expect(labelFade(plan, t, 0)).toBe(1);
      expect(labelFade(plan, t, 1)).toBe(1);
      for (const piece of opening()) {
        expect(pieceForm(plan, pieceArrival(piece), t)).toBe(1);
        expect(pieceRing(plan, pieceArrival(piece), t)).toBe(1);
      }
      expect(hudFade(plan, t)).toBe(1);
    }
    expect(introDone(full, full.total - 0.01)).toBe(false);
  });

  it('with reduced motion, only fade the scene and the HUD in', () => {
    const plan = introPlan('full', true);
    expect(sceneFade(plan, 0)).toBe(0);
    expect(sceneFade(plan, 0.075)).toBeCloseTo(0.5);
    expect(hudFade(plan, 0.075)).toBeCloseTo(0.5);
    expect(dollyFactor(plan, 0)).toBe(1);
    expect(levelBuild(plan, 4, 0)).toBe(1);
    expect(pieceForm(plan, LAST_ARRIVAL, 0)).toBe(1);
    expect(labelFade(plan, 0, 1)).toBe(1);
  });
});

describe('the dolly', () => {
  it('starts far out and lands exactly on the fitted distance, never passing it', () => {
    expect(dollyFactor(full, 0)).toBeCloseTo(2.4);
    expect(dollyFactor(short, 0)).toBeCloseTo(1.3);
    for (const plan of [full, short]) {
      const factors = samples(plan).map((t) => dollyFactor(plan, t));
      factors.slice(1).forEach((f, i) => {
        expect(f).toBeLessThanOrEqual(factors[i]);
        expect(f).toBeGreaterThanOrEqual(1);
      });
      expect(dollyFactor(plan, plan.dolly.start + plan.dolly.duration)).toBe(1);
    }
  });

  it('eases out: the tower grows fastest at first and settles', () => {
    const [a, b, c] = [0, 0.5, 1].map((t) => Math.log(dollyFactor(full, t)));
    const [d, e] = [1.8, 2.3].map((t) => Math.log(dollyFactor(full, t)));
    expect(a - b).toBeGreaterThan(d - e);
    expect(b - c).toBeGreaterThan(d - e);
  });
});

describe('the tower', () => {
  it('builds level by level from A up, each overlapping the next', () => {
    for (const plan of [full, short]) {
      for (let z = 1; z < 5; z++) {
        // Each level starts after the one below it, and before that one is done
        const starts = (level: number) =>
          samples(plan).find((t) => levelBuild(plan, level, t) > 0)!;
        const ends = (level: number) => samples(plan).find((t) => levelBuild(plan, level, t) >= 1)!;
        expect(starts(z)).toBeGreaterThan(starts(z - 1));
        expect(starts(z)).toBeLessThan(ends(z - 1));
      }
      expect(levelBuild(plan, 0, 0)).toBe(0);
      expect(levelBuild(plan, 4, plan.levels.start + plan.levels.step * 4 - 0.01)).toBe(0);
    }
  });

  it('is up before the pieces form on it, and its labels settle once it is', () => {
    const topDone = full.levels.start + full.levels.step * 4 + full.levels.duration;
    expect(full.pieces.start).toBeGreaterThan(full.levels.start + full.levels.step * 4);
    expect(full.labels.start).toBeGreaterThan(full.levels.start + full.levels.step * 3);
    expect(labelFade(full, topDone - 0.3, 1)).toBe(0);
    // A settles first, E last
    const t = full.labels.start + full.labels.duration * 0.6;
    expect(labelFade(full, t, 0)).toBeGreaterThan(labelFade(full, t, 1));
  });
});

describe('the pieces', () => {
  it('arrive both armies at once, each piece with its mirror image', () => {
    const pieces = opening();
    expect(pieces).toHaveLength(40);
    for (const p of pieces) {
      const mirror = pieces.find(
        (q) => q.x === 4 - p.x && q.y === 4 - p.y && q.z === 4 - p.z && q.color !== p.color,
      )!;
      expect(pieceArrival(mirror)).toBe(pieceArrival(p));
    }
  });

  it('arrive back ranks first from the king outward, then the pawns', () => {
    const pieces = opening();
    const at = (type: PieceType) =>
      pieces.filter((p) => p.type === type).map((p) => pieceArrival(p));
    const kings = at(PieceType.King);
    const pawns = at(PieceType.Pawn);
    const majors = pieces.filter((p) => p.type !== PieceType.Pawn).map((p) => pieceArrival(p));
    expect(Math.max(...kings)).toBe(0);
    expect(Math.min(...pawns)).toBeGreaterThan(Math.max(...majors));
    // Knights (beside the king) before rooks (at the ends of the rank)
    expect(Math.max(...at(PieceType.Knight))).toBeLessThan(Math.min(...at(PieceType.Rook)));
  });

  it('arrive within the plan from any square', () => {
    for (const type of Object.values(PieceType)) {
      for (const color of ['white', 'black'] as const) {
        for (const { x, y } of CELLS) {
          const a = pieceArrival({ type, color, x, y });
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(LAST_ARRIVAL);
        }
      }
    }
  });

  it('each form over about half a second, from nothing, with a ring that outlasts them', () => {
    const arrival = 0.3;
    const start = full.pieces.start + arrival;
    expect(pieceForm(full, arrival, start - 0.01)).toBe(0);
    expect(pieceForm(full, arrival, start + 0.2)).toBeGreaterThan(0);
    expect(pieceForm(full, arrival, start + 0.2)).toBeLessThan(1);
    expect(pieceForm(full, arrival, start + full.pieces.duration)).toBe(1);
    expect(full.pieces.duration).toBeGreaterThanOrEqual(0.45);
    expect(full.pieces.duration).toBeLessThanOrEqual(0.6);
    expect(pieceRing(full, arrival, start + full.pieces.duration)).toBeLessThan(1);
    // Every piece is whole, and its ring gone, by the end
    for (const p of opening()) {
      expect(pieceRing(full, pieceArrival(p), full.total)).toBe(1);
      expect(pieceRing(short, pieceArrival(p), short.total)).toBe(1);
    }
  });

  it('are forming when the HUD fades in, and the HUD is in by the end', () => {
    const lastPawn = Math.max(...opening().map((p) => pieceArrival(p)));
    expect(full.hud.start).toBeLessThan(full.pieces.start + lastPawn + full.pieces.duration);
    expect(full.hud.start).toBeGreaterThan(full.pieces.start);
    expect(hudFade(full, full.hud.start)).toBe(0);
    expect(full.hud.start + full.hud.duration).toBeLessThanOrEqual(full.total);
  });
});
