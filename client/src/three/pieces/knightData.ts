import { BufferAttribute, BufferGeometry, Uint16BufferAttribute } from 'three';
import { fromStoredText, toStoredText } from './bytes';
import type { KnightGeometry } from './knight';

// The sculpted knight's meshes as bytes, so the set the game draws can ship
// them precomputed (knight.medium.ts, written by `npm run bake:pieces`)
// rather than sculpt and decimate them in the browser. Every attribute and
// index is stored bit for bit: decoding gives back exactly what buildKnight
// returns.

/** Each mesh's vertex and index counts, in MESHES order, then the bytes. */
export interface KnightData {
  counts: number[];
  base64: string;
}

const MESHES = ['head', 'mane', 'eyes'] as const;
// Per mesh: position (3), normal (3), uv (2) as Float32, then the index as
// Uint16, padded to a whole Float32
const ATTRIBUTES = [
  ['position', 3],
  ['normal', 3],
  ['uv', 2],
] as const;

const byteLength = (vertices: number, indices: number) =>
  vertices * 8 * 4 + Math.ceil(indices / 2) * 4;

export const encodeKnight = (k: KnightGeometry): KnightData => {
  const counts: number[] = [];
  const chunks: Uint8Array[] = [];
  for (const mesh of MESHES) {
    const g = k[mesh];
    const index = g.index!.array;
    if (!(index instanceof Uint16Array))
      throw new Error(`The knight's ${mesh} needs 32-bit indices`);
    const vertices = g.getAttribute('position').count;
    counts.push(vertices, index.length);
    const bytes = new Uint8Array(byteLength(vertices, index.length));
    let at = 0;
    for (const [name, size] of ATTRIBUTES) {
      const a = g.getAttribute(name).array as Float32Array;
      if (a.length !== vertices * size) throw new Error(`Unexpected ${mesh} ${name}`);
      bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at);
      at += a.byteLength;
    }
    bytes.set(new Uint8Array(index.buffer, index.byteOffset, index.byteLength), at);
    chunks.push(bytes);
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { counts, base64: toStoredText(bytes) };
};

export const decodeKnight = ({ counts, base64 }: KnightData): KnightGeometry => {
  const bytes = fromStoredText(base64);
  const out = {} as KnightGeometry;
  let at = 0;
  MESHES.forEach((mesh, m) => {
    const vertices = counts[m * 2];
    const indices = counts[m * 2 + 1];
    const g = new BufferGeometry();
    for (const [name, size] of ATTRIBUTES) {
      // Copied out, so each attribute owns its buffer as a built one does
      const a = new Float32Array(bytes.buffer.slice(at, at + vertices * size * 4));
      g.setAttribute(name, new BufferAttribute(a, size));
      at += vertices * size * 4;
    }
    g.setIndex(
      new Uint16BufferAttribute(new Uint16Array(bytes.buffer.slice(at, at + indices * 2)), 1),
    );
    at += Math.ceil(indices / 2) * 4;
    out[mesh] = g;
  });
  return out;
};
