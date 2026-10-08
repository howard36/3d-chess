import { describe, expect, it } from 'vitest';
import type { BufferAttribute } from 'three';
import { PieceType } from '../../engine/pieces';
import { GARDEN, FALLEN_SLOT, SCALE } from './stage';
import { GROUND_Y } from './palette';
import { cleanSculptureOf, outlineWidthAt, silhouetteOf } from './sculptures';
import { knightEyes, knightHead, knightOutline } from './knightSilhouette';
import {
  neonStrokes,
  segmentCount,
  strokeSegments,
  strokeQuad,
  STROKE_REACH,
  STROKE_VERTEX,
  updateStrokes,
} from './neonStrokes';
import type { NeonStroke } from './neonStrokes';
import {
  facingOf,
  KNIGHT_SEGMENTS,
  KnightLines,
  sculptureStrokes,
  viewAcross,
} from './sculptureStrokes';
import { FALLEN, fallenKnightLines, fallenPoseClean, fallenStrokes } from './boardFallen';
import { detailStrokes } from './boardDetail';
import { ringPoints } from './boardNeon';
import type { V3 } from './boardNeon';

// The sculptures drawn clean (sculptureLines: clean): every stroke one even
// tube with round joins, drawn segment by segment; nothing not the same
// from every side turns with the view; nothing broken.

type P2 = [number, number];
const DEG = Math.PI / 180;
const TYPES = Object.values(PieceType);

/** The largest distance from a point of one line to the other line, either way (Hausdorff). */
const apart = (a: readonly P2[], b: readonly P2[]) => {
  const toLine = (p: P2, line: readonly P2[]) => {
    let d = Infinity;
    for (let k = 1; k < line.length; k++) {
      const [ax, ay] = line[k - 1];
      const ex = line[k][0] - ax;
      const ey = line[k][1] - ay;
      const t = Math.min(
        Math.max(((p[0] - ax) * ex + (p[1] - ay) * ey) / (ex * ex + ey * ey || 1), 0),
        1,
      );
      d = Math.min(d, Math.hypot(p[0] - ax - ex * t, p[1] - ay - ey * t));
    }
    return d;
  };
  let d = 0;
  for (const p of a) d = Math.max(d, toLine(p, b));
  for (const p of b) d = Math.max(d, toLine(p, a));
  return d;
};

/** Whether two segments cross (not merely touch at a shared end). */
const cross = (a: P2, b: P2, c: P2, d: P2) => {
  const o = (p: P2, q: P2, r: P2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

const selfCrossings = (line: readonly P2[]) => {
  let n = 0;
  for (let i = 1; i < line.length; i++) {
    for (let j = i + 2; j < line.length; j++) {
      if (cross(line[i - 1], line[i], line[j - 1], line[j])) n++;
    }
  }
  return n;
};

/** The sharpest turn along a line (degrees: 0 straight on, 180 straight back). */
const sharpest = (line: readonly P2[]) => {
  let worst = 0;
  for (let k = 1; k + 1 < line.length; k++) {
    const u = [line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]];
    const v = [line[k + 1][0] - line[k][0], line[k + 1][1] - line[k][1]];
    const lu = Math.hypot(u[0], u[1]);
    const lv = Math.hypot(v[0], v[1]);
    if (lu < 1e-9 || lv < 1e-9) continue;
    const cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv);
    worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, cos))) / DEG);
  }
  return worst;
};

