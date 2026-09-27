import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
} from 'three';
import type { BufferGeometry, Mesh, Texture } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRID_SIZE } from '../../layout';
import { useLevelFocus } from './focus';
import { LAYER } from './layers';
import { towerFrame } from './layouts';
import { noRaycast } from './noRaycast';
import type { BoardLayout } from '../types';

// See-through platforms for a tower layout, one continuous slab per level,
// and the soft contact shadow that grounds a piece on its platform.

export interface LevelPlatesProps {
  layout: BoardLayout;
  /** The checker's two tones; the level's tint multiplies both. */
  light?: string;
  dark?: string;
  /** One tint per level, A (bottom) to E, to colour-code the levels. */
  tints?: string[];
  /** Opacity of the platform's surface: low, so pieces show through several. */
  opacity?: number;
  /** The perimeter edge: the only line drawn on a platform. */
  edgeColor?: string;
  /** One edge colour per level (overrides `edgeColor`). */
  edgeColors?: string[];
  edgeOpacity?: number;
  /** Width of the edge's top face (world units). */
  edgeWidth?: number;
  /** Height of the edge (the slab's thickness), seen from low angles. */
  thickness?: number;
  /** How far the platform reaches past its outer squares. */
  margin?: number;
  /**
   * The level to emphasise (usually `focusLevelOf(focus)` from GridProps):
   * its edge brightens and thickens and its surface lifts a little, while
   * the other levels' edges dim. Eased over `focusMs`; null or unset for none.
   */
  focusLevel?: number | null;
  /** Opacity of the focused level's edge. */
  focusEdgeOpacity?: number;
  /** Width of the focused level's edge (world units; the normal edge is `edgeWidth`). */
  focusEdgeWidth?: number;
  /** Colour of the focused edge (default: that level's edge colour). */
  focusColor?: string;
  /** Surface opacity added to the focused level. */
  focusFill?: number;
  /** The other levels' edges keep this share of their opacity while a level is focused. */
  focusDim?: number;
  /** Length of the ease when the focus moves. */
  focusMs?: number;
}

const checkerCache = new Map<string, Texture>();

/** A 5×5 checker (`dark` on a1), mipmapped so it stays calm at grazing angles. */
const checker = (light: string, dark: string): Texture => {
  const key = `${light}/${dark}`;
  const cached = checkerCache.get(key);
  if (cached) return cached;
  const size = 320;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const s = size / GRID_SIZE;
  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      // Canvas left to right is file a to e, bottom to top rank 1 to 5
      ctx.fillStyle = (i + j) % 2 === 0 ? dark : light;
      ctx.fillRect(i * s, size - (j + 1) * s, s, s);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  checkerCache.set(key, t);
  return t;
};

/**
 * A square frame of four bars around a platform of half side `inner`, `width`
 * wide and `height` deep, its top flush with the surface (y = 0).
 */
