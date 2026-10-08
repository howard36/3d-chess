import { MathUtils } from 'three';
import type { Camera, PerspectiveCamera } from 'three';

// ENV PREVIEW (temporary; sculptureNearFade): the colossal figures are meant
// to be seen from the tower's side, as a player sitting at the tower sees
// them. Zoomed far out the camera can pass a figure and stand behind it,
// where it would loom up close between the camera and the tower; there the
// figure is not drawn. A figure is shown or hidden whole (every part of it
// takes its slot of gardenWhole), never faded, and it changes only on a
// frame when none of it is on screen, so nothing ever pops in view: turning
// round from a figure's front to its back, the camera has it out of frame
// for a moment, and it goes then.

/** A figure of the garden: where it stands, and the boxes round all it draws. */
export interface GardenFigure {
  /** Its foot on the board (x, z), in the garden's own coordinates (White's). */
  at: readonly [number, number];
  /** Boxes [x0, y0, z0, x1, y1, z1] round everything it draws, in the same coordinates. */
  boxes: readonly (readonly [number, number, number, number, number, number])[];
}

/**
 * How far behind the plane through a figure (square to its direction from
 * the tower) the camera stands before the figure is behind it (world units;
 * negative: a little before that plane). Zoomed out as far as it goes the
 * desktop camera stands only a few tenths past the sculptures' plane, inside
 * a sculpture's own tubes as it passes one, which it has in frame at every
 * step; four units short of the plane the sculpture is still well out to
 * the side of the camera, out of frame. gardenSides.test.ts walks the
 * orbits zoomed out: on a desktop every figure goes and comes back out of
 * frame at every elevation; on a phone too but for a band round 48–50° up,
 * where one standing under the camera can stay in the frame's foot for a
 * few degrees of the turn after the camera crosses its line.
 */
export const SIDE_MARGIN = -4;

/**
 * Seen from the side it is meant to be (the tower's): the camera, at (x, z),
 * nearer the tower than the plane through the figure square to its
 * direction from the tower (`margin` past it). `turn` is the garden's (-1
 * for Black: everything stands turned half about).
 */
export const seenFromFront = (
  camera: readonly [number, number],
  at: readonly [number, number],
  turn = 1,
  margin = SIDE_MARGIN,
) => {
  const [sx, sz] = [at[0] * turn, at[1] * turn];
  const d = Math.hypot(sx, sz);
  if (d < 1e-6) return true;
  return (camera[0] * sx + camera[1] * sz) / d < d + margin;
};

/**
 * Out of frame by this much more than the frustum (radians, each side), so
 * a figure that changes on one frame is out of frame however the camera has
 * turned since the frame it was tested against.
 */
export const OFF_FRAME_SLACK = MathUtils.degToRad(3);

const corners = new Float32Array(24);

/**
 * Whether none of a figure is in the camera's view: every corner of each of
 * its boxes behind the camera, or all beyond one edge of the frame (widened
 * by OFF_FRAME_SLACK). Conservative: a box only grazing past a corner of the
 * frame counts as in it. The camera's matrices must be current.
 */
export const offFrame = (camera: Camera, figure: GardenFigure, turn = 1): boolean => {
  const view = camera.matrixWorldInverse.elements;
  const p = camera.projectionMatrix.elements;
  // The frame's edges as slopes x/-z and y/-z in the camera's space (the
  // projection may be shifted: setLensShift), each turned out by the slack
  const out = (t: number, s: number) => Math.tan(Math.atan(t) + s * OFF_FRAME_SLACK);
  const right = out((1 + p[8]) / p[0], 1);
  const left = out((-1 + p[8]) / p[0], -1);
  const top = out((1 + p[9]) / p[5], 1);
  const bottom = out((-1 + p[9]) / p[5], -1);
  for (const [x0, y0, z0, x1, y1, z1] of figure.boxes) {
    // The box turned with the garden (a half turn keeps it a box)
    const [ax, bx] = turn > 0 ? [x0, x1] : [-x1, -x0];
    const [az, bz] = turn > 0 ? [z0, z1] : [-z1, -z0];
    let k = 0;
    for (const x of [ax, bx])
      for (const y of [y0, y1])
        for (const z of [az, bz]) {
          corners[k++] = view[0] * x + view[4] * y + view[8] * z + view[12];
          corners[k++] = view[1] * x + view[5] * y + view[9] * z + view[13];
          corners[k++] = view[2] * x + view[6] * y + view[10] * z + view[14];
        }
    const all = (test: (x: number, y: number, depth: number) => boolean) => {
      for (let i = 0; i < 24; i += 3)
        if (!test(corners[i], corners[i + 1], -corners[i + 2])) return false;
      return true;
    };
    const outside =
      all((_x, _y, d) => d <= 0) ||
      all((x, _y, d) => x > right * d) ||
      all((x, _y, d) => x < left * d) ||
      all((_x, y, d) => y > top * d) ||
      all((_x, y, d) => y < bottom * d);
    if (!outside) return false;
  }
  return true;
};

/**
 * Each figure shown (1) or not (0), kept per canvas: on the first frame as
 * the rule has it; after that a figure changes only when it is out of frame
 * now and was on the frame before (the camera moves a little between the
 * frame drawn and the next one's test).
 */
export class GardenSides {
  readonly shown: Float32Array;
  private readonly wasOff: boolean[];
  private started = false;

  constructor(private readonly figures: readonly GardenFigure[]) {
    this.shown = new Float32Array(figures.length).fill(1);
    this.wasOff = figures.map(() => false);
  }

  /** Brings every figure up to date for a camera; true if any changed. */
  update(camera: Camera | PerspectiveCamera, turn = 1, margin = SIDE_MARGIN): boolean {
    camera.updateMatrixWorld();
    const c: [number, number] = [camera.position.x, camera.position.z];
    let changed = false;
    this.figures.forEach((figure, i) => {
      const want = seenFromFront(c, figure.at, turn, margin) ? 1 : 0;
      const off = offFrame(camera, figure, turn);
      if (want !== this.shown[i] && (!this.started || (off && this.wasOff[i]))) {
        this.shown[i] = want;
        changed = true;
      }
      this.wasOff[i] = off;
    });
    this.started = true;
    return changed;
  }
}
