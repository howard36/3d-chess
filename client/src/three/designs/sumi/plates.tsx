import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MultiplyBlending,
  PlaneGeometry,
} from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout } from '../types';
import { washiTexture } from './textures';

// Washi platforms: one sheet of hand-made paper per level, the dark squares
// a faint ink wash, bordered by a clean ink rule. The sheet is multiplied
// over what lies behind it, as ink and paper really combine: it can only
// darken, faintly, so a lacquer piece under three sheets is still black and
// a porcelain one still reads white, while the stack of sheets reads as
// paper against the paper sky.

export interface WashiPlatesProps {
  layout: BoardLayout;
  /** Multiply colour of the light squares (0–255 per channel; 255 is clear). */
  light?: number[];
  /** Multiply colour of the dark squares. */
  dark?: number[];
  edgeColor?: string;
  edgeOpacity?: number;
  edgeWidth?: number;
  thickness?: number;
  margin?: number;
}

/** A square frame of four bars, its top flush with the surface. */
const frameGeometry = (inner: number, width: number, height: number): BufferGeometry => {
  const outer = inner + width;
  const bars = [
    new BoxGeometry(outer * 2, height, width).translate(0, -height / 2, inner + width / 2),
    new BoxGeometry(outer * 2, height, width).translate(0, -height / 2, -inner - width / 2),
    new BoxGeometry(width, height, inner * 2).translate(inner + width / 2, -height / 2, 0),
    new BoxGeometry(width, height, inner * 2).translate(-inner - width / 2, -height / 2, 0),
  ];
  const merged = mergeGeometries(bars);
  bars.forEach((b) => b.dispose());
  return merged;
};

export const WashiPlates = ({
  layout,
  light = [249, 247, 242],
  dark = [233, 228, 219],
  edgeColor = '#2a2420',
  edgeOpacity = 0.6,
  edgeWidth = 0.03,
  thickness = 0.045,
  margin = 0.05,
}: WashiPlatesProps) => {
  const frame = towerFrame(layout);
  const side = frame.half + margin;
  const lightKey = light.join(',');
  const darkKey = dark.join(',');
  const surfaces = useMemo(
    () =>
      [false, true].map(
        (odd) =>
          new MeshBasicMaterial({
            map: washiTexture(odd, light, dark),
            blending: MultiplyBlending,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            toneMapped: false,
            fog: false,
          }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colours compared by value
    [lightKey, darkKey],
  );
  useEffect(
    () => () =>
      surfaces.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      }),
    [surfaces],
  );
  const edge = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(edgeColor),
        transparent: true,
        opacity: edgeOpacity,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [edgeColor, edgeOpacity],
  );
  useEffect(() => () => edge.dispose(), [edge]);
  const geometries = useMemo(
    () => ({
      surface: new PlaneGeometry(frame.half * 2, frame.half * 2),
      edge: frameGeometry(side, edgeWidth, thickness),
    }),
    [frame.half, side, edgeWidth, thickness],
  );
  useEffect(
    () => () => {
      geometries.surface.dispose();
      geometries.edge.dispose();
    },
    [geometries],
  );

  return (
    <group name="washi-plates">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={geometries.surface}
            // Squares take the Raumschach colouring (x + y + z): the checker flips per level
            material={surfaces[z % 2]}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={geometries.edge}
            material={edge}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};
