import { describe, expect, it } from 'vitest';
import { Color, PerspectiveCamera, Vector3 } from 'three';
import { SKY_PLAN } from './heavens';
import { chartGeometry, EGG_PLAN, eggEntries, EIGHT_QUEENS, majorEntries } from './skyChart';
import { RICH_FIELD, richField } from './skyStars';
import { bandFrame, bandLight } from './skyMilkyWay';
import { figureInView, traceables } from './skyEvents';
import { angleBetween, DEG, elevationOf, placeStar } from './skyPlace';
import { LEVEL_COLORS, PALETTE, SKY_DETAIL } from './palette';

// The sky's detail: where its figures stand, that its hidden puzzles are
// right, and that its stars are spent where a camera can see them.

const figureStars = (plans = SKY_PLAN) =>
  plans.flatMap((plan) => plan.c.stars.map((s) => placeStar(s, plan)));

describe('the figures and asterisms', () => {
  it('keep clear of the eight and of each other', () => {
    const groups = [...SKY_PLAN, ...Object.values(EGG_PLAN)].map((plan) =>
      plan.c.stars.map((s) => placeStar(s, plan)),
    );
    // The eight queens and their board are one asterism
    const queens = groups.length - 1;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (i === queens - 1 && j === queens) continue;
        for (const a of groups[i])
          for (const b of groups[j]) expect(angleBetween(a, b)).toBeGreaterThan(3);
      }
    }
  });
});

describe('the hidden asterisms', () => {
  it('set eight queens none of which attacks another', () => {
    const q = EIGHT_QUEENS;
    expect(new Set(q).size).toBe(8);
    for (let a = 0; a < 8; a++)
      for (let b = a + 1; b < 8; b++) expect(Math.abs(q[a] - q[b])).not.toBe(b - a);
  });

  it('stack five stars in the five level colours, A at the foot', () => {
    const echo = eggEntries().find((e) => e.plan === EGG_PLAN.echo)!;
    const els = echo.plan.c.stars.map((s) => elevationOf(placeStar(s, echo.plan)));
    for (let i = 1; i < 5; i++) expect(els[i]).toBeGreaterThan(els[i - 1]);
    const neon = new Color(PALETTE.neon);
    echo.colors!.forEach((c, i) => {
      // Tinted toward its level's colour, not white
      const level = new Color(LEVEL_COLORS[i]);
      const toLevel = Math.hypot(c.r - level.r, c.g - level.g, c.b - level.b);
      const toNeon = Math.hypot(c.r - neon.r, c.g - neon.g, c.b - neon.b);
      expect(toLevel).toBeLessThan(toNeon * 1.6);
    });
  });
});

describe('the charted figures', () => {
  it('run each line whole from star to star and number it along the figure', () => {
    const entries = majorEntries(SKY_PLAN);
    const { stars, lines } = chartGeometry(entries);
    const pos = lines.getAttribute('position');
    const along = lines.getAttribute('aAlong');
    const figure = lines.getAttribute('aFigure');
    const starPos = stars.getAttribute('position');
    const starsAt = Array.from({ length: starPos.count }, (_, i) =>
      new Vector3().fromBufferAttribute(starPos, i),
    );
    let onStar = 0;
    for (let v = 0; v < pos.count; v++) {
      const p = new Vector3().fromBufferAttribute(pos, v);
      // A line's end on a star meets it (no gap short of it)
      const nearest = Math.min(...starsAt.map((s) => angleBetween(s.toArray(), p.toArray())));
      if (nearest < 1e-3) onStar++;
      expect(along.getX(v)).toBeGreaterThanOrEqual(0);
      expect(along.getX(v)).toBeLessThanOrEqual(1);
    }
    // Every end that is a star's (not a mark's, such as the castling arc's)
    const starEnds = entries.flatMap((e) =>
      e.plan.c.lines.flat().filter((i) => i < e.plan.c.stars.length),
    );
    expect(onStar).toBe(starEnds.length);
    // Each figure has its number and one star brighter than the rest
    expect(new Set(Array.from({ length: figure.count }, (_, i) => figure.getX(i))).size).toBe(
      entries.length,
    );
    const bright = Array.from(stars.getAttribute('aBright').array);
    expect(bright.filter((b) => b > 0.6)).toHaveLength(SKY_PLAN.length);
  });

  it('lets a trace light only a figure wholly in frame and clear of the tower', () => {
    const camera = new PerspectiveCamera(36, 1.6, 0.1, 1000);
    camera.position.set(0, 0, 0);
    const [knight] = traceables(majorEntries(SKY_PLAN));
    const at = knight.points[0].clone().normalize();
    camera.lookAt(at.multiplyScalar(10));
    camera.updateMatrixWorld();
    expect(figureInView(camera, 1.6, knight.points)).toBe(true);
    camera.lookAt(new Vector3(-at.x, at.y, -at.z));
    camera.updateMatrixWorld();
    expect(figureInView(camera, 1.6, knight.points)).toBe(false);
  });
});

describe('the field', () => {
  const avoid = figureStars();
  const f = richField(avoid);
  const count = f.bright.length;
  const dirs = Array.from({ length: count }, (_, i) => f.pos.slice(i * 3, i * 3 + 3));

  it('spends every star where a camera can see it', () => {
    expect(count).toBeGreaterThanOrEqual(RICH_FIELD);
    for (const d of dirs) {
      const el = elevationOf(d);
      expect(el).toBeGreaterThan(0.9);
      expect(el).toBeLessThan(36.5);
    }
  });

  it('is mostly faint dust, with a few hundred plain stars and a dozen or so bright ones', () => {
    const dust = f.bright.filter((b) => b < 0.08).length;
    const bright = f.bright.filter((b) => b > 0.4).length;
    expect(dust / count).toBeGreaterThan(0.5);
    expect(bright).toBeGreaterThanOrEqual(6);
    expect(bright).toBeLessThanOrEqual(40);
  });

  it('keeps its bright stars off the constellations', () => {
    dirs.forEach((d, i) => {
      if (f.bright[i] < 0.11) return;
      for (const a of avoid) expect(angleBetween(d, a)).toBeGreaterThan(2.2);
    });
  });

  it('colours its stars in the palette’s pale temperatures only', () => {
    const tints = [
      SKY_DETAIL.starWhite,
      SKY_DETAIL.starBlue,
      SKY_DETAIL.starGold,
      SKY_DETAIL.starOrange,
    ]
      .map((h) => new Color(h))
      .map((c) => [c.r, c.g, c.b].map((v) => v.toFixed(4)).join());
    for (let i = 0; i < count; i++)
      expect(tints).toContain(
        f.color
          .slice(i * 3, i * 3 + 3)
          .map((v) => v.toFixed(4))
          .join(),
      );
  });
});

describe('the Milky Way', () => {
  it('rises out of the horizon, dark below it, brightest along its middle', () => {
    const { at } = bandFrame();
    expect(at(0).y).toBeCloseTo(0, 5);
    expect(at(Math.PI / 2).y).toBeGreaterThan(0.9);
    const el = (phi: number, beta: number) => elevationOf(at(phi, beta).toArray());
    const phi = 25 * DEG;
    expect(bandLight(phi, 0, el(phi, 0))).toBeGreaterThan(
      bandLight(phi, 12 * DEG, el(phi, 12 * DEG)),
    );
    expect(bandLight(-3 * DEG, 0, -2)).toBe(0);
  });
});
