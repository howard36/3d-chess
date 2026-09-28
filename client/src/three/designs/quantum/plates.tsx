import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, MeshBasicMaterial, PlaneGeometry, ShaderMaterial } from 'three';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import { FRAME } from './palette';

// The platforms: five thin sapphire wafers, each a quantum chip die. Fine
// circuit traces in the level's colour divide its 25 squares and run out to
// bond pads round the die's rim; a via pad sits on every crossing; the dark
// squares (by x + y + z, so a bishop keeps to its colour) are
// metallised a little in the level's colour. The sapphire itself is nearly
// clear seen from above and shows as glass toward grazing angles, so lower
// pieces stay visible through four wafers while every level still reads as
// a solid plate from the side. Looking straight down, where the five grids
// would nest into a plaid, the rim decoration goes and every level but the
// focused one (under the pointer or holding the selection) thins to a
// lattice of dots inside its border: the focused level reads as a clean 2D
// board, the others as quiet dot grids.

/** How far the die reaches past its outer squares (in pitches): room for the bond pads. */
export const DIE_MARGIN = 0.24;

const vertexShader = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    // Squares from the grid's corner: lines fall on whole numbers, 0 to 5
    vCell = (world.xz + uHalf) / uPitch;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSapphire;
  uniform float uLevel;
  uniform float uTrace;
  uniform float uFill;
  uniform float uGlass;
  uniform float uDark;
  uniform float uSteep;
  uniform float uLattice;
  varying vec2 vCell;
  varying vec3 vWorld;

  // Coverage of a line of half-width w at distance d, antialiased from its
  // own screen-space size (a thin line fades rather than aliasing)
  float hairline(float d, float w) {
    float aa = max(fwidth(d), 1e-5);
    float draw = max(w, aa * 0.75);
    return (1.0 - smoothstep(draw - aa, draw + aa, abs(d))) * clamp(w / draw, 0.0, 1.0);
  }
  float box(vec2 p, vec2 b) {
    vec2 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }
  float fillOf(float d) {
    float aa = max(fwidth(d), 1e-5);
    return 1.0 - smoothstep(-aa, aa, d);
  }
  // Premultiplied "over"
  vec4 over(vec4 dst, vec3 c, float a) {
    return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
  }

  void main() {
    vec2 uv = vCell;
    vec3 view = normalize(cameraPosition - vWorld);
    // Glassy toward grazing, but hardly from below: a piece seen up through
    // the wafer it stands on must not be veiled
    float grazing = pow(1.0 - abs(view.y), 2.5) * (view.y > 0.0 ? 1.0 : 0.25);
    float inside = step(0.0, uv.x) * step(uv.x, 5.0) * step(0.0, uv.y) * step(uv.y, 5.0);

    // Looking straight down through all five, every wash thins, so the
    // armies on the lowest levels keep their colour
    float thin = 1.0 - 0.65 * uSteep;
    // The sapphire: clear from above, glassy toward grazing
    float glass = (uFill + uGlass * grazing) * thin;
    vec4 c = vec4(uSapphire * glass, glass);

    // Dark squares metallised, a faint wash of the level's colour
    vec2 cell = floor(uv);
    float dark = inside * (1.0 - mod(cell.x + cell.y + uLevel, 2.0));
    c = over(c, uColor, dark * uDark * thin);

    // Traces between the squares, and the border round them. From above, a
    // level that is not in focus keeps only a trace of its inner lines: its
    // vias become a calm lattice of dots that still bounds the 25 squares
    vec2 nearest = floor(uv + 0.5);
    vec2 g = abs(uv - nearest);
    float onGrid = step(-0.02, nearest.x) * step(nearest.x, 5.02) * step(-0.02, nearest.y) * step(nearest.y, 5.02);
    float inX = step(-0.01, uv.y) * step(uv.y, 5.01);
    float inY = step(-0.01, uv.x) * step(uv.x, 5.01);
    vec2 edge = step(4.5, abs(nearest - 2.5) + 2.0);
    vec2 keep = mix(vec2(1.0 - 0.75 * uLattice), vec2(1.0), edge);
    float traces = max(hairline(g.x, 0.011) * inX * keep.x, hairline(g.y, 0.011) * inY * keep.y) * onGrid;
    c = over(c, uColor, traces * uTrace);

    // A via pad on every crossing: square on the die, a round dot from above
    float viaPad = fillOf(box(uv - nearest, vec2(0.035)) - 0.012);
    float viaDot = fillOf(length(uv - nearest) - 0.055);
    float via = mix(viaPad, viaDot, uSteep) * onGrid;
    // (from above, the deeper lattices step back so the five do not streak)
    float depth = 1.0 - uLattice * (4.0 - uLevel) * 0.2;
    c = over(c, mix(uColor, vec3(1.0), 0.25), min(via * uTrace * 1.1 * depth, 1.0));

    // Bond pads round the rim, where each trace runs out (not from above)
    float rim = 1.0 - uSteep;
    float pads = 0.0;
    for (int k = 1; k < 5; k++) {
      float t = float(k);
      pads = max(pads, fillOf(box(uv - vec2(t, -0.13), vec2(0.07, 0.06))));
      pads = max(pads, fillOf(box(uv - vec2(t, 5.13), vec2(0.07, 0.06))));
      pads = max(pads, fillOf(box(uv - vec2(-0.13, t), vec2(0.06, 0.07))));
      pads = max(pads, fillOf(box(uv - vec2(5.13, t), vec2(0.06, 0.07))));
    }
    // Corner alignment marks: small crosses
    vec2 corner = abs(uv - 2.5) - 2.5 - 0.13;
    float cross = max(hairline(corner.x, 0.012) * step(abs(corner.y), 0.07),
                      hairline(corner.y, 0.012) * step(abs(corner.x), 0.07));
    c = over(c, uColor, max(pads * 0.7, cross * 0.8) * uTrace * rim);

    if (c.a < 0.002) discard;
    gl_FragColor = vec4(c.rgb / c.a, c.a);
    #include <colorspace_fragment>
  }`;

export interface WafersProps {
  colors: string[];
  focusLevel: number | null;
}

/**
 * The five wafers: the traced surface of each, and its thin glass edge in
 * the level's colour. The focused level (pointed at, or holding the
 * selection) brightens its traces and edge; the others step back a little.
 */
export const Wafers = ({ colors, focusLevel }: WafersProps) => {
  const reach = FRAME.half + DIE_MARGIN * FRAME.pitch;
  const { plane, edge } = useMemo(
    () => ({
      plane: new PlaneGeometry(reach * 2, reach * 2).rotateX(-Math.PI / 2),
      edge: frameGeometry(reach, 0.014, 0.03),
    }),
    [reach],
  );
  useEffect(
    () => () => {
      plane.dispose();
      edge.dispose();
    },
    [plane, edge],
  );
  const colorKey = colors.join();
  const materials = useMemo(
    () =>
      FRAME.levelY.map((_, z) => ({
        surface: new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          uniforms: {
            uColor: { value: new Color(colors[z]) },
            uSapphire: { value: new Color('#1f56a3') },
            uLevel: { value: z },
            uTrace: { value: TRACE },
            uFill: { value: 0.032 },
            uGlass: { value: 0.13 },
            uDark: { value: 0.055 },
            uSteep: { value: 0 },
            uLattice: { value: 0 },
            uHalf: { value: FRAME.half },
            uPitch: { value: FRAME.pitch },
          },
          vertexShader,
          fragmentShader,
        }),
        edge: new MeshBasicMaterial({
          color: new Color(colors[z]),
          transparent: true,
          opacity: EDGE,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the colours by value (key)
    [colorKey],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.surface.dispose();
        m.edge.dispose();
      }),
    [materials],
  );

  const focusWeights = useRef<number[]>([]);
  const edgeBase = useRef<number[]>(FRAME.levelY.map(() => EDGE));
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      focusWeights.current = weights;
      weights.forEach((w, z) => {
        const m = materials[z];
        if (!m) return;
        const dim = 1 - any * 0.3 * (1 - w);
        m.surface.uniforms.uTrace.value = TRACE * dim + (FOCUS_TRACE - TRACE) * w;
        edgeBase.current[z] = EDGE * dim + (1 - EDGE) * w;
      });
    },
    { levels: FRAME.levelY.length, ms: 160, key: materials },
  );

  // Toward the top-down view (from about 60°) the five grids would nest into
  // a plaid: the rim decoration goes, and every level but the focused one
  // thins to its dot lattice
  useFrame(({ camera }) => {
    const elevation = Math.atan2(
      camera.position.y,
      Math.hypot(camera.position.x, camera.position.z),
    );
    const steep = smoothstep(52 * DEG, 68 * DEG, elevation);
    materials.forEach((m, z) => {
      m.surface.uniforms.uSteep.value = steep;
      const w = focusWeights.current[z] ?? 0;
      m.surface.uniforms.uLattice.value = steep * (1 - w);
      // The unfocused levels' edge frames step back too
      m.edge.opacity = edgeBase.current[z] * (1 - 0.6 * steep * (1 - w));
    });
  });

  return (
    <group name="wafers">
      {FRAME.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={plane}
            material={materials[z].surface}
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
        </group>
      ))}
    </group>
  );
};

const TRACE = 0.62;
const FOCUS_TRACE = 0.95;
const EDGE = 0.45;
const DEG = Math.PI / 180;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
