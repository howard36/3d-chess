import { BufferAttribute, BufferGeometry } from 'three';
// ENV PREVIEW (temporary): the plain's shape follows the preview's setting
import { getEnvSetting, subscribeEnv } from '../../envPreview';
import { horizonEdgeFix } from '../../envPreview/features/horizon';

// The plain's footprint (stage.tsx's Ground): a disc reaching nearly to the
// sky (radius GROUND_RADIUS, inside the sky's 400), so from any side its
// rim is the same distance off and far enough that the horizon's veil
// (horizon.tsx) has thickened into the sky's own colour before it: the
// plain meets the night at a level horizon with no edge or corner. The
// fragment shader draws everything from world positions, so a fan is all
// it needs.

/** The plain's radius (world units). */
export const GROUND_RADIUS = 390;
/** Main's plain: a square 260 across. */
const SQUARE_HALF = 130;
/** Segments round the rim (a multiple of 8, so the square's corners are vertices). */
const SEGMENTS = 128;

/**
 * The fan's corners, on the ground plane (y = 0): its centre, then the rim
 * round from +x. `square` lays the rim on main's square instead (each rim
 * point pushed out along its ray to the square's edge).
 */
export const groundFan = (square = false): Float32Array => {
  const out = new Float32Array((SEGMENTS + 2) * 3);
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = square ? SQUARE_HALF / Math.max(Math.abs(c), Math.abs(s)) : GROUND_RADIUS;
    out.set([c * r, 0, -s * r], (i + 1) * 3);
  }
  return out;
};

/** The plain's geometry: the disc (or, with the preview's fix off, main's square). */
export const groundGeometry = (): BufferGeometry => {
  const g = new BufferGeometry();
  const index: number[] = [];
  for (let i = 1; i <= SEGMENTS; i++) index.push(0, i, i + 1);
  g.setIndex(index);
  let square: boolean | null = null;
  const shape = () => {
    const now = getEnvSetting(horizonEdgeFix) === 'off';
    if (now === square) return;
    square = now;
    const position = g.getAttribute('position') as BufferAttribute | undefined;
    if (position) {
      position.array.set(groundFan(now));
      position.needsUpdate = true;
    } else g.setAttribute('position', new BufferAttribute(groundFan(now), 3));
    g.computeBoundingSphere();
  };
  shape();
  // ENV PREVIEW (temporary): reshaped in place when the setting changes (the
  // veil mounting or leaving tells the garden's copy to redraw)
  const stop = subscribeEnv(shape);
  g.addEventListener('dispose', stop);
  return g;
};
