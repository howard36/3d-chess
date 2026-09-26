import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  MeshBasicMaterial,
} from 'three';
import { CELLS } from '../../layout';
import { MOVE_ANIMATION } from '../../motion';
import { theme } from '../../theme';
import { latticeLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout, Design, MarkerProps } from '../types';
import { ClassicPieceBody } from './pieces';

const layout = latticeLayout();

// The grid is drawn as a single wireframe lattice rather than translucent cube
// faces: stacked transparent faces compound into haze toward the center of the
// board and sort badly against the pieces. One merged geometry keeps it to a
// single draw call. The lattice is the same set of cell edges under either
// orientation, so it is built once from White's view.
export const buildLatticeGeometry = (l: BoardLayout) => {
  const cellEdges = new EdgesGeometry(new BoxGeometry(...l.cellSize));
  const src = cellEdges.getAttribute('position');
  const merged = new Float32Array(CELLS.length * src.count * 3);
  CELLS.forEach((cell, i) => {
    const [cx, cy, cz] = l.toWorld(cell, 'white');
    for (let v = 0; v < src.count; v++) {
      const o = (i * src.count + v) * 3;
      merged[o] = src.getX(v) + cx;
      merged[o + 1] = src.getY(v) + cy;
      merged[o + 2] = src.getZ(v) + cz;
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(merged, 3));
  return geometry;
};
const latticeGeometry = buildLatticeGeometry(layout);

const Grid = () => (
  <lineSegments geometry={latticeGeometry} raycast={noRaycast}>
    <lineBasicMaterial
      color={theme.gridLine}
      transparent
      opacity={theme.gridLineOpacity}
      depthWrite={false}
    />
  </lineSegments>
);

const Stage = () => (
  <>
    <color attach="background" args={[theme.background]} />
    {/* Fog matched to the background gently fades the far side of the
        lattice, giving a depth cue the flat grid lines can't */}
    <fog attach="fog" args={[theme.background, 10, 26]} />
    <hemisphereLight args={['#f5f7fb', '#46506b', 1.1]} />
    <directionalLight position={[6, 10, 6]} intensity={2.2} />
    <directionalLight position={[-6, -4, -8]} intensity={1.0} color="#dfe6f2" />
  </>
);

// Move markers: a dot for a quiet move, a ring around a capturable piece.
// The dot marks empty space, so it sits at the cell centre; the ring
// encircles an occupied cell's piece, so it drops to that piece's base.
const Quiet = ({ centre }: MarkerProps) => (
  <mesh position={centre} raycast={noRaycast}>
    <sphereGeometry args={[0.11, 16, 16]} />
    <meshBasicMaterial color={theme.quietMove} transparent opacity={0.9} depthWrite={false} />
  </mesh>
);

const Capture = ({ floor }: MarkerProps) => (
  <mesh
    position={floor}
    rotation={[Math.PI / 2, 0, 0]}
    raycast={noRaycast}
    userData={{ captureRing: true }}
  >
    <torusGeometry args={[0.42, 0.035, 8, 32]} />
    <meshBasicMaterial color={theme.capture} transparent opacity={0.9} depthWrite={false} />
  </mesh>
);

// Ring around the foot of the selected piece. Slightly tighter than the
// capture ring, so the two read as different markers where they sit in
// neighbouring cells; the radius still clears the widest base (the king's,
// 0.28) while staying inside the cell.
const Selection = ({ floor }: MarkerProps) => (
  <mesh
    position={floor}
    rotation={[Math.PI / 2, 0, 0]}
    raycast={noRaycast}
    userData={{ selectionRing: true }}
  >
    <torusGeometry args={[0.38, 0.04, 8, 32]} />
    <meshBasicMaterial color={theme.select} transparent opacity={0.95} depthWrite={false} />
  </mesh>
);

const classic: Design = {
  id: 'classic',
  name: 'Classic',
  blurb: 'The original glacier-gray wireframe lattice with ivory and graphite Staunton pieces.',
  layout,
  continuous: false,
  Stage,
  Grid,
  cellFills: {
    destination: new MeshBasicMaterial({
      color: theme.highlightFill,
      transparent: true,
      opacity: theme.highlightFillOpacity,
      depthWrite: false,
    }),
    lastMove: new MeshBasicMaterial({
      color: theme.lastMoveFill,
      transparent: true,
      opacity: theme.lastMoveFillOpacity,
      depthWrite: false,
    }),
  },
  PieceBody: ClassicPieceBody,
  knightYaw: 0.35,
  markers: { Quiet, Capture, Selection },
  motion: { style: 'hop', durationMs: MOVE_ANIMATION.durationMs, lift: MOVE_ANIMATION.liftWorld },
  hud: { vars: {} },
};

export default classic;
