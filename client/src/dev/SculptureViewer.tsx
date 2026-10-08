import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { PieceType } from '../engine/pieces';
import { GARDEN, SCALE, Sculptures } from '../three/scene/stage';
import { BoardDetail } from '../three/scene/boardDetail';
import { FALLEN, fallenPose } from '../three/scene/boardFallen';
import { sculptureOf } from '../three/scene/sculptures';
import { GROUND_Y } from '../three/scene/palette';

// The sculpture viewer: the garden's neon (its twelve sculptures, their
// detail and the fallen pieces, through the game's own components and the
// env-preview settings in the address) alone on a dark ground, out of the
// tower's shade, with a camera put anywhere round any one of them, to see
// the tubes up close. Dev only: open http://127.0.0.1:5173/sculptures.html
// while Vite runs, or save views with scripts/sculptures.mjs. In the page,
// window.__view({ target, az, el, dist, turn }) moves the camera:
//
//   target  a square ('a4': the knight there), 'fallen:<i>' (a fallen
//           piece), or [x, y, z]
//   az      degrees round the target from the side facing the board's
//           centre (0), counter-clockwise from above
//   el      degrees above the horizon
//   dist    distance from the target (world units)
//   turn    -1 to turn the garden about as for Black (default 1)
//
// and resolves once the frame is drawn. Query: ?env=... as in the game (the
// preview's settings), turn=-1.

type Target = string | [number, number, number];
interface ViewSpec {
  target?: Target;
  az?: number;
  el?: number;
  dist?: number;
  fov?: number;
}

const deg = Math.PI / 180;

/** Where a target is (its middle) and which way the board's centre lies from it. */
const locate = (target: Target, turn: number): [number, number, number] => {
  if (Array.isArray(target)) return target;
  if (target.startsWith('fallen:')) {
    const f = FALLEN[Number(target.slice(7))];
    const { at, axis, length } = fallenPose(f, SCALE, GROUND_Y);
    return [
      (at[0] + (axis[0] * length) / 2) * turn,
      at[1] + (axis[1] * length) / 2,
      (at[2] + (axis[2] * length) / 2) * turn,
    ];
  }
  const g = GARDEN.find((s) => s.square === target) ?? GARDEN[0];
  const h = sculptureOf(g.type ?? PieceType.King).top * SCALE;
  return [g.at[0] * turn, g.at[1] + h * 0.5, g.at[2] * turn];
};

const Rig = ({ turn }: { turn: number }) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const w = window as unknown as {
      __view: (v: ViewSpec) => Promise<string>;
      __viewerReady: boolean;
    };
    w.__view = ({ target = 'a4', az = 0, el = 8, dist = 14, fov = 30 }) => {
      const c = locate(target, turn);
      // az 0: the side facing the board's centre
      const base = Math.atan2(-c[0], -c[2]);
      const a = base + az * deg;
      const e = el * deg;
      camera.fov = fov;
      camera.near = 0.1;
      camera.far = 2000;
      camera.position.set(
        c[0] + dist * Math.cos(e) * Math.sin(a),
        c[1] + dist * Math.sin(e),
        c[2] + dist * Math.cos(e) * Math.cos(a),
      );
      camera.lookAt(c[0], c[1], c[2]);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      return new Promise((done) => {
        let n = 0;
        const step = () => {
          invalidate();
          if (++n >= 4) done(`${target} az ${az} el ${el} d ${dist}`);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    };
    w.__viewerReady = true;
  }, [camera, invalidate, turn]);
  return null;
};

/** A shade that never falls: a single point has no outline on screen. */
const NO_SHADE = [[0, 0, 0]] as const;

export const SculptureViewer = ({ params }: { params: URLSearchParams }) => {
  const turn = params.get('turn') === '-1' ? -1 : 1;
  return (
    <div style={{ position: 'fixed', inset: 0 }} data-testid="sculpture-viewer">
      <Canvas
        frameloop="demand"
        dpr={1}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 30, position: [0, 0, 40], near: 0.1, far: 2000 }}
      >
        <color attach="background" args={['#05070d']} />
        <Rig turn={turn} />
        <Sculptures turn={turn} shade={NO_SHADE} whole={false} />
        <BoardDetail turn={turn} shade={NO_SHADE} />
      </Canvas>
    </div>
  );
};