describe('clean strokes', () => {
  it('draw a stroke as its segments, a closed one round to its start', () => {
    const strokes: NeonStroke[] = [
      { at: [0, 0, 0], points: ringPoints(1, 0, 8), closed: true, mode: 1, sculpt: 2, light: 0.5 },
      {
        at: [1, 0, 0],
        points: [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
        ],
        closed: false,
        light: [1, 0.5, 0.25],
      },
      { at: [0, 0, 0], points: [[0, 0, 0]], closed: false },
    ];
    expect(segmentCount(strokes)).toBe(8 + 2);
    const g = neonStrokes(strokes, 20);
    expect(strokeSegments(g)).toBe(10);
    const a = g.getAttribute('aA') as BufferAttribute;
    const b = g.getAttribute('aB') as BufferAttribute;
    const info = g.getAttribute('aInfo') as BufferAttribute;
    // Every corner of a segment carries it: segment k is corners 4k to 4k + 3
    const at = (k: number) => k * 4 + 3;
    // The ring's last segment closes it
    expect([b.getX(at(7)), b.getY(at(7)), b.getZ(at(7))]).toEqual([
      a.getX(0),
      a.getY(0),
      a.getZ(0),
    ]);
    expect([info.getX(at(0)), info.getY(at(0)), info.getZ(at(0)), info.getW(at(0))]).toEqual([
      1, 2, 0.5, 0.5,
    ]);
    expect([info.getZ(at(9)), info.getW(at(9))]).toEqual([0.5, 0.25]);
    // Every attribute the shader reads is there
    for (const name of ['aA', 'aB', 'aNA', 'aNB', 'aAnchor', 'aAxis', 'aInfo']) {
      expect(STROKE_VERTEX(4)).toContain(`attribute vec${name === 'aInfo' ? 4 : 3} ${name};`);
      expect(g.getAttribute(name)).toBeDefined();
    }
    // Rewritten in place, within its room
    expect(updateStrokes(g, strokes.slice(1))).toBe(2);
    expect(() => updateStrokes(g, [...strokes, ...strokes, ...strokes])).toThrow();
  });

  it('span each segment on its own: never past a tube width and a half, and no gap at a joint', () => {
    // However sharply a stroke bends on screen (here straight back on
    // itself, then a right angle, then a gentle curve of short steps), each
    // segment's quad stays round its own two ends, and together they cover
    // everything within the tube's reach of the line
    const pts: P2[] = [
      [0, 0],
      [100, 0],
      [0, 3],
      [100, 6],
      [100, 60],
      ...Array.from(
        { length: 12 },
        (_, k): P2 => [100 - 40 * Math.sin(k / 6), 60 + 40 * (1 - Math.cos(k / 6))],
      ),
    ];
    const radius: [number, number] = [8, 9];
    const reach = 9 * STROKE_REACH + 2;
    const quads: P2[][] = [];
    const distance = (c: P2, a: P2, b: P2) => {
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const t = Math.min(
        Math.max(((c[0] - a[0]) * ex + (c[1] - a[1]) * ey) / (ex * ex + ey * ey || 1), 0),
        1,
      );
      return Math.hypot(c[0] - a[0] - ex * t, c[1] - a[1] - ey * t);
    };
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      const before = pts[Math.max(k - 2, 0)];
      const after = pts[Math.min(k + 1, pts.length - 1)];
      const q = strokeQuad(before, a, b, after, radius);
      for (const c of q) expect(distance(c, a, b)).toBeLessThanOrEqual(1.5 * 9);
      // Corners in order round the quad: (a,-), (a,+), (b,+), (b,-)
      quads.push([q[0], q[1], q[3], q[2]]);
    }
    const inside = (p: P2, poly: P2[]) => {
      let sign = 0;
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        const c = Math.sign((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax));
        if (c && sign && c !== sign) return false;
        if (c) sign = c;
      }
      return true;
    };
    for (let x = -15; x <= 120; x += 0.5) {
      for (let y = -15; y <= 110; y += 0.5) {
        const p: P2 = [x, y];
        let d = Infinity;
        for (let k = 1; k < pts.length; k++) d = Math.min(d, distance(p, pts[k - 1], pts[k]));
        if (d > reach - 0.5) continue;
        expect(
          quads.some((q) => inside(p, q)),
          `${x}, ${y}`,
        ).toBe(true);
      }
    }
  });
});

