import type { LessonStep, Step } from '../../game/lessons';

// The ways a piece moves, drawn as lines from the middle of a little cube:
// a rook's to the middles of its faces, a bishop's to the middles of its
// edges, a unicorn's to its corners. In the board's own colours: the gold of
// a destination, the red of a capture.

const MOVE = '#f8c970';
const CAPTURE = '#ff4a3d';
/** Px per square; the cube is drawn in a cabinet projection, depth (the rank) up and to the right. */
const UNIT = 20;
const DEPTH: [number, number] = [0.46, 0.3];
/** How far past the cube a slider's line runs on, as a share of half its side. */
const RUN = 1.55;

/** Where a point (file, rank, level) lands in the drawing. */
const project = ([x, y, z]: Step): [number, number] => [
  UNIT * (x + DEPTH[0] * y),
  -UNIT * (z + DEPTH[1] * y),
];

/** The cube's 12 edges, half a side `h` from its middle. */
const cubeEdges = (h: number): [Step, Step][] => {
  const corners: Step[] = [];
  for (const x of [-h, h])
    for (const y of [-h, h]) for (const z of [-h, h]) corners.push([x, y, z]);
  return corners.flatMap((a, i) =>
    corners
      .slice(i + 1)
      .filter((b) => a.filter((v, k) => v !== b[k]).length === 1)
      .map((b): [Step, Step] => [a, b]),
  );
};

const fmt = (n: number) => Math.round(n * 10) / 10;

export function Directions({ directions }: { directions: NonNullable<LessonStep['directions']> }) {
  const { moves, captures = [], reach, caption } = directions;
  const all = [
    ...moves.map((s) => ({ s, colour: MOVE })),
    ...captures.map((s) => ({ s, colour: CAPTURE })),
  ];
  // The cube reaches as far as the farthest step; a slider's lines run on past it
  const h = Math.max(1, ...all.flatMap(({ s }) => s.map(Math.abs)));
  const run = reach === 'line' ? RUN : 1;
  // Farthest first, so nearer lines cross over them
  const ordered = [...all].sort((a, b) => b.s[1] - a.s[1]);
  // A knight's jumps reach twice as far: drawn at half the size
  const scale = reach === 'jump' ? 0.5 : 1;
  const at = (s: Step, k = 1) => project([s[0] * k * scale, s[1] * k * scale, s[2] * k * scale]);
  // The drawing's box, the same for every piece: round the farthest a
  // slider's line runs, with room for the dots
  const points = cubeEdges(RUN).flat().map(project);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const pad = 5;
  const box = [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) - Math.min(...xs) + 2 * pad,
    Math.max(...ys) - Math.min(...ys) + 2 * pad,
  ]
    .map(fmt)
    .join(' ');

  return (
    <figure className="learn-figure">
      <svg viewBox={box} aria-hidden>
        {cubeEdges(h).map(([a, b], i) => {
          const [x1, y1] = at(a);
          const [x2, y2] = at(b);
          return (
            <line
              key={i}
              x1={fmt(x1)}
              y1={fmt(y1)}
              x2={fmt(x2)}
              y2={fmt(y2)}
              stroke="rgba(214, 222, 236, 0.22)"
              strokeWidth="1"
            />
          );
        })}
        {ordered.map(({ s, colour }) => {
          const [ex, ey] = at(s);
          const [tx, ty] = at(s, run);
          const key = s.join(',');
          return (
            <g key={key} data-step={key}>
              {reach !== 'jump' && (
                <line
                  x1="0"
                  y1="0"
                  x2={fmt(ex)}
                  y2={fmt(ey)}
                  stroke={colour}
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              )}
              {reach === 'line' && (
                <line
                  x1={fmt(ex)}
                  y1={fmt(ey)}
                  x2={fmt(tx)}
                  y2={fmt(ty)}
                  stroke={colour}
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeDasharray="1 4"
                  opacity="0.75"
                />
              )}
              <circle cx={fmt(ex)} cy={fmt(ey)} r={reach === 'jump' ? 2.4 : 2.6} fill={colour} />
            </g>
          );
        })}
        <circle cx="0" cy="0" r="4" fill="#f3f6ff" />
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

const LEVEL_EDGES = ['#00d7e0', '#58c1ff', '#96a7ff', '#c48be5', '#de77ab'];

/**
 * Where a pawn promotes: the five levels stacked, the far rank of the top
 * one lit in a destination's gold (White's; Black's is the near rank of the
 * bottom one).
 */
export function PromotionRow() {
  // A square's width and depth, and the rise from one level to the next, in squares of the cube
  const cell = 0.4;
  const deep = 2;
  const rise = 0.75;
  const at = (x: number, y: number, z: number) =>
    project([(x - 2.5) * cell, (y - 2.5) * cell * deep, (z - 2) * rise]);
  const quad = (x0: number, y0: number, x1: number, y1: number, z: number) =>
    [at(x0, y0, z), at(x1, y0, z), at(x1, y1, z), at(x0, y1, z)]
      .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
      .join(' ');
  const corners = [0, 5].flatMap((x) => [0, 5].flatMap((y) => [0, 4].map((z) => at(x, y, z))));
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const pad = 5;
  const box = [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) - Math.min(...xs) + 2 * pad,
    Math.max(...ys) - Math.min(...ys) + 2 * pad,
  ]
    .map(fmt)
    .join(' ');
  return (
    <figure className="learn-figure">
      <svg viewBox={box} aria-hidden>
        {LEVEL_EDGES.map((colour, z) => (
          <polygon
            key={z}
            points={quad(0, 0, 5, 5, z)}
            fill="rgba(236, 241, 255, 0.04)"
            stroke={colour}
            strokeWidth="1"
            strokeLinejoin="round"
          />
        ))}
        {[0, 1, 2, 3, 4].map((x) => (
          <polygon
            key={x}
            points={quad(x + 0.12, 4.12, x + 0.88, 4.88, 4)}
            fill={MOVE}
            data-square={`E${'abcde'[x]}5`}
          />
        ))}
      </svg>
      <figcaption>5 squares</figcaption>
    </figure>
  );
}
