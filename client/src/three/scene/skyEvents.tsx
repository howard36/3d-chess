import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Points, Quaternion, Vector3 } from 'three';
import type { Camera } from 'three';
import { noRaycast } from '../noRaycast';
import { rng } from './textures';
import { shadeAt, shadeUniforms } from './mask';
import { launchMeteor, makeMeteor, meteorAt } from './shootingStar';
import { starBuffers } from './skyChart';
import type { ChartEntry } from './skyChart';
import { DEG, DOME, placeStar, skyDirection } from './skyPlace';
import { skyPointMaterial, skyTrace } from './skyShaders';
import { gardenBoost } from './stage';

// Rare things in the sky (envPreview `skyEvents`), in the shooting star's
// manner (shootingStar.tsx): nothing wakes the canvas, an event starts only
// on a frame already being drawn while the camera has been looking up for a
// few seconds (a player exploring the sky is turning the view), keeps the
// frames coming only while it lasts, runs on r3f's clock, and is drawn at no
// light from the first frame so no program links when it comes. One at a
// time, minutes apart:
// - a constellation traces itself: a soft point of light runs along the
//   lines of a figure wholly in frame and clear of the tower's shade, each
//   line brightening behind it, and the figure eases back (the knight's tour
//   too, hop by hop, when its lattice is in view);
// - a satellite: a steady point crossing a quarter of the frame, slowly;
// - a pair of meteors falling side by side; for a minute after a mate
//   (gardenBoost) they come every few seconds of looking up.

/** Seconds of looking up before anything may start. */
const SETTLE = 2.5;
/** How long a trace's light takes to run along a figure, and to ease back (seconds). */
const TRACE_RUN = 2.6;
const TRACE_TOUR_RUN = 7;
const TRACE_FADE = 1.6;
const SATELLITE_SECONDS = 9;

interface Traceable {
  id: number;
  points: Vector3[];
}

/** The figures a trace may light, with their stars' places. */
export const traceables = (entries: ChartEntry[]): Traceable[] =>
  entries
    .filter((e) => e.plan.c.lines.length > 0)
    .map((e) => ({
      id: e.id,
      points: e.plan.c.stars.map((s) => new Vector3(...placeStar(s, e.plan))),
    }));

const ndc = new Vector3();

/** Every star of a figure on screen, inside the frame's margin and clear of the tower's shade. */
export const figureInView = (camera: Camera, aspect: number, points: Vector3[]) => {
  const { uHull, uHullCount } = shadeUniforms();
  const hull = uHull.value.slice(0, uHullCount.value).map((v): [number, number] => [v.x, v.y]);
  return points.every((p) => {
    ndc.copy(p).applyMatrix4(camera.matrixWorldInverse);
    if (ndc.z > -1) return false;
    ndc.applyMatrix4(camera.projectionMatrix);
    if (Math.abs(ndc.x) > 0.9 || ndc.y > 0.82 || ndc.y < -0.9) return false;
    return shadeAt(hull.length >= 3 ? hull : null, [ndc.x * aspect, ndc.y]) < 0.3;
  });
};

type Kind = 'trace' | 'satellite' | 'meteors';

