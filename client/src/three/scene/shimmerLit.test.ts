import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { shimmerLit, shimmerMaterial } from './markers';
import { tubeData } from './markerGeometry';
import type { Vec3 } from '../types';

// The shimmer's frames redraw only the part of its tube its pulses light
// (shimmerLit, read by damage.ts): every fragment its shader draws must lie
// in that box, or a frame drawn in part leaves a lit stretch stale.

/** The shader's light at a point `along` the line, facing the camera (its brightest). */
const light = (u: ReturnType<typeof shimmerMaterial>['uniforms'], along: number) => {
  const g = (along - u.uTime.value * u.uSpeed.value + u.uLength.value) / u.uSpacing.value + 0.5;
  const f = g - Math.floor(g);
  const x = ((f - 0.5) * u.uSpacing.value) / u.uLength.value;
  return Math.exp(-x * x * 4) * u.uPeak.value * u.uFade.value;
};

describe('shimmerLit', () => {
  const cases: [Vec3, Vec3][] = [
    [
      [0, 0, 0],
      [3, 1.2, -2],
    ],
    [
      [1, 2, 1],
      [1, -1, 1],
    ],
    [
      [0, 0, 0],
      [0.4, 0, 0],
    ],
  ];
  it('holds every point of the tube the shader lights, through a pulse’s whole travel', () => {
    const u = shimmerMaterial().uniforms;
    const radius = 0.0264;
    const out = new Box3();
    let lit = 0;
    let dark = 0;
    for (const [from, to] of cases) {
      const data = tubeData([from, to], { radius, radialSegments: 8, capSegments: 2 });
      const a = new Vector3(...from);
      const dir = new Vector3(...to).sub(a);
      const total = dir.length();
      dir.normalize();
      for (const fade of [0.001, 0.3, 1]) {
        u.uFade.value = fade;
        for (let t = 0; t < 6; t += 0.037) {
          u.uTime.value = t;
          const box = shimmerLit(from, to, radius, u, out);
          // Every vertex the shader lights, and points along the axis between
          for (let s = -radius; s <= total + radius; s += 0.005) {
            if (light(u, s) < 0.002) continue;
            lit++;
            expect(box, `t ${t} along ${s}`).not.toBeNull();
            const p = a.clone().addScaledVector(dir, s);
            expect(box!.distanceToPoint(p)).toBe(0);
          }
          for (let v = 0; v < data.along.length; v++) {
            if (light(u, data.along[v]) < 0.002) continue;
            const p = new Vector3().fromArray(data.position, v * 3);
            expect(box!.distanceToPoint(p)).toBeLessThan(1e-6);
          }
          if (!box) dark++;
        }
      }
    }
    // Both happen: frames lighting part of the line, and frames lighting none of it
    expect(lit).toBeGreaterThan(1000);
    expect(dark).toBeGreaterThan(0);
  });

  it('is about one pulse long on a line a pulse at a time runs along', () => {
    const u = shimmerMaterial().uniforms;
    u.uFade.value = 1;
    u.uTime.value = 2;
    const box = shimmerLit([0, 0, 0], [1.6, 0, 0], 0.0264, u, new Box3())!;
    expect(box.max.x - box.min.x).toBeLessThan(0.85);
  });
});
