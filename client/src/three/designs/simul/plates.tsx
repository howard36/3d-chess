import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import { FRAME, LEVEL_COLORS, MARGIN, PALETTE } from './palette';

// The platforms: five tournament boards made of light. Each is a sheet of
// clear glass holding a maple-and-walnut checker, the light squares a warm
// ivory glow and the dark ones a translucent walnut that shades what lies
// behind, so the 5×5 reads as a real board from the side and from above
// alike (the checker colouring: dark where x + y + z is even, so a bishop
// keeps to its colour through the levels). Crisp threads of the level's
// colour run between the squares, complete from edge to edge and even where
// they cross (no nodes, no dots), and a single thin square of the same light
// borders the board. Toward grazing angles the glass catches a faint warm
// sheen, so each level still reads as a surface when seen almost edge on.
//
// The level the player is attending to (hovered, or holding the selected
// piece) brightens its threads and border a little; the others step back a
// little. Seen from straight above, every level keeps its whole checker and
// grid, only a shade quieter (the board in the lead, attended to or else the
// top one, keeps its threads whole; the others thin theirs), so the five
// boards nest like boards seen through glass rather than into a plaid.

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
  uniform vec3 uMaple;
  uniform vec3 uWalnut;
  uniform vec3 uSheen;
  uniform vec3 uLine;
  uniform float uHalf;
  uniform float uEdge;
  uniform float uPitch;
  uniform float uCells;
  uniform float uLevel;
  uniform float uMapleA;
  uniform float uWalnutA;
  uniform float uGlass;
  uniform float uLineA;
  uniform float uWidth;
  uniform float uFocus;
  uniform float uDim;
  uniform float uLead;
  uniform float uSteep;
  varying vec2 vP;
  varying vec3 vWorld;

  // Composites a layer over what is below (premultiplied)
  void over(inout vec4 acc, vec3 c, float a) {
    acc.rgb = c * a + acc.rgb * (1.0 - a);
    acc.a = a + acc.a * (1.0 - a);
  }

  void main() {
    vec2 cell = (vP + uHalf) / uPitch;
    float onBoard = step(0.0, cell.x) * step(cell.x, uCells) * step(0.0, cell.y) * step(cell.y, uCells);
    float onPlate = step(abs(vP.x), uEdge) * step(abs(vP.y), uEdge);
    vec3 v = normalize(cameraPosition - vWorld);
    float slant = 1.0 - abs(v.y);

    vec4 acc = vec4(0.0);
    // The glass: nearly clear, with a warm sheen toward grazing
    over(acc, uSheen, onPlate * (uGlass + 0.09 * slant * slant * slant));

    // Seen from straight above the five boards nest, each a little smaller
    // than the one over it: the lead board (the one attended to, else the
    // top one) keeps everything, the others keep their whole checker, a
    // shade quieter, and thin their threads, so the nest never turns into a
    // plaid
    float reach = uSteep * (1.0 - uLead);
    vec2 ci = floor(clamp(cell, 0.0, uCells - 0.001));
    float dark = 1.0 - mod(ci.x + ci.y + uLevel, 2.0);
    // Each light square glows a touch more toward its middle, like a
    // square of a board lit from beneath
    vec2 f = fract(cell) - 0.5;
    float lift = 1.0 - 0.18 * dot(f, f) * 4.0;
    float quiet = 1.0 - 0.08 * uSteep - 0.4 * reach;
    float dim = 1.0 - uDim;
    // Seen at a slant, light crosses more of the tinted glass: both woods
    // deepen, so a board seen almost edge on keeps its checker
    float thick = 1.0 + 1.0 * slant * slant;
    over(acc, uMaple, onBoard * (1.0 - dark) * uMapleA * lift * quiet * thick * (1.0 + 0.12 * uFocus) * dim);
    over(acc, uWalnut, onBoard * dark * uWalnutA * quiet * thick);

    // The threads between squares (not round the edge: the border is its
    // own square of light), coverage-correct at any distance (Ben Golus's
    // pristine grid), whole from edge to edge, and no brighter where they
    // cross
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
    vec2 inner = step(0.5, nearest) * step(nearest, vec2(uCells - 0.5));
    // A thread runs across the board only (x lines between y = 0 and 5)
    vec2 span = vec2(
      step(0.0, uv.y) * step(uv.y, uCells),
      step(0.0, uv.x) * step(uv.x, uCells)
    );
    lines *= inner * span;
    float thread = max(lines.x, lines.y);
    // A soft glow round each thread, so it reads as light rather than ink;
    // it fades out far away, where it would only haze
    vec2 dist = g * 0.5 * uPitch;
    vec2 halo = exp(-(dist * dist) / (0.035 * 0.035)) * inner * span;
    float glow = max(halo.x, halo.y) * 0.12 * (1.0 - smoothstep(0.05, 0.18, max(deriv.x, deriv.y)));
    float lineA = (thread + glow) * uLineA * (1.0 + 0.4 * uFocus) * (1.0 - 0.55 * reach) * dim;
    over(acc, uLine, min(lineA, 1.0));

    if (acc.a < 0.003) discard;
    gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
    #include <colorspace_fragment>
  }`;

const view = new Vector3();

/**
 * How far the view looks straight down the stack: 0 below about 53°, 1 from
 * about 76°. Shared with anything else that quietens from above.
 */
export const steepness = { value: 0 };

/**
 * The level of the held piece (engine z), or null: from above, the
 * destinations on other levels draw smaller, so a stack of them nests.
 */
export const held: { level: number | null } = { level: null };

/**
 * Set while a mate is on the board (by the Celebration): the mated king's
 * crown goes out as he topples.
 */
export const mate = { over: false };

/** The five platforms (see above). Decorative: nothing here takes a click. */
export const TournamentPlates = ({
  focusLevel,
  selectedLevel = null,
}: {
  focusLevel: number | null;
  /** The held piece's level (GridProps.focus.selected). */
  selectedLevel?: number | null;
}) => {
  useLayoutEffect(() => {
    held.level = selectedLevel;
  }, [selectedLevel]);
  const edge = FRAME.half + MARGIN;
  const { plane, bars } = useMemo(
    () => ({
      plane: new PlaneGeometry(edge * 2, edge * 2),
      // The border: one thin square of light, flush with the surface, deep
      // enough to read as an edge from low angles
      bars: frameGeometry(edge, 0.03, 0.04),
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
  const materials = useMemo(
    () =>
      LEVEL_COLORS.map((c, z) => ({
        surface: new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          uniforms: {
            uMaple: { value: new Color(PALETTE.maple) },
            uWalnut: { value: new Color(PALETTE.walnut) },
            uSheen: { value: new Color(PALETTE.sheen) },
            // The threads: the level's colour, lifted a little toward white
            uLine: { value: new Color(c).lerp(new Color('#ffffff'), 0.12) },
            uHalf: { value: FRAME.half },
            uEdge: { value: edge },
            uPitch: { value: FRAME.pitch },
            uCells: { value: GRID_SIZE },
            uLevel: { value: z },
            uMapleA: { value: 0.14 },
            uWalnutA: { value: 0.13 },
            uGlass: { value: 0.014 },
            uLineA: { value: 0.6 },
            uWidth: { value: 0.011 },
            uFocus: { value: 0 },
            uDim: { value: 0 },
            uLead: { value: z === LEVEL_COLORS.length - 1 ? 1 : 0 },
            uSteep: steepness,
          },
          vertexShader,
          fragmentShader,
        }),
        border: new MeshBasicMaterial({
          color: new Color(c),
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      })),
    [edge],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.surface.dispose();
        m.border.dispose();
      }),
    [materials],
  );

  // The focused level lifts, the others step back a little
  const borderColors = useRef(LEVEL_COLORS.map((c) => new Color(c)));
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        const dim = any * (1 - w);
        m.surface.uniforms.uFocus.value = w;
        m.surface.uniforms.uDim.value = dim * 0.28;
        // The lead board from above: the attended one, else the top one
        m.surface.uniforms.uLead.value = Math.min(
          1,
          w + (1 - any) * (z === weights.length - 1 ? 1 : 0),
        );
        m.border.color.copy(borderColors.current[z]).multiplyScalar(0.92 + 0.25 * w - 0.25 * dim);
      });
    },
    { key: materials },
  );

  useFrame(({ camera }) => {
    camera.getWorldDirection(view);
    const s = Math.min(Math.max((-view.y - 0.8) / (0.97 - 0.8), 0), 1);
    steepness.value = s * s * (3 - 2 * s);
  });

  return (
    <group name="simul-plates">
      {FRAME.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={plane}
            material={materials[z].surface}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={bars}
            material={materials[z].border}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};
