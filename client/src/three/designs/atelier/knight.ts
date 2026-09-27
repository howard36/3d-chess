import { ExtrudeGeometry, Shape, Vector2 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Atelier's knight head: a smooth side profile (chest, throat, jaw, muzzle,
// brow, a pricked ear and the crest of the mane) extruded with a deep rounded
// bevel, then tapered so the muzzle and the mane are narrower than the
// cheeks. It reads as a horse from the side, and from the front as a head
// rather than a slab. Modeled like the Staunton set: x forward, y up, sitting
// on the knight's turned base (whose top is at 0.14), about 0.75 tall.

const PROFILE: [number, number][] = [
  [0.1, 0.125],
  [0.145, 0.185],
  [0.158, 0.255],
  [0.142, 0.325],
  [0.122, 0.365], // throat
  [0.158, 0.387],
  [0.215, 0.398], // chin
  [0.252, 0.425],
  [0.266, 0.462], // muzzle
  [0.252, 0.503],
  [0.2, 0.545], // bridge of the nose
  [0.135, 0.592],
  [0.09, 0.632], // brow
  [0.082, 0.705], // ear tip
  [0.045, 0.668],
  [0.012, 0.648], // poll
  [-0.045, 0.615],
  [-0.095, 0.55], // crest of the mane
  [-0.13, 0.46],
  [-0.152, 0.35],
  [-0.162, 0.24],
  [-0.155, 0.125],
];

const smooth = (t: number) => t * t * (3 - 2 * t);
const ramp = (a: number, b: number, x: number) =>
  smooth(Math.min(Math.max((x - a) / (b - a), 0), 1));

export const buildKnightHead = () => {
  const shape = new Shape();
  shape.moveTo(...PROFILE[0]);
  shape.splineThru(PROFILE.slice(1).map(([x, y]) => new Vector2(x, y)));
  shape.closePath();
  const depth = 0.12;
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.03,
    bevelSegments: 4,
    curveSegments: 3,
  });
  geometry.translate(0, 0, -depth / 2);
  // Taper: a narrower muzzle and mane crest, a fuller jaw
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const muzzle = 1 - 0.34 * ramp(0.12, 0.27, x) * ramp(0.36, 0.46, y);
    const mane = 1 - 0.38 * ramp(-0.06, -0.17, x) * ramp(0.3, 0.6, y);
    const ear = 1 - 0.45 * ramp(0.64, 0.71, y);
    p.setZ(i, p.getZ(i) * muzzle * mane * ear);
  }
  // Weld the caps to the bevel so the whole head shades smoothly (an
  // extrusion is otherwise flat-shaded face by face, which reads as carved)
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('normal');
  const welded = mergeVertices(geometry, 1e-5);
  geometry.dispose();
  welded.computeVertexNormals();
  return welded;
};