export const SkyEvents = ({
  often = false,
  traceable,
}: {
  often?: boolean;
  /** The charted figures (and the knight's tour) a trace may light. */
  traceable: Traceable[];
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const parts = useMemo(() => {
    const satellite = new Points(
      starBuffers([0, 0, DOME * 0.97], [1.5], [0.36], [1, 1, 1]),
      skyPointMaterial({ opacity: 0, sharp: 0 }),
    );
    satellite.renderOrder = -896;
    satellite.frustumCulled = false;
    satellite.raycast = noRaycast;
    return { satellite, meteors: [makeMeteor(), makeMeteor()] };
  }, []);
  useEffect(
    () => () => {
      parts.satellite.geometry.dispose();
      parts.satellite.material.dispose();
      for (const m of parts.meteors) {
        m.geometry.dispose();
        m.material.dispose();
      }
      skyTrace.uTraceFigure.value = -1;
      skyTrace.uTraceLight.value = 0;
    },
    [parts],
  );
  const dpr = useThree((s) => s.viewport.dpr);
  parts.satellite.material.uniforms.uDpr.value = dpr;

  const state = useRef({
    random: rng(1213),
    upSince: -1,
    due: { trace: -1, satellite: -1, meteors: -1 } as Record<Kind, number>,
    /** The event running: its kind, when it began and what it needs. */
    run: null as null | {
      kind: Kind;
      start: number;
      figure?: number;
      seconds: number;
      from?: Vector3;
      to?: Vector3;
    },
    rest: 0,
    lastFigure: -1,
    showerUntil: -1,
  });
  // ENV PREVIEW (temporary): `often` waits seconds, not minutes
  const wait = often ? 0.035 : 1;
  useEffect(() => {
    state.current.due = { trace: -1, satellite: -1, meteors: -1 };
  }, [wait]);
  const q = useMemo(() => new Quaternion(), []);
  const along = useMemo(() => new Vector3(), []);
  const out = useMemo(() => new Vector3(0, 0, 1), []);

  useFrame(({ clock, camera, size }) => {
    const s = state.current;
    const t = clock.elapsedTime;
    const r = s.random;
    if (s.due.trace < 0) {
      s.due = {
        trace: t + (40 + r() * 40) * wait,
        satellite: t + (100 + r() * 80) * wait,
        meteors: t + (150 + r() * 90) * wait,
      };
    }
    // A mate: a minute of meteors
    if (gardenBoost.value > 0.05 && s.showerUntil < t) {
      s.showerUntil = t + 60;
      s.due.meteors = Math.min(s.due.meteors, t + 3);
    }
    const dir = camera.getWorldDirection(along);
    const up = dir.y > Math.sin(8 * DEG);
    if (!up) s.upSince = -1;
    else if (s.upSince < 0) s.upSince = t;
    const aspect = size.width / Math.max(size.height, 1);

    if (!s.run && up && t - s.upSince > SETTLE && t >= s.rest) {
      const look = Math.atan2(dir.x, dir.z);
      const kinds = (['trace', 'satellite', 'meteors'] as Kind[])
        .filter((k) => t >= s.due[k])
        .sort((a, b) => s.due[a] - s.due[b]);
      for (const kind of kinds) {
        if (kind === 'trace') {
          const seen = traceable.filter(
            (f) => f.id !== s.lastFigure && figureInView(camera, aspect, f.points),
          );
          if (!seen.length) continue;
          const f = seen[Math.floor(r() * seen.length)];
          s.lastFigure = f.id;
          s.run = {
            kind,
            start: t,
            figure: f.id,
            seconds: (f.points.length > 20 ? TRACE_TOUR_RUN : TRACE_RUN) + TRACE_FADE,
          };
          skyTrace.uTraceFigure.value = f.id;
          s.due.trace = t + (150 + r() * 90) * wait;
        } else if (kind === 'satellite') {
          // Across a quarter of the frame, well up, beside the tower
          const side = r() < 0.5 ? -1 : 1;
          const az = look + side * (12 + r() * 12) * DEG;
          const el = (15 + r() * 10) * DEG;
          const turn = (r() - 0.5) * 0.8;
          s.run = {
            kind,
            start: t,
            seconds: SATELLITE_SECONDS,
            from: skyDirection(
              az - side * Math.cos(turn) * 12 * DEG,
              el - Math.sin(turn) * 12 * DEG,
            ),
            to: skyDirection(az + side * Math.cos(turn) * 12 * DEG, el + Math.sin(turn) * 12 * DEG),
          };
          s.due.satellite = t + (200 + r() * 120) * wait;
        } else {
          // Two side by side from one radiant, the second a moment later
          const side = r() < 0.5 ? -1 : 1;
          const az = look + side * (18 + r() * 8) * DEG;
          const el = (22 + r() * 4) * DEG;
          const daz = side * (9 + r() * 3) * DEG;
          const del = -(9 + r() * 3) * DEG;
          const [a, b] = parts.meteors;
          launchMeteor(a.material, skyDirection(az, el), skyDirection(az + daz, el + del));
          launchMeteor(
            b.material,
            skyDirection(az - side * 1.6 * DEG, el - 1.2 * DEG),
            skyDirection(az + daz - side * 1.6 * DEG, el + del - 1.2 * DEG),
          );
          s.run = { kind, start: t, seconds: 2.9 };
          const shower = t < s.showerUntil;
          s.due.meteors = t + (shower ? 7 + r() * 6 : (240 + r() * 160) * wait);
        }
        break;
      }
    }

    const run = s.run;
    if (!run) return;
    const e = t - run.start;
    if (e >= run.seconds) {
      // Back to no light, still drawn
      skyTrace.uTraceFigure.value = -1;
      skyTrace.uTraceLight.value = 0;
      skyTrace.uTraceHead.value = 0;
      parts.satellite.material.uniforms.uOpacity.value = 0;
      for (const m of parts.meteors) {
        m.material.uniforms.uLight.value = 0;
        m.material.uniforms.uHead.value = 0;
      }
      s.run = null;
      s.rest = t + 8 * Math.max(wait, 0.15);
      return;
    }
    if (run.kind === 'trace') {
      const runFor = run.seconds - TRACE_FADE;
      const p = e / runFor;
      skyTrace.uTraceHead.value = p < 1 ? p : 1.5;
      skyTrace.uTraceLight.value =
        Math.min(e / 0.3, 1) * (p < 1 ? 1 : Math.max(0, 1 - (e - runFor) / TRACE_FADE) ** 1.5);
    } else if (run.kind === 'satellite') {
      const p = e / run.seconds;
      along.copy(run.from!).lerp(run.to!, p).normalize();
      parts.satellite.quaternion.copy(q.setFromUnitVectors(out, along));
      // Steady, in and out at the ends, a little brighter as it passes over
      parts.satellite.material.uniforms.uOpacity.value =
        Math.min(p / 0.12, 1) * Math.min((1 - p) / 0.15, 1) * (0.85 + 0.15 * Math.sin(Math.PI * p));
    } else {
      parts.meteors.forEach((m, i) => {
        const at = meteorAt(e - i * 0.35, i ? 0.26 : 0.34);
        const live = e - i * 0.35 >= 0 && !at.done;
        m.material.uniforms.uHead.value = live ? at.head : 0;
        m.material.uniforms.uLight.value = live ? at.light : 0;
      });
    }
    invalidate();
  });
  return (
    <group name="sky-events">
      <primitive object={parts.satellite} />
      {parts.meteors.map((m, i) => (
        <primitive key={i} object={m.line} />
      ))}
    </group>
  );
};
