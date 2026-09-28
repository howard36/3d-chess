import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GRID_SIZE } from '../../layout';
import { hexToOklch } from '../kit/colors';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import { FRAME, LEVEL_COLORS, MARGIN } from './palette';

// The phosphor-glass panes. One quad per level whose shader draws the whole
// surface: a faintly smoked glass, its lit squares (the checker colouring by
// x + y + z, so a bishop keeps its colour through the levels) glowing in the
// level's colour, its dark squares smoked a little deeper, so each pane's own
// pattern leads over the panes seen through it; crisp hairlines between the
// 25 squares in the level's light, each with a soft halo, running out to the
// frame, and nothing at all where they cross (the two lines are joined by
// taking the brighter, never by adding, so no node or blob forms). A thin
// square of light in the level's colour frames the pane: the only border,
// drawn as real geometry so it holds from low angles.
//
// The checker is the board: it keeps its strength from every side, darker
// level colours lighting their squares a little more so every level reads
// alike. Looking straight down the stack, every level steps back gently and
// alike (the top one, nearest, a little less), so five nested grids read as
// one board seen through glass rather than a plaid, and the board looks the
// same whatever the player points at: the attended level's emphasis belongs
// to side views.

const vertexShader = /* glsl */ `
  varying vec2 vP;
  varying vec3 vWorld;
  void main() {
    vP = position.xy;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLineColor;
  uniform vec3 uGlass;
  uniform float uHalf;
  uniform float uPitch;
  uniform float uCells;
  uniform float uLevel;
  uniform float uLit;
  uniform float uDark;
  uniform float uSmoke;
  uniform float uLine;
  uniform float uWidth;
  uniform float uFocus;
  uniform float uDim;
  uniform float uSteep;
  uniform float uTop;
  uniform float uExt;
  varying vec2 vP;
  varying vec3 vWorld;

  // Premultiplied "over"
  void over(inout vec4 acc, vec3 c, float a) {
    acc.rgb = c * a + acc.rgb * (1.0 - a);
    acc.a = a + acc.a * (1.0 - a);
  }

  void main() {
    // Board coordinates: squares from the a1 corner, lines on whole numbers.
    // The quad's +y is the board's -z (rank 5 away from White).
    vec2 cell = vec2(vP.x + uHalf, vP.y + uHalf) / uPitch;
    float inside = step(0.0, cell.x) * step(cell.x, uCells) * step(0.0, cell.y) * step(cell.y, uCells);
    vec3 v = normalize(cameraPosition - vWorld);
    float slant = 1.0 - abs(v.y);

    // From above, every level steps back gently and alike (the top one, the
    // nearest, a little less), so the nested grids never plaid and the board
    // looks the same whatever the player points at. The attended level's
    // emphasis (a brighter checker, the others dimmed) belongs to side views
    // and fades out as the view looks down; only its lines stay a touch
    // brighter there.
    float keepFill = 1.0 - uSteep * mix(0.25, 0.0, uTop);
    float keepLine = 1.0 - uSteep * mix(0.2, 0.0, uTop);
    // Seen down through the stack, the smoked squares hold back a little
    // more of what lies below them (as glass does, the more it is looked
    // through): each pane's pattern then leads the ones under it, the upper
    // panes a little more (they lead where the five squares of a column line
    // up straight below the eye), by level alone, whatever the pointer does
    float smoke = uSmoke * (1.0 + uSteep * (0.9 + 0.8 * uLevel / 4.0));
    float side = 1.0 - uSteep;
    float dim = 1.0 - uDim * side;
    float dimLine = 1.0 - uDim * (1.0 - 0.5 * uSteep);
    float focusLine = 1.0 + 0.3 * uFocus * (1.0 - 0.5 * uSteep);

    vec4 acc = vec4(0.0);
    // Smoked glass, catching a faint sheen of its level toward grazing angles
    float sheen = slant * slant * slant;
    over(acc, uGlass + uColor * 0.25 * sheen, (0.05 + 0.16 * sheen) * inside);

    // The checker: dark squares where x + y + z is even (Aa1 dark). Lit
    // squares glow in the level's colour; dark ones are smoked, holding back
    // a little of what lies beyond them, so each pane's own pattern leads
    // over the panes seen through it
    vec2 ci = floor(clamp(cell, 0.0, uCells - 0.001));
    float lit = mod(ci.x + ci.y + uLevel, 2.0);
    over(acc, uGlass, smoke * (1.0 - lit) * inside);
    float lead = 1.0 + 0.25 * uSteep * uLevel / 4.0;
    float fill = mix(uDark, uLit * (1.0 + 0.25 * uFocus * side) * lead, lit) * keepFill * dim;
    over(acc, uColor, fill * inside);

    // Hairlines between the squares (not the border: the frame is the
    // border), coverage-correct at any distance (Ben Golus's pristine grid)
    vec2 uv = cell;
    vec4 dd = vec4(dFdx(uv), dFdy(uv));
    vec2 deriv = max(vec2(length(dd.xz), length(dd.yw)), vec2(1e-6));
    vec2 target = vec2(uWidth);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
    vec2 nearest = floor(uv + 0.5);
    vec2 innerLine = step(0.5, nearest) * step(nearest, vec2(uCells - 0.5));
    // Each line runs the full width of the board, out to the frame
    vec2 span = vec2(
      step(-uExt, uv.y) * step(uv.y, uCells + uExt),
      step(-uExt, uv.x) * step(uv.x, uCells + uExt)
    );
    lines *= innerLine * span;
    // Joined by the brighter of the two: a crossing is no brighter than a line
    float line = max(lines.x, lines.y);

    // A soft halo round each line, so it reads as light rather than ink; it
    // fades with its footprint far away, where it would alias into haze
    vec2 dist = g * 0.5 * uPitch;
    vec2 halo = exp(-(dist * dist) / (0.03 * 0.03)) * innerLine * span;
    float glow = max(halo.x, halo.y) * 0.1;
    glow *= 1.0 - smoothstep(0.05, 0.18, max(deriv.x, deriv.y));

    float lineA = line * uLine * focusLine * keepLine * dimLine;
    over(acc, uLineColor, glow * keepLine * dimLine);
    over(acc, uLineColor, min(lineA, 1.0));

    if (acc.a < 0.002) discard;
    gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
    #include <colorspace_fragment>
  }`;

