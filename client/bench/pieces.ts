// Piece-set benchmark: builds the shared set cold (a fresh process per run,
// since the set and the knight's shapes are cached for the process) and
// hashes every geometry, so a change that alters a vertex shows up.
// Usage: npx vite-node bench/pieces.ts -- --root <client dir> [--quality medium]
import { argv } from 'node:process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const root = resolve(arg('root', resolve(import.meta.dirname, '..')));
const quality = arg('quality', 'medium');

const { PieceType } = await import(`${root}/src/engine/pieces.ts`);
const t0 = performance.now();
const setModule = await import(`${root}/src/three/pieces/set.ts`);
const { pieceSet } = setModule;
const importMs = performance.now() - t0;
// Where the checkout ships the medium knight precomputed, its chunk loads in
// the background before the board is drawn: load it first, and report how
// long that took apart from the build
let knightLoadMs: number | undefined;
if (quality === 'medium' && setModule.loadBakedKnight) {
  const s = performance.now();
  await setModule.loadBakedKnight();
  knightLoadMs = +(performance.now() - s).toFixed(2);
}

const set = pieceSet(quality);
type Geometry = {
  attributes: Record<string, { array: Float32Array }>;
  index: { array: ArrayLike<number> } | null;
};
const hashGeometry = (h: ReturnType<typeof createHash>, key: string, g: Geometry) => {
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name].array;
    h.update(`${key}/${name}`);
    h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  }
  if (g.index) h.update(Buffer.from(Uint32Array.from(g.index.array).buffer));
};
const times: Record<string, number> = {};
const hash = createHash('sha256');
const triangles: Record<string, number> = {};
let total = 0;
for (const t of Object.values(PieceType) as string[]) {
  const s = performance.now();
  const parts = set[t];
  const dt = performance.now() - s;
  times[t] = +dt.toFixed(2);
  total += dt;
  let tris = 0;
  for (const part of ['body', 'collar', 'accent', 'foot']) {
    const g = parts[part];
    if (!g) continue;
    hashGeometry(hash, `${t}/${part}`, g);
    if (g.index) tris += g.index.count / 3;
  }
  triangles[t] = tris;
}
// The set as the game draws it (medium only): occlusion baked into every
// vertex and the parts merged into one geometry per piece (wholePiece)
const bakeTimes: Record<string, number> = {};
let bakeTotal = 0;
const bakeHash = createHash('sha256');
if (quality === 'medium') {
  const occlusion = await import(`${root}/src/three/scene/occlusion.ts`);
  const { wholePiece } = occlusion;
  // Likewise the precomputed occlusion, where the checkout ships it
  await occlusion.loadBakedOcclusion?.();
  for (const t of Object.values(PieceType) as string[]) {
    const s = performance.now();
    const g = wholePiece(t);
    const dt = performance.now() - s;
    bakeTimes[t] = +dt.toFixed(2);
    bakeTotal += dt;
    hashGeometry(bakeHash, t, g);
  }
}
console.log(
  JSON.stringify({
    bench: 'pieces',
    quality,
    importMs: +importMs.toFixed(2),
    knightLoadMs,
    totalMs: +total.toFixed(2),
    times,
    triangles,
    hash: hash.digest('hex').slice(0, 16),
    ...(quality === 'medium'
      ? {
          bakeMs: +bakeTotal.toFixed(2),
          firstBoardMs: +(total + bakeTotal).toFixed(2),
          bakeTimes,
          bakeHash: bakeHash.digest('hex').slice(0, 16),
        }
      : {}),
  }),
);