describe('the sculptures drawn clean', () => {
  it('draw each outline as one line, with no fold or spike in it', () => {
    for (const type of TYPES) {
      for (const o of cleanSculptureOf(type).outlines) {
        if (o.closed) continue;
        // No two points far apart: one continuous tube
        for (let k = 1; k < o.points.length; k++) {
          const [a, b] = [o.points[k - 1], o.points[k]];
          expect(Math.hypot(b[0] - a[0], b[1] - a[1]), type).toBeLessThan(0.12);
        }
        // Bent, never doubled back on itself (the queen's coronet has the sharpest points)
        expect(sharpest(o.points), type).toBeLessThan(135);
        expect(selfCrossings(o.points), type).toBe(0);
      }
    }
  });

  it('fit the rings to the outline, so they meet it at its edge', () => {
    for (const type of TYPES) {
      const d = cleanSculptureOf(type);
      const main = type === PieceType.Knight ? knightOutline(1, 0) : silhouetteOf(type);
      for (const ring of d.rings) {
        expect(ring.radius, type).toBeCloseTo(outlineWidthAt(main, ring.y), 3);
      }
    }
  });

  it('keep the bishop’s cut and the unicorn’s spiral on the body, ending on its outline', () => {
    for (const type of [PieceType.Bishop, PieceType.Unicorn]) {
      const d = cleanSculptureOf(type);
      const main = silhouetteOf(type);
      expect(d.fixed).toHaveLength(1);
      const [stroke] = d.fixed;
      for (let az = 0; az < 360; az += 7) {
        const right = [Math.cos(az * DEG), Math.sin(az * DEG)];
        const toward = [-right[1], right[0]];
        stroke.points.forEach(([x, y, z], k) => {
          const across = x * right[0] + z * right[1];
          const w = outlineWidthAt(main, y);
          // Never outside the outline it is drawn within
          expect(Math.abs(across), `${type} az ${az}`).toBeLessThanOrEqual(w + 1e-6);
          // Where its surface turns from the camera to away, it is at the outline's edge
          const [nx, , nz] = stroke.normals[k];
          const facing = nx * toward[0] + nz * toward[1];
          if (Math.abs(facing) < 0.02) expect(Math.abs(across), type).toBeGreaterThan(w * 0.99);
        });
      }
    }
  });

  it('draw the knights by their silhouette, which never turns over as the view goes round', () => {
    let last = knightOutline(1, 0);
    for (let deg = 1; deg <= 360; deg++) {
      const line = knightOutline(Math.cos(deg * DEG), Math.sin(deg * DEG));
      // One degree round moves no part of it more than a step
      expect(apart(last, line), `${deg}°`).toBeLessThan(0.012);
      expect(selfCrossings(line), `${deg}°`).toBe(0);
      expect(sharpest(line), `${deg}°`).toBeLessThan(135);
      expect(line.length).toBeLessThan(KNIGHT_SEGMENTS);
      // Up its base's left from the foot and down its right to the foot
      expect(line[0][1]).toBeCloseTo(0, 6);
      expect(line[line.length - 1][1]).toBeCloseTo(0, 6);
      last = line;
    }
    // Its muzzle is the way it faces: right with its facing to the screen's
    // right, left with it to the left
    const muzzle = (c: number) => {
      const head = knightHead(c, Math.sqrt(1 - c * c)).filter(([, y]) => y > 0.38 && y < 0.42);
      return Math.max(...head.map(([x]) => x)) + Math.min(...head.map(([x]) => x));
    };
    expect(muzzle(1)).toBeGreaterThan(0.1);
    expect(muzzle(-1)).toBeLessThan(-0.1);
    // From the front, its two ears
    const front = knightHead(0, 1);
    const top = Math.max(...front.map(([, y]) => y));
    const tips = front.filter(([, y]) => y > top - 0.004);
    expect(Math.max(...tips.map(([x]) => x)) - Math.min(...tips.map(([x]) => x))).toBeGreaterThan(
      0.05,
    );
  });

  it('stand the twin knights facing each other in the world', () => {
    const knights = GARDEN.filter((g) => g.type === PieceType.Knight);
    const [f0, f1] = knights.map(facingOf);
    expect(f0[0] * f1[0] + f0[1] * f1[1]).toBeCloseTo(-1);
    // Seen from where the camera turns its drawing, the knight's facing and
    // across the screen's right change smoothly as the camera goes round
    const at = knights[0].at;
    let prev = viewAcross([at[0] + 30, 2, at[2]], at, f0);
    for (let deg = 1; deg <= 360; deg++) {
      const cam: V3 = [at[0] + 30 * Math.cos(deg * DEG), 2, at[2] + 30 * Math.sin(deg * DEG)];
      const now = viewAcross(cam, at, f0);
      expect(Math.hypot(now[0] - prev[0], now[1] - prev[1])).toBeLessThan(2 * DEG);
      prev = now;
    }
  });

  it('redraw a knight only as the camera moves round it', () => {
    const lines = new KnightLines(GARDEN, SCALE);
    expect(lines.count).toBe(2);
    expect(lines.update([0, 5, 16], 1)).toBe(true);
    expect(lines.strokes).toHaveLength(2);
    expect(lines.update([0, 5, 16], 1)).toBe(false);
    expect(lines.update([0.5, 5, 16], 1)).toBe(true);
    // Each knight's outline in its own sculpture's slot, facing the camera
    expect(lines.strokes.map((s) => s.sculpt)).toEqual(
      GARDEN.flatMap((g, i) => (g.type === PieceType.Knight ? [i] : [])),
    );
    expect(lines.strokes.every((s) => (s.mode ?? 0) === 0)).toBe(true);
  });

  it('give every sculpture its strokes, and leave the knights’ outlines to their silhouette', () => {
    const strokes = sculptureStrokes(GARDEN, SCALE);
    GARDEN.forEach(({ type }, i) => {
      const own = strokes.filter((s) => s.sculpt === i);
      const facing = own.filter((s) => (s.mode ?? 0) === 0);
      expect(facing.length, type).toBe(
        type === PieceType.Knight
          ? 0
          : type === PieceType.King
            ? 3
            : type === PieceType.Queen
              ? 2
              : 1,
      );
      // Two rings each
      expect(own.filter((s) => s.mode === 1 && !s.normals).length, type).toBe(2);
    });
  });
});

