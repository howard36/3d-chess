import { BufferAttribute, BufferGeometry } from 'three';

// The plain's footprint (stage.tsx's Ground): a disc reaching nearly to the
// sky (radius GROUND_RADIUS, inside the sky's 400), so from any side its
// rim is the same distance off and far enough that the horizon's veil
// (VEIL_VERTEX_GLSL) has thickened into the sky's own colour before it: the
// plain meets the night at a level horizon with no edge or corner. The
// fragment shader draws everything from world positions; its parts
// (groundParts) only sort which detail is worked out where.

/** The plain's radius (world units). */
export const GROUND_RADIUS = 390;
/** Where the plain begins to thicken, and where it is the night's own (world units from the camera, across). */
export const VEIL = [70, 330] as const;
/** The veil starts no nearer the plain's centre than this (world units). */
export const VEIL_INNER = Math.max(VEIL[0] - 55, 1);
/** The sky's sphere (stage.tsx's Sky). */
const SKY_RADIUS = 400;

/**
 * GLSL, the veil, worked out for each vertex of the ground (given `w`, the
 * vertex in the world, after gl_Position is set; needs the sky's chunk,
 * skyColor.ts, and SHADE_AT_VERTEX): the sky's own colour where a ray from
 * the camera meets the sky's sphere (the very colour the Sky draws there,
 * either sky), and how much of it to mix over the plain, more and more with
 * distance, so far off the plain becomes exactly what the sky shows there
 * and no edge can be seen; into `vVeil`. The ground's mesh is fine enough
 * where it changes (horizonGround's groundParts); VEIL_MIX mixes it in per
 * pixel.
 */
export const VEIL_VERTEX_GLSL = /* glsl */ `
  {
    vec3 ray = w.xyz - cameraPosition;
    float veil = smoothstep(${VEIL[0].toFixed(1)}, ${VEIL[1].toFixed(1)}, length(ray.xz))
      * step(${VEIL_INNER.toFixed(1)}, length(w.xz));
    vec3 d = normalize(ray);
    float b = dot(cameraPosition, d);
    float c = dot(cameraPosition, cameraPosition) - ${(SKY_RADIUS * SKY_RADIUS).toFixed(1)};
    float s = -b + sqrt(max(b * b - c, 0.0));
    // As the display shows it (three.js's sRGB transfer), so a pixel only mixes
    vec3 sky = skyColorShaded(normalize(cameraPosition + d * s), shadeOfClip(gl_Position));
    sky = mix(pow(sky, vec3(0.41666)) * 1.055 - vec3(0.055), sky * 12.92,
      vec3(lessThanEqual(sky, vec3(0.0031308))));
    vVeil = vec4(sky, veil);
  }`;

/** GLSL, the veil from the vertices (VEIL_VERTEX_GLSL) mixed into `shown`. */
export const VEIL_MIX = /* glsl */ `
  shown.rgb = mix(shown.rgb, vVeil.rgb, vVeil.a < 0.002 ? 0.0 : vVeil.a);`;

/** Main's plain: a square 260 across. */
const SQUARE_HALF = 130;

/** Rays round the plain for its parts (a multiple of 8, so a square's corners are vertices). */
const RAYS = 128;

/** Where the ray at angle a (from +x, counterclockwise seen from above) meets a square of half-side h. */
const onSquare = (h: number, c: number, s: number) => h / Math.max(Math.abs(c), Math.abs(s));

/**
 * A part of the plain between two outlines round its centre, each a radius
 * along every ray (`inner`, `outer`), in `rings` steps out (even, or by a
 * constant `ratio`): the same rays for every part, so parts that share an
 * outline share its vertices and meet with no seam.
 */
const between = (
  inner: (c: number, s: number) => number,
  outer: (c: number, s: number) => number,
  rings: number,
  rays = RAYS,
  ratio = false,
) => {
  const pos: number[] = [];
  const index: number[] = [];
  const row = rays + 1;
  for (let j = 0; j <= rings; j++)
    for (let i = 0; i <= rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r0 = inner(c, s);
      const r1 = outer(c, s);
      // Out in even steps, or by a constant ratio
      const r = ratio ? r0 * (r1 / r0) ** (j / rings) : r0 + ((r1 - r0) * j) / rings;
      pos.push(c * r, 0, -s * r);
    }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < rays; i++) {
      const a = j * row + i;
      const b = a + row;
      // Faces up (counterclockwise seen from above)
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
};

/** Rays round the clear middle (a multiple of 8). */
const MIDDLE_RAYS = 64;
/** The clear middle reaches a little past its edge, under the court's ring (world units). */
const MIDDLE_OVER = 0.2;

/**
 * The plain in four parts, each drawn with only the detail that lies in it
 * (stage.tsx's Ground): the clear ground round the tower's foot (radius
 * `clear`), the rest of the court's disc (radius `court`), the colossal
 * board out to its frame's band (a square of half-side `board`) and the far
 * plain out to the rim (main's square with the preview's fix off). Their
 * meshes carry light worked out per vertex (the veil, with `veil`; the
 * pools round the sculptures, a few units across; the court's share of the
 * tower's shade), so they are fine enough where it changes, and no finer: a
 * software renderer pays for every triangle (about a microsecond each, in
 * CI's), and for a block of pixels for every triangle that touches it. The
 * far plain's rings step out by a constant ratio (the veil changes with the
 * angle below the horizon). The middle has fewer rays than the rest and so
 * cannot share their vertices: it reaches a little past its edge, and the
 * court's ring is drawn over that rim, both the same there, so they meet
 * with no seam.
 */
export const groundParts = (
  clear: number,
  court: number,
  board: number,
  square: boolean,
  veil: boolean,
) => {
  const rim = (c: number, s: number) => (square ? onSquare(SQUARE_HALF, c, s) : GROUND_RADIUS);
  const toBoard = (c: number, s: number) => onSquare(board, c, s);
  return {
    middle: between(
      () => 0,
      () => (clear + MIDDLE_OVER) / Math.cos(Math.PI / MIDDLE_RAYS),
      Math.round(clear / 2),
      MIDDLE_RAYS,
    ),
    court: between(
      () => clear,
      () => court,
      6,
    ),
    board: between(() => court, toBoard, 5),
    far: between(toBoard, rim, veil ? 14 : 1, RAYS, true),
  };
};
