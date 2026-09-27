import { buildStauntonGeometries } from '../../pieceGeometry';
import type { StauntonGeometries } from '../../pieceGeometry';
import type { BufferGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Atelier's own cut of the Staunton set: the same bases, collars and heads
// (so every piece is identified exactly as in any Staunton set), but with
// slim, drawn-in stems between base and collar, the look of a modern
// designer set rather than a club set. The turned bodies are reshaped by
// height; everything else is shared with the classic set.

const smooth = (t: number) => t * t * (3 - 2 * t);
const ramp = (a: number, b: number, x: number) =>
  smooth(Math.min(Math.max((x - a) / (b - a), 0), 1));

/**
 * Draws a lathe body in between `from` and `to` (heights), to `waist` of its
 * radius at the narrowest, easing in and out so the profile stays turned.
 */
const slim = (g: BufferGeometry, from: number, to: number, waist: number) => {
  const p = g.attributes.position;
  const ease = (to - from) * 0.28;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const inside = ramp(from, from + ease, y) * (1 - ramp(to - ease, to, y));
    const k = 1 - (1 - waist) * inside;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  // Weld the lathe's seam before shading it again, or the seam shows
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const welded = mergeVertices(g, 1e-5);
  g.dispose();
  welded.computeVertexNormals();
  return welded;
};

const build = (): StauntonGeometries => {
  const g = buildStauntonGeometries(28);
  return {
    ...g,
    pawnBody: slim(g.pawnBody, 0.07, 0.3, 0.72),
    rookBody: slim(g.rookBody, 0.08, 0.44, 0.76),
    bishopBody: slim(g.bishopBody, 0.08, 0.41, 0.64),
    unicornBody: slim(g.unicornBody, 0.08, 0.39, 0.64),
    queenBody: slim(g.queenBody, 0.09, 0.48, 0.64),
    kingBody: slim(g.kingBody, 0.09, 0.52, 0.64),
  };
};

export const ATELIER_SET = build();
