import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Shape,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STAUNTON } from '../../pieceGeometry';

// Nightdrive's own knight and unicorn. The shared Staunton set's knight is a
// thin, blocky extrusion that reads as a leaning slab from most of the
// orbit, and its unicorn is a slim bishop with a small horn; at game size
// both were easy to mistake. Here the knight is a carved horse head (arched
// neck, long muzzle, a toothed mane and two ears that show from the front),
// and the unicorn is a stout column crowned by a long, fluted, twisting horn:
// a spike no other piece has, from the side or from above. Both are modelled
// base-at-y=0 in the Staunton set's units, and each is one merged geometry.

const lathe = (pts: [number, number][], segments = 24) =>
  new LatheGeometry(
    pts.map(([x, y]) => new Vector2(x, y)),
    segments,
  );

// --- Knight (top ~0.76) ----------------------------------------------------------------

// Side profile, facing +x, from the bottom of the neck round to the back.
const HEAD: [number, number][] = [
  [-0.16, 0.12],
  [0.12, 0.12],
  [0.15, 0.2],
  [0.13, 0.28],
  [0.15, 0.34],
  [0.22, 0.37],
  [0.28, 0.39],
  [0.305, 0.43],
  [0.295, 0.47],
  [0.24, 0.505],
  [0.17, 0.565],
  [0.11, 0.625],
  [0.07, 0.665],
  [0.0, 0.675],
  [-0.045, 0.655],
  // The mane, stepping down the back of the neck
  [-0.1, 0.6],
  [-0.085, 0.578],
  [-0.145, 0.51],
  [-0.128, 0.49],
  [-0.18, 0.415],
  [-0.163, 0.395],
  [-0.2, 0.3],
  [-0.19, 0.12],
];

const knightHead = (() => {
  const shape = new Shape();
  shape.moveTo(...HEAD[0]);
  for (const [x, y] of HEAD.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const depth = 0.1;
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.03,
    bevelSegments: 3,
  });
  g.translate(0, 0, -depth / 2);
  return g;
})();

const ear = (z: number) =>
  new ConeGeometry(0.032, 0.11, 10).rotateZ(-0.25).translate(0.05, 0.72, z);

const flat = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);

export const knightGeometry: BufferGeometry = mergeGeometries(
  [STAUNTON.knightBase.clone(), knightHead, ear(0.045), ear(-0.045)].map(flat),
);

// --- Unicorn (top ~0.88) ----------------------------------------------------------------

const UNICORN_BODY: [number, number][] = [
  [0, 0],
  [0.25, 0],
  [0.25, 0.04],
  [0.2, 0.075],
  [0.13, 0.13],
  [0.095, 0.22],
  [0.082, 0.3],
  [0.14, 0.325],
  [0.14, 0.352],
  [0.088, 0.368],
  [0.105, 0.405],
  [0.13, 0.44],
  [0.122, 0.462],
  [0, 0.47],
];

/** A cone with four ridges that twist as it rises: the horn. */
const twistedHorn = ({
  base = 0.44,
  height = 0.44,
  radius = 0.1,
  ridges = 4,
  turns = 1.4,
  around = 40,
  rings = 32,
} = {}): BufferGeometry => {
  const cols = around + 1;
  const position = new Float32Array(cols * (rings + 1) * 3);
  const uv = new Float32Array(cols * (rings + 1) * 2);
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = radius * (1 - t) ** 0.95;
    for (let i = 0; i <= around; i++) {
      const a = (i / around) * Math.PI * 2;
      const lobe = 1 + 0.2 * Math.cos(ridges * a - t * turns * Math.PI * 2);
      const k = j * cols + i;
      position.set([Math.cos(a) * r * lobe, base + height * t, Math.sin(a) * r * lobe], k * 3);
      uv.set([i / around, t], k * 2);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * cols + i;
      const b = a + cols;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
};

export const unicornGeometry: BufferGeometry = mergeGeometries(
  [lathe(UNICORN_BODY), twistedHorn()].map(flat),
);
