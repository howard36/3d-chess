import { describe, expect, it } from 'vitest';
import { Box3, BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from '../../engine/pieces';
import { cutSlot } from './cut';
import { decimate } from './decimate';
import { triangleCount } from './mesh';
import { PIECE_PARTS, partsGeometry, pieceTop } from './parts';
import { corner, revolve, sampleProfile } from './profile';
import { ellipsoid, surfaceNets } from './sdf';
import { FOOT_HEIGHT, PROFILES, buildPieceSet, pieceSet } from './set';
import type { PieceSet } from './set';

const TYPES = Object.values(PieceType);
const medium = pieceSet('medium');
// Pieces are built on first use: build them all now, while the file loads,
// rather than inside the first test's time limit
for (const type of Object.values(PieceType)) void medium[type];
for (const type of Object.values(PieceType)) void pieceSet('low')[type];

const boxOf = (set: PieceSet, type: PieceType) => {
  const box = new Box3();
  for (const part of PIECE_PARTS) {
    const g = set[type][part];
    if (g) box.union(g.boundingBox!);
  }
  return box;
};

const total = (set: PieceSet, type: PieceType) =>
  PIECE_PARTS.reduce((n, p) => n + (set[type][p] ? triangleCount(set[type][p]!) : 0), 0);

/** Largest distance from the axis among vertices with y in [lo, hi]. */
const radiusBetween = (g: BufferGeometry, lo: number, hi: number) => {
  const p = g.getAttribute('position');
  let r = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) >= lo && p.getY(i) <= hi) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
  }
  return r;
};

