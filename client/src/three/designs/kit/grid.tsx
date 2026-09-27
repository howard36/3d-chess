import { useEffect, useMemo } from 'react';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { GRID_SIZE } from '../../layout';
import { useLevelFocus } from './focus';
import { LAYER } from './layers';
import { towerFrame } from './layouts';
import { noRaycast } from './noRaycast';
import type { BoardLayout } from '../types';

// Hairlines between the 25 squares of every level of a tower, so the squares
// can be told apart however faint the platform's checker is. Each level is
// one quad whose lines are drawn by the shader, antialiased from their own
// screen-space width: a line never gets thinner than about a pixel, and
// where it would, it fades instead, so the grid stays crisp and free of
// shimmer and moiré at any distance and at grazing angles.

export interface LevelGridProps {
  layout: BoardLayout;
  /** Line colour for every level. */
  color?: string;
  /** One line colour per level, A (bottom) to E (e.g. `levelRamp`); overrides `color`. */
  colors?: string[];
  opacity?: number;
  /** Line width, as a fraction of the square (a hairline by default). */
  width?: number;
  /** Also draw each level's outer border (LevelPlates already edges the platform). */
  border?: boolean;
  /**
   * Fade the lines out between these distances from the camera (world
   * units), so far levels stay quiet. Unset: no fade.
   */
  fade?: [number, number];
  /** Height of the lines above the platform surface. */
  lift?: number;
  /**
   * The level to emphasise (usually `focusLevelOf(focus)` from GridProps):
   * its lines rise to `focusOpacity` while the others dim to `focusDim` of
   * theirs, eased over `focusMs`. Null or unset for none.
   */
  focusLevel?: number | null;
  focusOpacity?: number;
  focusDim?: number;
  focusMs?: number;
}

const vertexShader = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    // Position in squares from the platform's corner: lines fall on whole numbers
    vCell = (position.xy + uHalf) / uPitch;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

// The "pristine grid" of Ben Golus: coverage-correct lines at any scale
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uWidth;
  uniform float uCells;
  uniform float uBorder;
  uniform vec2 uFade;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vec2 uv = vCell;
    vec4 d = vec4(dFdx(uv), dFdy(uv));
    vec2 deriv = max(vec2(length(d.xz), length(d.yw)), vec2(1e-6));
    vec2 target = vec2(uWidth);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
    // Only the lines between squares, unless the border is wanted too
    vec2 nearest = floor(uv + 0.5);
    vec2 inner = step(0.5, nearest) * step(nearest, vec2(uCells - 0.5));
    lines *= max(inner, vec2(uBorder));
    float a = mix(lines.x, 1.0, lines.y) * uOpacity;
    if (uFade.y > 0.0) {
      a *= 1.0 - smoothstep(uFade.x, uFade.y, distance(cameraPosition, vWorld));
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

/**
 * Thin lines between the squares of every level of a tower layout,
 * colour-coded per level if you like. Decorative (no raycasting), drawn
 * with the platform edges (LAYER.plateEdge): after the platforms, before
 * shadows, markers and the last-move line; pieces hide the lines behind them.
 */
export const LevelGrid = ({
  layout,
  color = '#dfe7f2',
  colors,
  opacity = 0.45,
  width = 0.02,
  border = false,
  fade,
  lift = 0.003,
  focusLevel = null,
  focusOpacity = 0.85,
  focusDim = 0.6,
  focusMs = 150,
}: LevelGridProps) => {
  const frame = towerFrame(layout);
  // A little past the platform, so a border line is drawn whole
  const reach = frame.half + frame.pitch * width;
  const plane = useMemo(() => new PlaneGeometry(reach * 2, reach * 2), [reach]);
  useEffect(() => () => plane.dispose(), [plane]);

  const colorKey = JSON.stringify(colors ?? null);
  const [fadeNear, fadeFar] = fade ?? [0, 0];
  const materials = useMemo(
    () =>
      frame.levelY.map(
        (_, z) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: new Color(colors?.[z] ?? color) },
              uOpacity: { value: opacity },
              uWidth: { value: width },
              uCells: { value: GRID_SIZE },
              uBorder: { value: border ? 1 : 0 },
              uFade: { value: [fadeNear, fadeFar] },
              uHalf: { value: frame.half },
              uPitch: { value: frame.pitch },
            },
            vertexShader,
            fragmentShader,
          }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the colour array by value (key)
    [
      colorKey,
      color,
      opacity,
      width,
      border,
      fadeNear,
      fadeFar,
      frame.half,
      frame.pitch,
      frame.levelY.length,
    ],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        if (!m) return;
        const base = opacity * (1 - any * (1 - focusDim) * (1 - w));
        m.uniforms.uOpacity.value = base + (focusOpacity - base) * w;
      });
    },
    { levels: frame.levelY.length, ms: focusMs, key: materials },
  );

  return (
    <group name="level-grid">
      {frame.levelY.map((y, z) => (
        <mesh
          key={z}
          geometry={plane}
          material={materials[z]}
          position={[0, y + lift, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={LAYER.plateEdge}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};
