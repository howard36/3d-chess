// The precomputed parts' bytes as text (knightData.ts, scene/occlusionData.ts),
// stored in byte planes: every value's first byte, then every second byte,
// and so on. Floats' high bytes change slowly, so their planes compress far
// better than the values side by side; the planes go back together exactly.

const PLANES = 4;

export const toStoredText = (bytes: Uint8Array): string => {
  const n = Math.floor(bytes.length / PLANES);
  let binary = '';
  for (let k = 0; k < PLANES; k++)
    for (let i = 0; i < n; i++) binary += String.fromCharCode(bytes[i * PLANES + k]);
  for (let i = n * PLANES; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

export const fromStoredText = (text: string): Uint8Array => {
  const binary = atob(text);
  const planes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) planes[i] = binary.charCodeAt(i);
  const bytes = new Uint8Array(planes.length);
  const n = Math.floor(planes.length / PLANES);
  for (let k = 0; k < PLANES; k++) {
    const plane = planes.subarray(k * n, (k + 1) * n);
    for (let i = 0; i < n; i++) bytes[i * PLANES + k] = plane[i];
  }
  bytes.set(planes.subarray(n * PLANES), n * PLANES);
  return bytes;
};