describe('the sculptures’ detail drawn clean', () => {
  it('leaves out the inner tube, and draws each footprint one closed square', () => {
    const strokes = detailStrokes('full');
    // Only rings, footprints, eyes and the hand-high pawn: nothing open but a wink and the pawn
    const open = strokes.filter((s) => !s.closed);
    expect(open.length).toBeLessThanOrEqual(2);
    const squares = strokes.filter((s) => s.points.length === 4 && s.closed);
    expect(squares).toHaveLength(GARDEN.length);
    expect(detailStrokes('inner').every((s) => s.closed && s.mode === 1)).toBe(true);
    expect(detailStrokes('off')).toEqual([]);
  });

  it('fixes the knights’ eyes on the sides of their heads, each seen from its own side', () => {
    for (const winks of [false, true]) {
      const eyes = knightEyes(winks);
      expect(eyes).toHaveLength(2);
      const sides = eyes.map((e) => Math.sign(e.points[0][2]));
      expect(sides).toEqual([1, -1]);
      eyes.forEach((e, i) => {
        for (const n of e.normals) expect(n).toEqual([0, 0, sides[i]]);
      });
      expect(eyes[0].closed).toBe(!winks);
      expect(eyes[1].closed).toBe(true);
    }
  });
});

describe('the fallen giants drawn clean', () => {
  it('keep every tube whole and lit', () => {
    const strokes = fallenStrokes(SCALE, GROUND_Y, FALLEN_SLOT);
    for (let i = 0; i < FALLEN.length; i++) {
      const own = strokes.filter((s) => s.sculpt === FALLEN_SLOT + i);
      expect(own.length).toBeGreaterThan(0);
      const lights = own.flatMap((s) =>
        typeof s.light === 'number' ? [s.light] : (s.light ?? [1]),
      );
      expect(Math.min(...lights)).toBeGreaterThan(0.2);
    }
  });

  it('lay the knight on its side, its cheek on the ground, outlined from the camera', () => {
    const k = FALLEN.findIndex((f) => f.type === PieceType.Knight);
    const pose = fallenPoseClean(FALLEN[k], SCALE, GROUND_Y);
    // Its frame is square, across it pointing up from the ground
    const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(pose.axis, pose.along)).toBeCloseTo(0);
    expect(dot(pose.axis, pose.across)).toBeCloseTo(0);
    expect(pose.across[1]).toBeGreaterThan(0.9);
    expect(pose.at[1]).toBeGreaterThan(GROUND_Y);
    const lines = fallenKnightLines(SCALE, GROUND_Y, FALLEN_SLOT);
    expect(lines.update([60, 30, -60], 1)).toBe(true);
    expect(lines.strokes[0].mode).toBe(2);
    expect(lines.strokes[0].sculpt).toBe(FALLEN_SLOT + k);
  });
});
