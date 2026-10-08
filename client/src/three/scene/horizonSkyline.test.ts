import { describe, expect, it } from 'vitest';
import { PieceType } from '../../engine/pieces';
import {
  BLACK_LOOK,
  columnTop,
  RANGES,
  silhouetteColumn,
  silhouetteOf,
  skylineOf,
  WHITE_LOOK,
} from './horizonSkyline';
import type { Range, Skyline } from './horizonSkyline';

// The far hills' skylines: closed round the horizon, rock only above the
// ground, and the pieces in them where each seat can find them.

const DEG = Math.PI / 180;
const skylines = RANGES.map((r) => ({ range: r, skyline: skylineOf(r) }));

/** The columns within `half` degrees of an azimuth (degrees). */
const near = ({ azimuth, columns }: Skyline, at: number, half: number) =>
  columns.filter((_, i) => {
    const d = Math.atan2(Math.sin(azimuth[i] - at * DEG), Math.cos(azimuth[i] - at * DEG));
    return Math.abs(d) <= half * DEG;
  });

describe('the far hills', () => {
  it('go all the way round and close up behind', () => {
    for (const { skyline } of skylines) {
      const { azimuth, columns } = skyline;
      expect(azimuth[0]).toBe(0);
      expect(azimuth[azimuth.length - 1]).toBeCloseTo(Math.PI * 2);
      for (let i = 1; i < azimuth.length; i++) expect(azimuth[i]).toBeGreaterThan(azimuth[i - 1]);
      expect(columns[columns.length - 1]).toEqual(columns[0]);
    }
  });

  it('are rock from the ground up, in runs that never overlap', () => {
    for (const { skyline } of skylines)
      for (const c of skyline.columns) {
        expect(c.length % 2).toBe(0);
        expect(c[0]).toBe(0);
        for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
      }
  });

  it('stay low: a dim band at the top of the frame, never a wall', () => {
    for (const { range, skyline } of skylines) {
      const top = Math.max(...skyline.columns.map(columnTop));
      // Under 5° above the horizon even from the camera's lowest
      expect(Math.atan2(top, range.radius) / DEG).toBeLessThan(5);
    }
  });

  it('raise each piece to its height, and only near its place', () => {
    for (const { range, skyline } of skylines)
      for (const s of range.summits) {
        const here = Math.max(...near(skyline, s.azimuth, 1.5).map(columnTop));
        expect(Math.abs(here - s.top)).toBeLessThan(0.8);
      }
  });

  it('show sky through a piece where the piece does: the cross, the mitre, the muzzle', () => {
    const [far, nearRange] = skylines;
    const split = (s: Skyline, at: number) => near(s, at, 3).some((c) => c.length > 2);
    const king = far.range.summits.find((s) => s.type === PieceType.King)!;
    const bishop = nearRange.range.summits.find((s) => s.type === PieceType.Bishop)!;
    const knight = nearRange.range.summits.find((s) => s.type === PieceType.Knight)!;
    expect(split(far.skyline, king.azimuth)).toBe(true);
    expect(split(nearRange.skyline, bishop.azimuth)).toBe(true);
    expect(split(nearRange.skyline, knight.azimuth)).toBe(true);
    // A plain range is one run everywhere
    const plain: Range = { ...nearRange.range, summits: [] };
    expect(skylineOf(plain).columns.every((c) => c.length === 2)).toBe(true);
  });

  it('give each seat a piece beside the tower in its opening view', () => {
    // The desktop frame spans about 27° either side of the line, the tower about 9°
    for (const look of [WHITE_LOOK, BLACK_LOOK]) {
      const beside = RANGES.flatMap((r) => r.summits).filter((s) => {
        const d = Math.abs(((s.azimuth - look + 540) % 360) - 180);
        return d > 12 && d < 26;
      });
      expect(beside.length, `look ${look}`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('a piece silhouette', () => {
  it('is solid through its body and clear beside it', () => {
    for (const type of Object.values(PieceType)) {
      const s = silhouetteOf(type);
      const mid = silhouetteColumn(s, 0.001);
      expect(mid[0], type).toBeCloseTo(0, 2);
      expect(columnTop(mid), type).toBeGreaterThan(0.45);
      expect(silhouetteColumn(s, 0.6), type).toEqual([]);
    }
  });

  it('hangs the king’s cross arms clear of his cap', () => {
    const arm = silhouetteColumn(silhouetteOf(PieceType.King), 0.045);
    expect(arm.length).toBe(4);
    expect(arm[2]).toBeGreaterThan(0.79);
  });
});