/** Every edge of a mesh (welded by position) belongs to exactly two triangles. */
const isClosed = (g: BufferGeometry) => {
  const bare = new BufferGeometry();
  bare.setAttribute('position', g.getAttribute('position'));
  if (g.index) bare.setIndex(g.index);
  const w = mergeVertices(bare, 1e-5);
  const idx = w.index!;
  const edges = new Map<string, number>();
  for (let t = 0; t < idx.count; t += 3) {
    const tri = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    if (new Set(tri).size < 3) continue;
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return [...edges.values()].every((n) => n === 2);
};

describe('the shared piece set', () => {
  it('has every piece, each with a body, a collar and a foot', () => {
    for (const type of TYPES) {
      for (const part of ['body', 'collar', 'foot'] as const) {
        expect(medium[type][part]?.isBufferGeometry, `${type} ${part}`).toBe(true);
      }
    }
  });

  it('carries accents where a piece is identified by them', () => {
    const withAccent = TYPES.filter((t) => medium[t].accent);
    expect(withAccent.sort()).toEqual(
      [
        PieceType.Rook,
        PieceType.Knight,
        PieceType.Bishop,
        PieceType.Unicorn,
        PieceType.Queen,
        PieceType.King,
      ].sort(),
    );
  });

  it('builds indexed geometry with finite positions, unit normals and uvs', () => {
    for (const type of TYPES) {
      for (const part of PIECE_PARTS) {
        const g = medium[type][part];
        if (!g) continue;
        expect(g.index, `${type} ${part}`).not.toBeNull();
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        expect(g.getAttribute('uv').count).toBe(p.count);
        let bad = 0;
        for (let i = 0; i < p.count; i++) {
          const finite = Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i));
          const unit = Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 0.005;
          if (!finite || !unit) bad++;
        }
        expect(bad, `${type} ${part}: vertices with a bad position or normal`).toBe(0);
      }
    }
  });

  it('stays inside the envelope the layouts assume', () => {
    for (const type of TYPES) {
      const box = boxOf(medium, type);
      // Base at y = 0
      expect(box.min.y, type).toBeGreaterThan(-1e-4);
      expect(box.min.y, type).toBeLessThan(1e-3);
      expect(box.max.y, type).toBeLessThanOrEqual(0.875);
      // Turned pieces are round and no wider than 0.27; the knight's muzzle
      // reaches a little past its base, well inside the cell
      const reach = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
      expect(reach, type).toBeLessThanOrEqual(type === PieceType.Knight ? 0.32 : 0.27);
    }
    expect(pieceTop(medium, PieceType.King)).toBeCloseTo(0.87, 2);
  });

  it('stands in a clear hierarchy of heights', () => {
    const h = (t: PieceType) => pieceTop(medium, t);
    expect(h(PieceType.Pawn)).toBeLessThan(h(PieceType.Rook));
    expect(h(PieceType.Rook)).toBeLessThan(h(PieceType.Knight));
    expect(h(PieceType.Knight)).toBeLessThan(h(PieceType.Bishop));
    expect(h(PieceType.Bishop)).toBeLessThan(h(PieceType.Queen));
    expect(h(PieceType.Bishop)).toBeLessThan(h(PieceType.Unicorn));
    expect(h(PieceType.Unicorn)).toBeLessThan(h(PieceType.Queen));
    // Well spread: each step up the hierarchy is one a player can see
    expect(h(PieceType.Bishop) - h(PieceType.Knight)).toBeGreaterThan(0.02);
    expect(h(PieceType.Queen) - h(PieceType.Bishop)).toBeGreaterThan(0.05);
    for (const t of TYPES.filter((t) => t !== PieceType.King)) {
      expect(h(t), t).toBeLessThan(h(PieceType.King) - 0.04);
    }
  });

  it('puts a thin foot band at the very bottom of every piece, as wide as its base', () => {
    for (const type of TYPES) {
      const foot = medium[type].foot.boundingBox!;
      expect(foot.min.y).toBeCloseTo(0, 5);
      expect(foot.max.y).toBeCloseTo(FOOT_HEIGHT, 5);
      expect(foot.max.x).toBeCloseTo(PROFILES.radius[type], 3);
      expect(foot.max.x).toBeCloseTo(boxOf(medium, type).max.x, type === PieceType.Knight ? 0 : 3);
    }
  });

  it('keeps every piece within about 4-5k triangles at the default quality', () => {
    for (const type of TYPES) expect(total(medium, type), type).toBeLessThanOrEqual(5000);
  });

  it('crowns the king with a cross that has arms both ways, over a closed crown', () => {
    const cross = medium.King.accent!.boundingBox!;
    // Arms across x and across z: a cross from every side and a plus from above
    expect(cross.max.x - cross.min.x).toBeGreaterThan(0.1);
    expect(cross.max.z - cross.min.z).toBeGreaterThan(0.1);
    // Taller than it is wide (a cross, not a plus), topping the piece
    expect(cross.max.y - cross.min.y).toBeGreaterThan(cross.max.x - cross.min.x);
    expect(cross.max.y).toBeCloseTo(pieceTop(medium, PieceType.King), 5);
    // Above the arms, only the upper arm; the arms themselves reach out
    expect(radiusBetween(medium.King.accent!, 0.845, 1)).toBeLessThan(0.035);
    expect(radiusBetween(medium.King.accent!, 0.765, 0.825)).toBeGreaterThan(0.045);
    // Thin plates, not blocks: out along the arms across x, the plate is
    // a fraction of the arms' width thick
    const p = medium.King.accent!.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getX(i)) > 0.035) expect(Math.abs(p.getZ(i))).toBeLessThan(0.012);
    }
  });

  it("rings the queen's crown with eight pearls, well clear of its finial", () => {
    const p = medium.Queen.accent!.getAttribute('position');
    const sectors = new Set<number>();
    for (let i = 0; i < p.count; i++) {
      expect(Math.hypot(p.getX(i), p.getZ(i))).toBeGreaterThan(0.12);
      const a = (Math.atan2(p.getZ(i), p.getX(i)) + Math.PI * 2 + Math.PI / 8) % (Math.PI * 2);
      sectors.add(Math.floor(a / (Math.PI / 4)));
    }
    expect(sectors.size).toBe(8);
  });

  it("keeps the queen's cup wall whole: the inner lip stays inside the outer wall", () => {
    const pts = sampleProfile(PROFILES.queen.crown, 0.0005);
    // The rim's top splits the profile into the outer wall and the inner lip
    const top = pts.reduce((best, p, k) => (p[1] > pts[best][1] ? k : best), 0);
    const outer = pts.slice(0, top + 1).filter(([, y]) => y > 0.6);
    // (the lip below the rolled rim, where the two walls meet by design)
    const inner = pts.slice(top + 1).filter(([r, y]) => r > 0.05 && y < 0.682);
    const outerAt = (y: number) => {
      for (let k = 1; k < outer.length; k++) {
        const [r0, y0] = outer[k - 1];
        const [r1, y1] = outer[k];
        if ((y - y0) * (y - y1) <= 0 && y1 !== y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
      }
      return null;
    };
    let checked = 0;
    for (const [r, y] of inner) {
      const wall = outerAt(y);
      if (wall === null) continue;
      expect(r, `inner lip at y ${y.toFixed(3)}`).toBeLessThanOrEqual(wall - 0.006);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('keeps the bishop free of crown features: a tall smooth mitre and a small ball', () => {
    const b = medium.Bishop.body;
    expect(radiusBetween(b, 0.52, 0.58)).toBeGreaterThan(0.085);
    expect(radiusBetween(b, 0.725, 1)).toBeLessThan(0.03);
    // The mitre stands 1.3 to 1.5 times as tall as it is wide
    const mitre = sampleProfile(PROFILES.bishop.mitre, 0.001);
    const height = Math.max(...mitre.map((p) => p[1])) - Math.min(...mitre.map((p) => p[1]));
    const width = 2 * Math.max(...mitre.map((p) => p[0]));
    expect(height / width).toBeGreaterThan(1.3);
    expect(height / width).toBeLessThan(1.5);
  });

  it("puts the knight's mane in its accent, standing proud of the crest", () => {
    const mane = medium.Knight.accent!.boundingBox!;
    const body = medium.Knight.body;
    // The mane runs down the back of the neck, behind the body's back edge
    const p = body.getAttribute('position');
    let back = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.35 && p.getY(i) < 0.55) back = Math.max(back, -p.getX(i));
    }
    expect(mane.max.y - mane.min.y).toBeGreaterThan(0.35);
    expect(-mane.min.x).toBeGreaterThan(back + 0.004);
  });

  it('gives the knight a large head on its base', () => {
    const box = medium.Knight.body.boundingBox!;
    // From the back of the neck to the muzzle, near the width of the base
    expect(box.max.x - box.min.x).toBeGreaterThan(0.44);
    expect(box.max.y).toBeGreaterThan(0.68);
    // A full chest: from the front it covers over half the base
    expect(2 * box.max.z).toBeGreaterThan(PROFILES.radius.Knight);
  });

  it('scales its detail with the quality', () => {
    const low = pieceSet('low');
    for (const type of TYPES) expect(total(low, type)).toBeLessThan(total(medium, type));
    const faceted = buildPieceSet({ quality: 'low', segments: 8 });
    expect(total(faceted, PieceType.Pawn)).toBeLessThan(total(low, PieceType.Pawn));
  });

  it('shares one set per quality', () => {
    expect(pieceSet('medium')).toBe(medium);
    expect(pieceSet()).toBe(medium);
  });

  it('draws the unicorn as a pointed horn with a spiral, unlike the bishop', () => {
    const u = medium[PieceType.Unicorn];
    const b = medium[PieceType.Bishop];
    // Where the bishop's mitre is widest, the unicorn has only its slim horn
    expect(radiusBetween(b.body, 0.52, 0.58)).toBeGreaterThan(0.085);
    expect(radiusBetween(u.body, 0.52, 0.58)).toBeLessThan(0.06);
    // The horn comes to a blunted point
    expect(radiusBetween(u.body, 0.775, 1)).toBeLessThan(0.01);
    // The twist is carved into the horn: at one height its radius varies
    // round it (the grooves), by more than a tenth
    const p0 = u.body.getAttribute('position');
    const ring: number[] = [];
    for (let i = 0; i < p0.count; i++) {
      if (Math.abs(p0.getY(i) - 0.62) < 0.004) ring.push(Math.hypot(p0.getX(i), p0.getZ(i)));
    }
    const horn = ring.filter((r) => r < 0.06);
    expect(Math.min(...horn) / Math.max(...horn)).toBeLessThan(0.9);
    // The spiral bead climbs most of the horn, winding all the way round it,
    // and stands proud of it
    const s = u.accent!;
    const box = s.boundingBox!;
    expect(box.max.y - box.min.y).toBeGreaterThan(0.25);
    expect(radiusBetween(s, 0.55, 0.6)).toBeGreaterThan(radiusBetween(u.body, 0.55, 0.6) + 0.005);
    const p = s.getAttribute('position');
    const quadrants = new Set<number>();
    for (let i = 0; i < p.count; i++) {
      quadrants.add(Math.floor(((Math.atan2(p.getZ(i), p.getX(i)) + Math.PI) / Math.PI) * 2) % 4);
    }
    expect(quadrants.size).toBe(4);
  });

  it('faces the knight along +x', () => {
    // Above its base, the head reaches forward much further than the neck back
    const p = medium[PieceType.Knight].body.getAttribute('position');
    let front = 0;
    let back = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < 0.3) continue;
      front = Math.max(front, p.getX(i));
      back = Math.max(back, -p.getX(i));
    }
    expect(front).toBeGreaterThan(back + 0.05);
    const box = medium[PieceType.Knight].body.boundingBox!;
    expect(box.max.z).toBeCloseTo(-box.min.z, 2);
  });

  it('takes a reshaped profile (a slimmer stem) without touching the heads', () => {
    const slim = buildPieceSet({
      quality: 'low',
      radius: (r, y) => (y > 0.2 && y < 0.4 ? r * 0.8 : r),
    });
    const low = pieceSet('low');
    expect(radiusBetween(slim.King.body, 0.25, 0.35)).toBeLessThan(
      radiusBetween(low.King.body, 0.25, 0.35) * 0.85,
    );
    expect(pieceTop(slim, PieceType.King)).toBeCloseTo(pieceTop(low, PieceType.King), 5);
  });

  it('merges parts that share a material once, and hands back a single part as is', () => {
    const merged = partsGeometry(medium, PieceType.Bishop, ['body', 'collar', 'foot']);
    expect(partsGeometry(medium, PieceType.Bishop, ['body', 'collar', 'foot'])).toBe(merged);
    expect(triangleCount(merged!)).toBe(
      triangleCount(medium.Bishop.body) +
        triangleCount(medium.Bishop.collar) +
        triangleCount(medium.Bishop.foot),
    );
    expect(partsGeometry(medium, PieceType.Bishop, ['accent'])).toBe(medium.Bishop.accent);
    expect(partsGeometry(medium, PieceType.Pawn, ['accent'])).toBeNull();
  });
});

