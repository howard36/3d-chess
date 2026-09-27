import { useEffect, useMemo } from 'react';
import { BoxGeometry, Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRID_SIZE } from '../../layout';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import type { BoardLayout } from '../types';

// The platforms: shelves of museum glass in thin anodised-brass frames, one
// jewel colour per level, with a brass inlay line set between every square.
//
// - The squares alternate clear and acid-etched (frosted) glass, in the
//   Raumschach colouring (Aa1 clear, the dark square), so the checker is a
//   texture of the glass rather than a paint that tints what lies beneath.
// - The inlay lines are drawn after every sheet of glass, so the squares of
//   a level stay legible through the levels above it. Seen from high above,
//   where five grids would nest into a plaid, every grid goes quiet (or all
//   but the focused level's), and each piece outlines its own square.
// - Like real glass, a sheet reflects more of the room the lower you look
//   across it, and is almost invisible from straight above.
// - The level under the pointer (or of the selected piece) brightens its
//   frame and inlay; the others step back.

const glassVertex = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vCell = (position.xy + uHalf) / uPitch;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const glassFragment = /* glsl */ `
  uniform float uLevel;
  uniform float uFrost;
  uniform float uSheen;
  uniform float uFocus;
  uniform vec3 uTint;
  uniform float uDeep;
  varying vec2 vCell;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 cell = floor(vCell);
    bool inside = all(greaterThanEqual(vCell, vec2(0.0))) && all(lessThan(vCell, vec2(${GRID_SIZE}.0)));
    vec3 view = normalize(cameraPosition - vWorld);
    float grazing = 1.0 - abs(view.y);
    // Reflection of the room: stronger the lower the view
    // (only seen from above the sheet: from below it would veil the pieces on it)
    float sheen = uSheen * pow(grazing, 3.0) * smoothstep(-0.05, 0.05, cameraPosition.y - vWorld.y);
    float a = sheen;
    vec3 col = vec3(0.62, 0.68, 0.76) * 0.5;
    if (inside) {
      // Etched squares where x + y + z is odd (the light squares)
      float light = mod(cell.x + cell.y + uLevel, 2.0);
      // Acid-etched grain, finer than a pixel at a distance: it averages to a haze
      float grain = hash(floor(vCell * 90.0));
      float frost = light * uFrost * (0.8 + 0.4 * grain);
      // Etching is denser toward each square's edge, as a hand-finished panel is
      vec2 f = abs(fract(vCell) - 0.5);
      frost *= 0.85 + 0.35 * smoothstep(0.3, 0.5, max(f.x, f.y));
      frost *= 1.0 + uFocus * 0.5;
      // From high above, the deeper sheets' etching recedes with their inlay
      frost *= mix(1.0, uDeep, smoothstep(0.62, 0.97, view.y));
      vec3 frostCol = mix(vec3(0.86, 0.9, 0.95), uTint, 0.18);
      col = (col * a + frostCol * frost) / max(a + frost, 1e-4);
      a = a + frost - a * frost;
    }
    if (a < 0.002) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const inlayFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uWidth;
  uniform float uDeep;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vec2 uv = vCell;
    // The pristine grid (Ben Golus): coverage-correct lines at any scale
    vec4 d = vec4(dFdx(uv), dFdy(uv));
    vec2 deriv = max(vec2(length(d.xz), length(d.yw)), vec2(1e-6));
    vec2 target = vec2(uWidth);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 gd = abs(fract(uv) * 2.0 - 1.0);
    vec2 g = 1.0 - gd;
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
    // Only between squares: the frame is the border
    vec2 nearest = floor(uv + 0.5);
    vec2 innerLine = step(0.5, nearest) * step(nearest, vec2(${GRID_SIZE}.0 - 0.5));
    // Inside the platform only (the lines stop at the frame)
    vec2 span = step(vec2(0.0), uv) * step(uv, vec2(${GRID_SIZE}.0));
    lines *= innerLine * span.yx;
    float line = max(lines.x, lines.y);
    // A polished core: brass inlay catches a bright line along its middle
    vec2 core = smoothstep(draw * 0.55 + aa, draw * 0.55 - aa, g) * innerLine * span.yx;
    float shine = max(core.x, core.y);
    vec3 view = normalize(cameraPosition - vWorld);
    // Seen from high above, the deeper grids recede
    float steep = smoothstep(0.62, 0.97, view.y);
    float a = line * uOpacity * mix(1.0, uDeep, steep);
    if (a < 0.003) discard;
    vec3 col = mix(uColor, vec3(1.0), 0.28 * shine);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const frameVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

// Anodised metal: the top face lit, the sides in half shade, a sheen at
// grazing angles, and the level's colour glowing a little so it holds
const frameFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBright;
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vN);
    vec3 view = normalize(cameraPosition - vWorld);
    float top = clamp(n.y, 0.0, 1.0);
    float fres = pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 3.0);
    vec3 col = uColor * (0.5 + 0.5 * top) * uBright + vec3(0.9, 0.95, 1.0) * fres * 0.2;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

/**
 * The frame round a sheet of glass, with a clamp block at each corner where
 * the display's corner rods hold it (see stage.tsx).
 */
const frameWithClamps = (side: number) => {
  const bars = frameGeometry(side, 0.05, 0.055);
  const c = side + 0.025;
  const clamps = [
    [c, c],
    [-c, c],
    [c, -c],
    [-c, -c],
  ].map(([x, z]) => new BoxGeometry(0.12, 0.08, 0.12).translate(x, -0.03, z));
  const merged = mergeGeometries([bars, ...clamps]);
  bars.dispose();
  clamps.forEach((g) => g.dispose());
  return merged;
};

/** Where the corner rods stand, for a platform of half side `half` (the tower's frame). */
export const rodOffset = (half: number, margin = 0.07) => half + margin + 0.025;

/**
 * Share of every level's grid and etching left from straight above with
 * nothing focused: all alike and quiet, since favouring the top level's grid
 * put the lower levels' pieces (shifted inward by perspective) on its lines.
 * Each piece then shows its own square (pieces.tsx). A focused level keeps
 * its grid whole; the others thin further.
 */
const DEEP_QUIET = 0.3;
const DEEP_FOCUS_OTHERS = 0.2;

export interface GlassPlatesProps {
  layout: BoardLayout;
  colors: string[];
  focusLevel?: number | null;
  /** Opacity of the frosted squares. */
  frost?: number;
  /** Strength of the glass's reflection at grazing angles. */
  sheen?: number;
  /** Opacity of the inlay lines. */
  inlay?: number;
  /** Width of the inlay lines, as a fraction of a square. */
  inlayWidth?: number;
  /** How far the platform reaches past its outer squares. */
  margin?: number;
}

/** The glass shelves with their brass frames and inlays. */
export const GlassPlates = ({
  layout,
  colors,
  focusLevel = null,
  frost = 0.075,
  sheen = 0.22,
  inlay = 0.6,
  inlayWidth = 0.024,
  margin = 0.07,
}: GlassPlatesProps) => {
  const frame = towerFrame(layout);
  const side = frame.half + margin;
  const levels = frame.levelY.length;
  const { surface, bars } = useMemo(
    () => ({
      surface: new PlaneGeometry(side * 2, side * 2),
      bars: frameWithClamps(side),
    }),
    [side],
  );
  useEffect(
    () => () => {
      surface.dispose();
      bars.dispose();
    },
    [surface, bars],
  );
  const colorKey = colors.join();
  const materials = useMemo(
    () =>
      frame.levelY.map((_, z) => {
        const common = { uHalf: { value: frame.half }, uPitch: { value: frame.pitch } };
        return {
          glass: new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              ...common,
              uLevel: { value: z },
              uFrost: { value: frost },
              uSheen: { value: sheen },
              uFocus: { value: 0 },
              uTint: { value: new Color(colors[z]) },
              uDeep: { value: DEEP_QUIET },
            },
            vertexShader: glassVertex,
            fragmentShader: glassFragment,
          }),
          inlay: new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              ...common,
              uColor: { value: new Color(colors[z]) },
              uOpacity: { value: inlay },
              uWidth: { value: inlayWidth },
              // From straight above, the grids go quiet (see DEEP_QUIET)
              uDeep: { value: DEEP_QUIET },
            },
            vertexShader: glassVertex,
            fragmentShader: inlayFragment,
          }),
          frame: new ShaderMaterial({
            uniforms: { uColor: { value: new Color(colors[z]) }, uBright: { value: 0.72 } },
            vertexShader: frameVertex,
            fragmentShader: frameFragment,
          }),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colours by value (key)
    [colorKey, frost, sheen, inlay, inlayWidth, frame.half, frame.pitch, levels],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.glass.dispose();
        m.inlay.dispose();
        m.frame.dispose();
      }),
    [materials],
  );
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        if (!m) return;
        const rest = 1 - any * 0.42 * (1 - w);
        m.inlay.uniforms.uOpacity.value = inlay * rest + (1 - inlay * rest) * w * 0.9;
        m.inlay.uniforms.uWidth.value = inlayWidth * (1 + 0.35 * w);
        m.glass.uniforms.uFocus.value = w;
        // From high above, the grids thin toward the focused level (all alike
        // when none is), so five nested grids never read as a plaid
        const deep = w + (1 - w) * (DEEP_QUIET * (1 - any) + DEEP_FOCUS_OTHERS * any);
        m.inlay.uniforms.uDeep.value = deep;
        m.glass.uniforms.uDeep.value = deep;
        // Frames stay below the gameplay marks; the focused one steps up
        m.frame.uniforms.uBright.value = 0.72 * (1 - any * 0.3 * (1 - w)) + 0.55 * w;
      });
    },
    { levels, ms: 160, key: materials },
  );
  return (
    <group name="glass-plates">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={surface}
            material={materials[z].glass}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.003, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={surface}
            material={materials[z].inlay}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.002, 0]}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
          <mesh geometry={bars} material={materials[z].frame} raycast={noRaycast} />
        </group>
      ))}
    </group>
  );
};
