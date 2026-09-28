import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, MeshStandardMaterial, PlaneGeometry, ShaderMaterial } from 'three';
import { GRID_SIZE } from '../../layout';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import type { BoardLayout } from '../types';
import { GLASS_DEEP, GLASS_PALE, GLEAM, LEAD, LEVEL } from './palette';
import { setFootprintStrength } from './pieces';

// The platforms: five panels of leaded glass. Each of a level's 25 squares
// is its own pane of antique glass, deep or pale in the level's jewel colour
// (the checker colouring, dark where x + y + z is even, so Aa1 is deep),
// each pane a little different from its neighbours as hand-blown glass is,
// shaded darker toward its lead and clearer at its heart. Thin cames of lead
// run between the panes, and each came carries a bright thread of light in
// the level's colour down its middle: the grid that names the squares. A
// heavier came frames the panel, and under it a solid lead rim, lit in the
// level's colour, shows the level's edge from low angles.
//
// Glass reflects more at a grazing angle than head-on, so the panes are
// clearest seen from above, where the lower levels must show through all
// the others. From high above, every level but the one in play (the one the
// player points at or holds a piece on) thins to a faint dot at each
// crossing of its cames, while the one in play thickens its glass into a
// clear light-and-dark checker, so the five nested grids never tangle into a
// plaid: the view reads like a 2D board on a glass table. With no level in
// play, each piece outlines its own square instead (see pieces.tsx).