const view = new Vector3();

/**
 * How far the view looks straight down the stack: 0 below about 53° of
 * elevation, 1 from about 72°. Ordinary high views keep their full checker.
 */
export const steepness = { value: 0 };
/** The top level: the nearest from above, it keeps a little more there. */
const TOP = LEVEL_COLORS.length - 1;

const FRAME_WIDTH = 0.024;
const FRAME_DEPTH = 0.032;
const FRAME_OPACITY = 0.9;

export const Panes = ({ focusLevel }: { focusLevel: number | null }) => {
  const edge = FRAME.half + MARGIN;
  const { plane, bars } = useMemo(
    () => ({
      // The glass reaches the frame; the checker and lines stop at the squares
      plane: new PlaneGeometry(edge * 2, edge * 2),
      bars: frameGeometry(edge, FRAME_WIDTH, FRAME_DEPTH),
    }),
    [edge],
  );
  useEffect(
    () => () => {
      plane.dispose();
      bars.dispose();
    },
    [plane, bars],
  );
  const panes = useMemo(
    () =>
      LEVEL_COLORS.map(
        (c, z) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: new Color(c) },
              // The lines: the level's colour, lifted toward white light
              uLineColor: { value: new Color(c).lerp(new Color('#ffffff'), 0.22) },
              uGlass: { value: new Color('#020806') },
              uHalf: { value: FRAME.half },
              uPitch: { value: FRAME.pitch },
              uCells: { value: GRID_SIZE },
              uLevel: { value: z },
              // Darker level colours light their squares a little more, so
              // every level's checker reads about as strongly
              uLit: { value: 0.085 * (0.85 / hexToOklch(c).l) ** 1.5 },
              uDark: { value: 0.012 },
              uSmoke: { value: 0.16 },
              uLine: { value: 0.62 },
              uWidth: { value: 0.013 },
              uFocus: { value: 0 },
              uDim: { value: 0 },
              uSteep: steepness,
              uTop: { value: z === TOP ? 1 : 0 },
              // The lines reach the frame's inner edge
              uExt: { value: MARGIN / FRAME.pitch },
            },
            vertexShader,
            fragmentShader,
          }),
      ),
    [],
  );
  const frames = useMemo(
    () =>
      LEVEL_COLORS.map(
        (c) =>
          new MeshBasicMaterial({
            color: new Color(c),
            transparent: true,
            opacity: FRAME_OPACITY,
            depthWrite: false,
            toneMapped: false,
            fog: false,
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      panes.forEach((m) => m.dispose());
      frames.forEach((m) => m.dispose());
    },
    [panes, frames],
  );

  // The frames by focus: the attended level's brightens, the others' step
  // back a little (less so from above, where the board should not change)
  const focusOf = useRef(LEVEL_COLORS.map(() => ({ w: 0, any: 0 })));
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        panes[z].uniforms.uFocus.value = w;
        panes[z].uniforms.uDim.value = any * (1 - w) * 0.22;
        focusOf.current[z] = { w, any };
        frames[z].color.set(LEVEL_COLORS[z]).multiplyScalar(1 + 0.25 * w);
      });
    },
    { key: panes },
  );

  // As the view looks down the stack, every level steps back a little
  useFrame(({ camera }) => {
    camera.getWorldDirection(view);
    const steep = Math.min(Math.max((-view.y - 0.8) / (0.95 - 0.8), 0), 1);
    const s = steep * steep * (3 - 2 * steep);
    steepness.value = s;
    frames.forEach((m, z) => {
      const { w, any } = focusOf.current[z];
      const focused = 1 - any * (1 - w) * 0.35 * (1 - 0.6 * s) + 0.1 * w;
      m.opacity = FRAME_OPACITY * focused * (1 - (z === TOP ? 0.05 : 0.15) * s);
    });
  });

  return (
    <group name="codex-panes">
      {FRAME.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={plane}
            material={panes[z]}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={bars}
            material={frames[z]}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};
