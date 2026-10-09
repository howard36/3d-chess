import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { noRaycast } from '../noRaycast';
import { useDisposeOnUnmount } from './dispose';
import type { Constellation, Placement } from './skyPlace';
import { placeStar } from './skyPlace';
import { chartGeometry, EGG_PLAN, majorEntries } from './skyChart';
import { richFieldGeometry } from './skyStars';
import { skyLineMaterial, skyPointMaterial } from './skyShaders';

export { placeStar, skyDirection } from './skyPlace';

// The night overhead. A field of stars, spent where a camera can see it
// (skyStars.ts), and high above the garden, where only a camera sunk below
// the horizon looking up past the tower can see, eight chess pieces drawn
// among them as constellations, as a star chart draws them (skyChart.ts): a
// few brighter stars each, joined by hair-thin lines, round the whole sky,
// so whichever way the player looks up there is one beside the tower. They
// sit above the top of the frame in every ordinary view: an easter egg, not
// a backdrop. Whatever lies behind the tower is held down to nothing
// (mask.ts). The Milky Way, the hidden asterisms and the sky's rare events
// are skyDetail.tsx's.

const loop = (n: number, from = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => [from + i, from + ((i + 1) % n)]);

// The pieces as constellations, each an outline of a few stars
const KNIGHT: Constellation = {
  stars: [
    [0.52, 1.0],
    [0.66, 0.84],
    [0.8, 0.6],
    [0.86, 0.28],
    [0.82, 0.0],
    [0.24, 0.0],
    [0.3, 0.3],
    [0.36, 0.42],
    [0.04, 0.48],
    [0.1, 0.66],
    [0.38, 0.86],
  ],
  lines: loop(11),
  loose: [[0.34, 0.7]],
  alpha: 0,
};
const ROOK: Constellation = {
  stars: [
    [0.18, 0.0],
    [0.82, 0.0],
    [0.72, 0.16],
    [0.7, 0.7],
    [0.82, 0.78],
    [0.82, 1.0],
    [0.62, 1.0],
    [0.62, 0.9],
    [0.38, 0.9],
    [0.38, 1.0],
    [0.18, 1.0],
    [0.18, 0.78],
    [0.3, 0.7],
    [0.28, 0.16],
  ],
  lines: loop(14),
  alpha: 5,
};
const KING: Constellation = {
  stars: [
    // The cross
    [0.5, 1.0],
    [0.5, 0.78],
    [0.39, 0.9],
    [0.61, 0.9],
    // The crown and body
    [0.3, 0.7],
    [0.7, 0.7],
    [0.63, 0.32],
    [0.76, 0.06],
    [0.24, 0.06],
    [0.37, 0.32],
  ],
  lines: [[0, 1], [2, 3], [1, 4], [1, 5], ...loop(6, 4).slice(1), [9, 4]],
  alpha: 0,
};
const BISHOP: Constellation = {
  stars: [
    [0.26, 0.04],
    [0.39, 0.3],
    [0.43, 0.5],
    // The mitre, pointed, with its cut
    [0.36, 0.67],
    [0.5, 0.95],
    [0.59, 0.77],
    [0.64, 0.67],
    [0.57, 0.5],
    [0.61, 0.3],
    [0.74, 0.04],
    [0.44, 0.63],
  ],
  lines: [...loop(10), [5, 10]],
  alpha: 4,
};
const QUEEN: Constellation = {
  stars: [
    [0.25, 0.04],
    [0.39, 0.32],
    // The coronet: three points
    [0.3, 0.88],
    [0.41, 0.74],
    [0.5, 0.97],
    [0.59, 0.74],
    [0.7, 0.88],
    [0.61, 0.32],
    [0.75, 0.04],
  ],
  lines: loop(9),
  alpha: 4,
};
const PAWN: Constellation = {
  stars: [
    [0.28, 0.04],
    [0.37, 0.6],
    // The head
    [0.42, 0.68],
    [0.38, 0.84],
    [0.5, 0.95],
    [0.62, 0.84],
    [0.58, 0.68],
    [0.63, 0.6],
    [0.72, 0.04],
  ],
  // The collar drawn across
  lines: [...loop(9), [1, 7]],
  alpha: 4,
};
const UNICORN: Constellation = {
  stars: [
    // The foot, waist and collar, as the king's
    [0.26, 0.04],
    [0.39, 0.3],
    [0.31, 0.42],
    // The horn, a slim tall cone on the collar, two turns of its spiral
    // drawn across it
    [0.42, 0.48],
    [0.441, 0.62],
    [0.467, 0.8],
    [0.5, 1.02],
    [0.521, 0.88],
    [0.544, 0.72],
    [0.58, 0.48],
    [0.69, 0.42],
    [0.61, 0.3],
    [0.74, 0.04],
  ],
  lines: [...loop(13), [4, 8], [5, 7]],
  alpha: 6,
};
/** The knight turned the other way, for the far side of the sky. */
const KNIGHT_WEST: Constellation = {
  ...KNIGHT,
  stars: KNIGHT.stars.map(([u, v]) => [1 - u, v]),
  loose: KNIGHT.loose?.map(([u, v]) => [1 - u, v]),
};