const vertexShader = /* glsl */ `
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

const fragmentShader = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uPale;
  uniform vec3 uGleam;
  uniform vec3 uLead;
  uniform float uLevel;
  uniform float uGlass;
  uniform float uLeadAlpha;
  uniform float uGleamAlpha;
  uniform float uFocus;
  uniform float uQuiet;
  uniform float uAnchor;
  uniform float uCells;
  varying vec2 vCell;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  // Coverage of a line of half-width w at distance d (both in squares), a
  // pixel being px squares: never thinner than a pixel, fading instead, so
  // the cames stay crisp and free of moire at any distance
  float line(float d, float w, float px) {
    float wd = max(w, px * 0.6);
    float c = 1.0 - smoothstep(wd - px * 0.75, wd + px * 0.75, d);
    return c * min(w / wd, 1.0);
  }

  void main() {
    vec2 uv = vCell;
    vec2 px = max(vec2(length(vec2(dFdx(uv.x), dFdy(uv.x))), length(vec2(dFdx(uv.y), dFdy(uv.y)))), vec2(1e-5));
    float inside = step(0.0, uv.x) * step(uv.x, uCells) * step(0.0, uv.y) * step(uv.y, uCells);

    // --- The pane ---
    vec2 cell = floor(clamp(uv, 0.0, uCells - 0.001));
    vec2 f = uv - cell;
    float parity = mod(cell.x + cell.y + uLevel, 2.0);
    vec3 glass = mix(uDeep, uPale, parity);
    float seed = hash(cell + uLevel * 7.31);
    // Hand-blown glass: each pane its own shade, with faint streaks drawn
    // across it where the glass was stretched
    float streak = noise(vec2(uv.x * 1.7 + seed * 9.0, uv.y * 7.0 + seed * 3.0));
    glass *= 0.86 + 0.24 * seed + 0.16 * (streak - 0.5);
    // Clear at the heart, darker toward the lead
    vec2 e = min(f, 1.0 - f);
    float heart = smoothstep(0.0, 0.3, min(e.x, e.y));
    glass *= mix(0.5, 1.08, heart);
    vec3 view = normalize(cameraPosition - vWorld);
    float facing = abs(view.y);
    float fresnel = pow(1.0 - facing, 3.0);
    // From above, the level in play carries the checker like a 2D board: its
    // glass thickens and its pale panes (the light squares) come up to just
    // above the deep ones
    float paleA = mix(0.6, 1.1, uAnchor);
    float ga = uGlass * mix(0.55, 1.7, fresnel) * (1.0 + 0.45 * uFocus) * (parity < 0.5 ? 1.0 : paleA);
    ga *= mix(1.0, 2.4, uAnchor) * mix(1.0, 0.45, uQuiet) * inside;

    // --- The lead ---
    vec2 nearest = floor(uv + 0.5);
    vec2 d = abs(uv - nearest);
    vec2 border = step(nearest, vec2(0.5)) + step(vec2(uCells - 0.5), nearest);
    // Cames between panes, and a heavier one round the panel
    vec2 cameW = mix(vec2(0.034), vec2(0.06), border);
    vec2 threadW = mix(vec2(0.0085), vec2(0.016), border);
    // Only where a line lies along the panel (not past its ends)
    float alongX = step(-0.07, uv.y) * step(uv.y, uCells + 0.07);
    float alongY = step(-0.07, uv.x) * step(uv.x, uCells + 0.07);
    float came = max(line(d.x, cameW.x, px.x) * alongX, line(d.y, cameW.y, px.y) * alongY);
    float thread = max(line(d.x, threadW.x, px.x) * alongX, line(d.y, threadW.y, px.y) * alongY);
    float onBorder = max(border.x * line(d.x, cameW.x, px.x) * alongX, border.y * line(d.y, cameW.y, px.y) * alongY);
    // A quietened level keeps only a dot of lead where its cames cross, and
    // no thread of light: 36 faint dots, never lines, so nothing slices the
    // level in play
    float crossing = line(d.x, 0.07, px.x) * line(d.y, 0.07, px.y) * alongX * alongY;
    came = mix(came, crossing, uQuiet);
    thread *= 1.0 - uQuiet;

    float quiet = mix(1.0, 0.22, uQuiet);
    float leadA = uLeadAlpha * came * mix(1.0, 0.45, uQuiet);
    float gleamA = uGleamAlpha * thread * quiet * (1.0 + 0.55 * uFocus + 0.35 * onBorder);

    // Glass, then the lead over it, then the light on the lead
    vec3 col = glass;
    float a = ga;
    col = mix(col, uLead, came);
    a = max(a, leadA);
    vec3 gleam = uGleam * (1.0 + 0.35 * uFocus);
    col = mix(col, gleam, clamp(gleamA / max(a + gleamA, 1e-4) * 1.4, 0.0, 1.0) * thread);
    a = max(a, gleamA);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

export interface GlassPlatesProps {
  layout: BoardLayout;
  /** The level the player is attending to (focusLevelOf). */
  focusLevel?: number | null;
}

/** Glass opacity of a pane, head-on to grazing (before the Fresnel lift). */
const GLASS = 0.2;
const LEAD_ALPHA = 0.7;
const GLEAM_ALPHA = 0.55;
/** How far the panel's frame reaches past its outer squares. */
const MARGIN = 0.04;

const DEG = Math.PI / 180;
/** How much of a quietened level's rim glow goes. */
const RIM_QUIET = 0.85;
/** The rim's glow at rest and in focus. */
const RIM_GLOW = 0.16;
const RIM_FOCUS = 0.4;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * The five leaded-glass platforms. Decorative (never raycast), drawn in the
 * platforms' layer, before shadows, markers and labels.
 */
export const GlassPlates = ({ layout, focusLevel = null }: GlassPlatesProps) => {
  const frame = towerFrame(layout);
  const levels = frame.levelY.length;
  // A little past the squares, so the heavy outer came is drawn whole
  const reach = frame.half + frame.pitch * 0.12;
  const plane = useMemo(() => new PlaneGeometry(reach * 2, reach * 2), [reach]);
  const rim = useMemo(() => frameGeometry(frame.half + MARGIN, 0.03, 0.05), [frame.half]);
  useEffect(
    () => () => {
      plane.dispose();
      rim.dispose();
    },
    [plane, rim],
  );

  const materials = useMemo(
    () =>
      Array.from(
        { length: levels },
        (_, z) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uDeep: { value: new Color(GLASS_DEEP[z]) },
              uPale: { value: new Color(GLASS_PALE[z]) },
              uGleam: { value: new Color(GLEAM[z]) },
              uLead: { value: new Color(LEAD) },
              uLevel: { value: z },
              uGlass: { value: GLASS },
              uLeadAlpha: { value: LEAD_ALPHA },
              uGleamAlpha: { value: GLEAM_ALPHA },
              uFocus: { value: 0 },
              uQuiet: { value: 0 },
              uAnchor: { value: 0 },
              uCells: { value: GRID_SIZE },
              uHalf: { value: frame.half },
              uPitch: { value: frame.pitch },
            },
            vertexShader,
            fragmentShader,
          }),
      ),
    [frame.half, frame.pitch, levels],
  );
  // The rim: solid lead, faintly lit in the level's colour (a glow, never a neon tube)
  const rims = useMemo(
    () =>
      LEVEL.map(
        (c) =>
          new MeshStandardMaterial({
            color: LEAD,
            roughness: 0.38,
            metalness: 0.7,
            emissive: new Color(c),
            emissiveIntensity: RIM_GLOW,
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      materials.forEach((m) => m.dispose());
      rims.forEach((m) => m.dispose());
    },
    [materials, rims],
  );

  // Rim glow from focus, the eased focus itself, and how far each level is
  // quietened from above
  const glow = useRef<number[]>(Array.from({ length: levels }, () => RIM_GLOW));
  const quiet = useRef<number[]>(Array.from({ length: levels }, () => 0));
  const focus = useRef({ weights: Array.from({ length: levels }, () => 0), any: 0 });

  // The level in focus: its thread of light and its glass brighten, the
  // rim glows, and the other levels step back a little
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      focus.current = { weights: [...weights], any };
      weights.forEach((w, z) => {
        const m = materials[z];
        if (!m) return;
        m.uniforms.uFocus.value = w - any * 0.25 * (1 - w);
        glow.current[z] = RIM_GLOW + (RIM_FOCUS - RIM_GLOW) * w - 0.05 * any * (1 - w);
        rims[z].emissiveIntensity = glow.current[z] * (1 - RIM_QUIET * quiet.current[z]);
      });
    },
    { levels: frame.levelY.length, key: materials },
  );

  // From high above, five nested grids would read as a plaid: every level
  // but the one in play (pointed at, or holding the selected piece) thins to
  // a lattice of faint dots, its panes and rim fading back, while the one in
  // play carries a clear checker
  useFrame(({ camera }) => {
    const len = camera.position.length() || 1;
    const elevation = Math.asin(Math.min(Math.max(camera.position.y / len, -1), 1));
    // From about 32 degrees up: by 44 the lower levels no longer slice the top one
    const k = smooth(32 * DEG, 58 * DEG, elevation);
    const { weights } = focus.current;
    setFootprintStrength(smooth(55 * DEG, 75 * DEG, elevation));
    materials.forEach((m, z) => {
      // Only a level in play anchors: with none, every grid stays quiet
      // (defaulting to the top one would put lower pieces on its lines, seen
      // in perspective) and each piece shows its own square instead
      const anchor = weights[z] ?? 0;
      quiet.current[z] = k * (1 - anchor);
      m.uniforms.uQuiet.value = quiet.current[z];
      m.uniforms.uAnchor.value = k * anchor;
      rims[z].emissiveIntensity = glow.current[z] * (1 - RIM_QUIET * quiet.current[z]);
    });
  });

  return (
    <group name="glass-plates">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={plane}
            material={materials[z]}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh geometry={rim} material={rims[z]} raycast={noRaycast} />
        </group>
      ))}
    </group>
  );
};
