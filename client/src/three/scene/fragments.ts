import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { PieceType } from '../../engine/pieces';
import { wholePiece } from './occlusion';

/** A shard of a piece: part of its surface, in the piece's own frame. */
export interface Fragment {
  geometry: BufferGeometry;
  /** Its middle, and how far its lowest point lies under it. */
  centre: Vector3;
  below: number;
}

/** The shards' size, piece units (a king stands 0.87 tall). */
const CELL = 0.16;

// Bends the grid the triangles are sorted by, so the shards break along
// ragged lines rather than a box's
const warp = (x: number, y: number, z: number) => [
  x + 0.05 * Math.sin(y * 23 + z * 7),
  y + 0.06 * Math.sin(x * 19 + z * 13),
  z + 0.05 * Math.sin(x * 11 + y * 17),
];

const cache = new Map<PieceType, Fragment[]>();

/**
 * A piece's body cut into shards: its triangles sorted into a warped grid,
 * each cell a shard. Each shard's geometry keeps the piece's own
 * coordinates, so it is drawn with the piece's glaze exactly as the whole
 * piece is until it moves. Built once per piece type and shared.
 */
export const fragmentsOf = (type: PieceType): Fragment[] => {
  const known = cache.get(type);
  if (known) return known;
  const whole = wholePiece(type);
  const source = whole.index ? whole.toNonIndexed() : whole;
  const position = source.getAttribute('position');
  const names = Object.keys(source.attributes);
  const cells = new Map<string, number[]>();
  for (let t = 0; t < position.count / 3; t++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      x += position.getX(t * 3 + k) / 3;
      y += position.getY(t * 3 + k) / 3;
      z += position.getZ(t * 3 + k) / 3;
    }
    const key = warp(x, y, z)
      .map((v) => Math.floor(v / CELL))
      .join(',');
    const list = cells.get(key);
    if (list) list.push(t);
    else cells.set(key, [t]);
  }
  const fragments = [...cells.values()].map((triangles) => {
    const geometry = new BufferGeometry();
    for (const name of names) {
      const from = source.getAttribute(name);
      const size = from.itemSize;
      const array = new Float32Array(triangles.length * 3 * size);
      triangles.forEach((t, i) => {
        for (let k = 0; k < 3; k++) {
          for (let c = 0; c < size; c++) {
            array[(i * 3 + k) * size + c] = from.getComponent(t * 3 + k, c);
          }
        }
      });
      geometry.setAttribute(name, new BufferAttribute(array, size));
    }
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const centre = box.getCenter(new Vector3());
    geometry.computeBoundingSphere();
    return { geometry, centre, below: centre.y - box.min.y };
  });
  cache.set(type, fragments);
  return fragments;
};

/** A repeatable random number in [0, 1) for shard `i`'s `k`th draw. */
export const shardRandom = (i: number, k: number) => {
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