/**
 * Round the whole sky about one every 45°, each centred at its own height
 * between 18° and 23° above the horizon: above the top of the frame from the
 * opening view (whose top edge is the horizon) and from the compact tower's
 * lowest view (6°), whole in frame beside the tower once the camera sinks to
 * its lowest, 14° below level, to look up.
 * Looking up from the opening view (the same for both seats: the board, not
 * the camera, turns for Black), the knight stands right of the tower and the
 * king left.
 */
export const SKY_PLAN: Placement[] = [
  { c: KNIGHT, azimuth: 172, elevation: 21, size: 9.5, tilt: -0.06 },
  { c: KING, azimuth: 221, elevation: 23, size: 9, tilt: 0.05 },
  { c: BISHOP, azimuth: 264, elevation: 19, size: 8, tilt: -0.05 },
  { c: ROOK, azimuth: 306, elevation: 22, size: 7, tilt: 0.06 },
  { c: QUEEN, azimuth: 352, elevation: 20, size: 8.5, tilt: 0.04 },
  { c: UNICORN, azimuth: 40, elevation: 22, size: 9, tilt: 0.07 },
  { c: PAWN, azimuth: 84, elevation: 18, size: 7, tilt: -0.08 },
  { c: KNIGHT_WEST, azimuth: 128, elevation: 21, size: 9.5, tilt: 0.05 },
];

/** The constellations' line strength. */
const FIGURE_LINE = 0.065;

/** Every constellation star, the asterisms' too: no bright field star stands near one. */
const figureDirections = () =>
  [...SKY_PLAN, ...Object.values(EGG_PLAN)].flatMap((plan) =>
    plan.c.stars.map((s) => placeStar(s, plan)),
  );

/** The field of stars (skyStars.ts). */
const Field = ({ dpr }: { dpr: number }) => {
  const parts = useMemo(
    () => ({ geometry: richFieldGeometry(figureDirections()), material: skyPointMaterial({}) }),
    [],
  );
  useDisposeOnUnmount(parts);
  parts.material.uniforms.uDpr.value = dpr;
  return (
    <points
      geometry={parts.geometry}
      material={parts.material}
      renderOrder={-899}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/** The figures to chart: the eight. */
export const chartedFigures = () => majorEntries(SKY_PLAN);

/** The eight drawn as a star chart does (skyChart.ts). */
const ChartFigures = ({ dpr }: { dpr: number }) => {
  const parts = useMemo(() => {
    const { stars, lines } = chartGeometry(chartedFigures());
    return {
      stars,
      lines,
      starMaterial: skyPointMaterial({}),
      lineMaterial: skyLineMaterial({ opacity: FIGURE_LINE }),
    };
  }, []);
  useDisposeOnUnmount(parts);
  parts.starMaterial.uniforms.uDpr.value = dpr;
  return (
    <>
      <lineSegments
        geometry={parts.lines}
        material={parts.lineMaterial}
        renderOrder={-898}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <points
        geometry={parts.stars}
        material={parts.starMaterial}
        renderOrder={-897}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </>
  );
};

/** The sky's stars and its chess constellations. */
export const Heavens = () => {
  const dpr = useThree((s) => s.viewport.dpr);
  return (
    <group name="heavens">
      <Field dpr={dpr} />
      <ChartFigures dpr={dpr} />
    </group>
  );
};