export const frameGeometry = (inner: number, width: number, height: number): BufferGeometry => {
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

/**
 * One continuous, low-opacity slab per level of a tower layout: a faint
 * two-tone checker and a crisp perimeter edge, and nothing else (no cell
 * lines). They write no depth and are drawn before every other see-through
 * layer (see LAYER), so pieces under one to four platforms stay visible and
 * keep their colour, while markers and labels are never tinted by them.
 *
 * Squares take the 3D chessboard's colouring, dark where x + y + z is even
 * (Aa1 is dark), so a bishop keeps to its colour; Black's view is the tower
 * walked around, so both players see the same colours on the same squares.
 */
export const LevelPlates = ({
  layout,
  light = '#ffffff',
  dark = '#b8c2d0',
  tints,
  opacity = 0.12,
  edgeColor = '#dfe7f2',
  edgeColors,
  edgeOpacity = 0.6,
  edgeWidth = 0.035,
  thickness = 0.05,
  margin = 0.06,
  focusLevel = null,
  focusEdgeOpacity = 1,
  focusEdgeWidth = 0.075,
  focusColor,
  focusFill = 0.05,
  focusDim = 0.55,
  focusMs = 150,
}: LevelPlatesProps) => {
  const frame = towerFrame(layout);
  const side = frame.half + margin;
  // Squares are coloured by x + y + z, as in Raumschach, so a bishop keeps
  // to one colour through the levels: the checker flips from level to level.
  const maps = useMemo(() => [checker(light, dark), checker(dark, light)], [light, dark]);
  const { surface, edge, focusEdge } = useMemo(
    () => ({
      // The checker covers the squares; the margin beyond them is left clear
      surface: new PlaneGeometry(frame.half * 2, frame.half * 2),
      edge: frameGeometry(side, edgeWidth, thickness),
      // The focused edge: wider, from the same inner line, a little deeper
      focusEdge: frameGeometry(side, focusEdgeWidth, thickness * 1.3),
    }),
    [frame.half, side, edgeWidth, focusEdgeWidth, thickness],
  );
  useEffect(
    () => () => {
      surface.dispose();
      edge.dispose();
      focusEdge.dispose();
    },
    [surface, edge, focusEdge],
  );
  // Colour arrays compared by value, so inline arrays do not rebuild materials
  const tintKey = JSON.stringify(tints ?? null);
  const edgeColorKey = JSON.stringify(edgeColors ?? null);
  const materials = useMemo(
    () =>
      frame.levelY.map((_, z) => ({
        surface: new MeshBasicMaterial({
          map: maps[z % 2],
          color: new Color(tints?.[z] ?? '#ffffff'),
          transparent: true,
          opacity,
          depthWrite: false,
          side: DoubleSide,
          toneMapped: false,
          fog: false,
        }),
        edge: new MeshBasicMaterial({
          color: new Color(edgeColors?.[z] ?? edgeColor),
          transparent: true,
          opacity: edgeOpacity,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
        focus: new MeshBasicMaterial({
          color: new Color(focusColor ?? edgeColors?.[z] ?? edgeColor),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the colour arrays by value (keys)
    [maps, tintKey, edgeColorKey, opacity, edgeColor, edgeOpacity, focusColor, frame.levelY.length],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.surface.dispose();
        m.edge.dispose();
        m.focus.dispose();
      }),
    [materials],
  );
  const focusMeshes = useRef<(Mesh | null)[]>([]);
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        if (!m) return;
        m.surface.opacity = opacity + w * focusFill;
        m.edge.opacity = edgeOpacity * (1 - any * (1 - focusDim) * (1 - w));
        m.focus.opacity = w * focusEdgeOpacity;
        const mesh = focusMeshes.current[z];
        if (mesh) mesh.visible = w > 0.002;
      });
    },
    { levels: frame.levelY.length, ms: focusMs, key: materials },
  );
  return (
    <group name="level-plates">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={surface}
            material={materials[z].surface}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={edge}
            material={materials[z].edge}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
          <mesh
            ref={(m) => {
              focusMeshes.current[z] = m;
            }}
            geometry={focusEdge}
            material={materials[z].focus}
            renderOrder={LAYER.plateEdge}
            visible={false}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};

const shadowTexture = (() => {
  let t: Texture | null = null;
  return () => {
    if (t) return t;
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Dense under the base, fading smoothly to nothing at the rim
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    t = new CanvasTexture(c);
    return t;
  };
})();

const shadowPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMaterials = new Map<string, MeshBasicMaterial>();

/**
 * A soft dark blob on the floor under a piece: cheap ambient occlusion that
 * makes it obvious which platform a piece stands on. Place it in a design's
 * PieceBody at the piece's base (the body's origin), so it moves, scales and
 * fades with the piece. Sizes are in piece units (the Staunton king's base
 * is 0.28 across its radius); the material is shared, so it is cloned by
 * anything that fades a piece (GhostPiece does).
 */
export const ContactShadow = ({
  radius = 0.4,
  opacity = 0.5,
  color = '#000000',
}: {
  radius?: number;
  opacity?: number;
  color?: string;
}) => {
  const key = `${color}/${opacity}`;
  let material = shadowMaterials.get(key);
  if (!material) {
    material = new MeshBasicMaterial({
      color,
      alphaMap: shadowTexture(),
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    shadowMaterials.set(key, material);
  }
  return (
    <mesh
      geometry={shadowPlane}
      material={material}
      position={[0, 0.004, 0]}
      scale={[radius * 2, 1, radius * 2]}
      renderOrder={LAYER.shadow}
      raycast={noRaycast}
    />
  );
};

const footprintMaterials = new Map<string, MeshBasicMaterial>();
const footprintRings = new Map<string, RingGeometry>();

/**
 * A thin ring on the floor round a piece's base, in its level's colour (pass
 * PieceBodyProps.level through the design's level colours), so which
 * platform a piece stands on reads from its footprint even where the rows of
 * two levels interleave on screen. Like ContactShadow, place it in the
 * design's PieceBody at the piece's base; sizes are in piece units.
 */
export const LevelFootprint = ({
  color,
  radius = 0.4,
  width = 0.05,
  opacity = 0.9,
}: {
  color: string;
  radius?: number;
  width?: number;
  opacity?: number;
}) => {
  const ringKey = `${radius}/${width}`;
  let ring = footprintRings.get(ringKey);
  if (!ring) {
    ring = new RingGeometry(radius - width, radius, 48).rotateX(-Math.PI / 2);
    footprintRings.set(ringKey, ring);
  }
  const key = `${color}/${opacity}`;
  let material = footprintMaterials.get(key);
  if (!material) {
    material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    footprintMaterials.set(key, material);
  }
  return (
    <mesh
      geometry={ring}
      material={material}
      position={[0, 0.006, 0]}
      renderOrder={LAYER.shadow}
      raycast={noRaycast}
    />
  );
};
