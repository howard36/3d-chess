import {
  BoxGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';

// Staunton-style turned silhouettes. Profiles are [radius, height] pairs,
// bottom -> top, with both ends at radius 0 so the lathe is closed.
// All pieces are modeled base-at-y=0 growing upward, sized to fit a 1x1x1
// board cell (max height 0.87, max radius 0.28).

const lathe = (pts: [number, number][], segments = 24) =>
  new LatheGeometry(
    pts.map(([x, y]) => new Vector2(x, y)),
    segments,
  );

// --- Pawn (top ~0.545) ---
export const pawnBodyGeometry = lathe([
  [0, 0],
  [0.23, 0],
  [0.23, 0.035],
  [0.19, 0.06],
  [0.13, 0.1],
  [0.09, 0.16],
  [0.075, 0.22],
  [0.065, 0.28],
  [0.12, 0.3],
  [0.12, 0.325],
  [0.065, 0.345],
  [0.05, 0.36],
  [0, 0.36],
]);
export const pawnHeadGeometry = new SphereGeometry(0.115, 20, 14);

// --- Rook (top ~0.64) ---
// Rim at 0.54 with an inner well down to 0.50, so it reads hollow from above.
export const rookBodyGeometry = lathe([
  [0, 0],
  [0.26, 0],
  [0.26, 0.05],
  [0.21, 0.09],
  [0.155, 0.16],
  [0.135, 0.28],
  [0.135, 0.42],
  [0.19, 0.45],
  [0.21, 0.47],
  [0.21, 0.54],
  [0.13, 0.54],
  [0.13, 0.5],
  [0, 0.5],
]);
export const rookCrenellationGeometry = new BoxGeometry(0.085, 0.1, 0.055);

// --- Bishop (top ~0.77) ---
export const bishopBodyGeometry = lathe([
  [0, 0],
  [0.24, 0],
  [0.24, 0.04],
  [0.2, 0.07],
  [0.13, 0.12],
  [0.09, 0.2],
  [0.075, 0.32],
  [0.07, 0.4],
  [0.13, 0.42],
  [0.13, 0.445],
  [0.075, 0.465],
  [0.125, 0.53],
  [0.145, 0.58],
  [0.115, 0.63],
  [0.06, 0.68],
  [0.035, 0.7],
  [0, 0.7],
]);
export const bishopFinialGeometry = new SphereGeometry(0.045, 12, 10);
export const bishopSlotGeometry = new BoxGeometry(0.2, 0.014, 0.09);

// --- Knight (top ~0.70) ---
export const knightBaseGeometry = lathe([
  [0, 0],
  [0.24, 0],
  [0.24, 0.045],
  [0.19, 0.08],
  [0.16, 0.1],
  [0.17, 0.115],
  [0.15, 0.14],
  [0, 0.14],
]);

// Side profile of the horse head/neck in the XY plane (x = forward, y = up),
// extruded along z and centered.
const knightHeadShape = new Shape();
const knightHeadOutline: [number, number][] = [
  [0.1, 0.14],
  [0.13, 0.28],
  [0.15, 0.4],
  [0.22, 0.44],
  [0.23, 0.5],
  [0.16, 0.53],
  [0.09, 0.55],
  [0.04, 0.61],
  [0.01, 0.68],
  [-0.04, 0.62],
  [-0.06, 0.52],
  [-0.1, 0.36],
  [-0.13, 0.2],
  [-0.14, 0.14],
];
knightHeadShape.moveTo(...knightHeadOutline[0]);
for (const [x, y] of knightHeadOutline.slice(1)) {
  knightHeadShape.lineTo(x, y);
}
knightHeadShape.closePath();

const knightHeadDepth = 0.17;
export const knightHeadGeometry = new ExtrudeGeometry(knightHeadShape, {
  depth: knightHeadDepth,
  bevelEnabled: true,
  bevelThickness: 0.03,
  bevelSize: 0.028,
  bevelSegments: 3,
  curveSegments: 8,
});
knightHeadGeometry.translate(0, 0, -knightHeadDepth / 2);

// --- Unicorn (top ~0.82) ---
// Bishop-like stem ending in a rounded dome, topped by a spiral-ridged horn.
export const unicornBodyGeometry = lathe([
  [0, 0],
  [0.25, 0],
  [0.25, 0.04],
  [0.2, 0.075],
  [0.12, 0.13],
  [0.085, 0.22],
  [0.07, 0.32],
  [0.065, 0.38],
  [0.12, 0.4],
  [0.12, 0.425],
  [0.07, 0.445],
  [0.1, 0.48],
  [0.095, 0.51],
  [0, 0.53],
]);
export const unicornHornGeometry = new ConeGeometry(0.075, 0.3, 16);

const hornSpiralPoints: Vector3[] = [];
const HORN_SPIRAL_SAMPLES = 40;
for (let i = 0; i < HORN_SPIRAL_SAMPLES; i++) {
  const t = i / (HORN_SPIRAL_SAMPLES - 1);
  const angle = 2.5 * 2 * Math.PI * t;
  const r = 0.078 * (1 - t) + 0.008;
  hornSpiralPoints.push(new Vector3(r * Math.cos(angle), 0.52 + 0.3 * t, r * Math.sin(angle)));
}
export const unicornSpiralGeometry = new TubeGeometry(
  new CatmullRomCurve3(hornSpiralPoints),
  64,
  0.014,
  6,
  false,
);

// --- Queen (top ~0.84) ---
export const queenBodyGeometry = lathe([
  [0, 0],
  [0.27, 0],
  [0.27, 0.045],
  [0.22, 0.08],
  [0.14, 0.14],
  [0.105, 0.24],
  [0.09, 0.36],
  [0.085, 0.46],
  [0.15, 0.49],
  [0.15, 0.515],
  [0.09, 0.535],
  [0.14, 0.62],
  [0.17, 0.68],
  [0.175, 0.7],
  [0.12, 0.71],
  [0, 0.71],
]);
export const queenCoronetGeometry = new SphereGeometry(0.028, 8, 6);
export const queenFinialGeometry = new SphereGeometry(0.05, 12, 10);

// --- King (top ~0.87, tallest) ---
export const kingBodyGeometry = lathe([
  [0, 0],
  [0.28, 0],
  [0.28, 0.05],
  [0.23, 0.085],
  [0.15, 0.15],
  [0.11, 0.26],
  [0.095, 0.4],
  [0.09, 0.5],
  [0.16, 0.53],
  [0.16, 0.555],
  [0.1, 0.575],
  [0.14, 0.65],
  [0.165, 0.7],
  [0.11, 0.72],
  [0.05, 0.73],
  [0, 0.73],
]);
export const kingCrossVerticalGeometry = new BoxGeometry(0.045, 0.14, 0.045);
export const kingCrossHorizontalGeometry = new BoxGeometry(0.13, 0.045, 0.045);