describe('piece geometry builders', () => {
  it('samples a profile, keeping its ends and doubling its corners', () => {
    const pts = sampleProfile(
      [corner([0, 0]), [0.2, 0], corner([0.2, 0.1]), [0.1, 0.2], [0.05, 0.3], [0, 0.35]],
      0.001,
    );
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([0, 0.35]);
    const doubled = pts.filter((p, k) => k > 0 && p[0] === pts[k - 1][0] && p[1] === pts[k - 1][1]);
    expect(doubled).toEqual([[0.2, 0.1]]);
    // A looser tolerance keeps fewer points
    expect(
      sampleProfile(
        [
          [0, 0],
          [0.1, 0.05],
          [0.15, 0.2],
          [0, 0.3],
        ],
        0.01,
      ).length,
    ).toBeLessThan(
      sampleProfile(
        [
          [0, 0],
          [0.1, 0.05],
          [0.15, 0.2],
          [0, 0.3],
        ],
        0.0005,
      ).length,
    );
  });

  it('turns a closed profile into a closed shell with outward normals', () => {
    const g = revolve(
      [
        [0, 0],
        [0.1, 0],
        [0.1, 0.2],
        [0, 0.2],
      ],
      { segments: 12 },
    );
    expect(isClosed(g)).toBe(true);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const out = new Vector3(p.getX(i), p.getY(i) - 0.1, p.getZ(i));
      expect(out.dot(new Vector3(n.getX(i), n.getY(i), n.getZ(i)))).toBeGreaterThan(0);
    }
  });

  it('meshes a field with surface nets onto its surface', () => {
    const f = ellipsoid([0, 0, 0], [0.1, 0.1, 0.1]);
    const g = surfaceNets(f, { min: [-0.12, -0.12, -0.12], max: [0.12, 0.12, 0.12], step: 0.01 });
    expect(isClosed(g)).toBe(true);
    const p = g.getAttribute('position');
    let off = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) - 0.1) > 0.0005) off++;
    }
    expect(off).toBe(0);
  });

  it('decimates a closed mesh to its budget, closed and on the surface', () => {
    const f = ellipsoid([0, 0, 0], [0.12, 0.08, 0.06]);
    const nets = surfaceNets(f, {
      min: [-0.13, -0.09, -0.07],
      max: [0.13, 0.09, 0.07],
      step: 0.006,
    });
    const g = decimate(nets, 600, f);
    expect(triangleCount(g)).toBeLessThanOrEqual(600);
    expect(triangleCount(g)).toBeGreaterThan(500);
    expect(isClosed(g)).toBe(true);
    const p = g.getAttribute('position');
    let off = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(f(p.getX(i), p.getY(i), p.getZ(i))) >= 0.002) off++;
    }
    expect(off).toBe(0);
  });

  it('cuts a slot into a convex shell, leaving it closed by the cut faces', () => {
    const egg = revolve(
      sampleProfile(
        [corner([0, 0]), [0.08, 0.03], [0.1, 0.1], [0.06, 0.18], corner([0, 0.2])],
        0.001,
      ),
      { segments: 24 },
    );
    const { body, cut } = cutSlot(egg, {
      at: [0, 0.12, 0],
      normal: [-Math.SQRT1_2, Math.SQRT1_2, 0],
      mouth: [Math.SQRT1_2, Math.SQRT1_2, 0],
      width: 0.02,
      depth: 0.04,
    });
    expect(cut).toHaveLength(3);
    expect(triangleCount(body)).toBeLessThan(triangleCount(egg) * 1.5);
    // The clipped surface and the cut's faces meet edge for edge
    const soup = [body, ...cut].map((g) => (g.index ? g.toNonIndexed() : g));
    const positions = new Float32Array(
      soup.flatMap((g) => [...(g.getAttribute('position').array as Float32Array)]),
    );
    const whole = new BufferGeometry();
    whole.setAttribute('position', new BufferAttribute(positions, 3));
    expect(isClosed(whole)).toBe(true);
  });
});
