import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Color, DoubleSide, MeshBasicMaterial, PlaneGeometry, ShaderMaterial } from 'three';
import { GRID_SIZE } from '../../layout';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import { FRAME, LEVEL_COLORS, MARGIN } from './palette';
import { useEnvSetting } from './settings-env';

// The levels: five sheets of clear glass, each edged by one thin square of
// light in its level's colour. On the glass, the 3D chess checker (dark
// where x + y + z is even, so a bishop keeps to its colour through the
// levels): the light squares faintly frosted with the level's light, the
// dark squares left clear with a breath of smoke. Crisp hairlines of the
// level's colour divide the 25 squares, running whole from edge to edge and
// joined where they cross by taking the brighter of the two (never summed),
// so no crossing ever shows a dot. The checker holds from any side. Looking
// straight down, where the five would average into a grey plaid, the lead
// level (the one attended to, else the top one) keeps its checker whole and
// the others ease back part of the way, still clearly there, their inner
// hairlines thinner; each level's frost leans toward its own hue, so the
// nested checkers part by colour. The level the player is attending to
// (pointed at, or holding the selected piece) brightens its lines and edge;
// the others step back a little.

const vertexShader = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    // Squares from the board's corner: lines fall on whole numbers, 0 to 5
    vCell = (w.xz * vec2(1.0, -1.0) + uHalf) / uPitch;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uFrost;
  uniform vec3 uSmoke;
  uniform float uCells;
  uniform float uLevel;
  uniform float uReach;
  uniform float uFill;
  uniform float uFrostA;
  uniform float uSmokeA;
  uniform float uLine;
  uniform float uWidth;
  uniform float uFocus;
  uniform float uDim;
  uniform float uLead;
  varying vec2 vCell;
  varying vec3 vWorld;

  vec4 over(vec4 dst, vec3 c, float a) {
    return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
  }

  void main() {
    vec2 uv = vCell;
    vec3 v = normalize(cameraPosition - vWorld);
    // 1 looking straight down the stack, 0 from the side
    float above = smoothstep(0.8, 0.97, abs(v.y));
    float grazing = pow(1.0 - abs(v.y), 2.0);
    // The glass runs out under the edge's square of light, and so does the
    // checker: the outer squares reach the border whole, never stopping
    // short of it in a thin dark seam (the glass used to end at the outer
    // squares, a margin inside the edge)
    float inside = step(-uFill, uv.x) * step(uv.x, uCells + uFill)
      * step(-uFill, uv.y) * step(uv.y, uCells + uFill);

    // The checker: dark where x + y + z is even, as in 3D chess.
    // Every level keeps it from any side. Looking straight down all five
    // ease back a little (so pieces three levels down keep their own
    // colour), the lead level least, so one clear 5 x 5 reads through the
    // rest; each level's frost leans toward its own hue there
    vec2 sq = floor(clamp(uv, 0.0, uCells - 0.001));
    float light = mod(sq.x + sq.y + uLevel, 2.0);
    float back = above * (1.0 - uLead);
    float keep = (1.0 - mix(0.15, 0.3, back) * above) * mix(1.0, 0.5, back) * (1.0 + 0.35 * grazing);
    // The level attended to (pointed at, or holding the selection) a little more
    float focus = (1.0 + 0.25 * uFocus) * (1.0 - 0.15 * uDim);
    vec3 frost = mix(uFrost, uColor, 0.5 * above);
    vec4 c = vec4(0.0);
    c = over(c, uSmoke, (1.0 - light) * uSmokeA * inside * keep);
    c = over(c, frost, light * uFrostA * inside * keep * focus);

    // Hairlines between the squares, coverage-correct at any distance (Ben
    // Golus's pristine grid), running out to the edge of the light
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
    vec2 span = vec2(
      step(-uReach, uv.y) * step(uv.y, uCells + uReach),
      step(-uReach, uv.x) * step(uv.x, uCells + uReach)
    );
    lines *= innerLine * span;
    // The brighter of the two where they cross: an even line, never a dot
    float line = max(lines.x, lines.y) * uLine * (1.0 - 0.15 * above) * (1.0 - 0.5 * back);
    line *= (1.0 + 0.4 * uFocus) * (1.0 - 0.2 * uDim);
    c = over(c, uColor, min(line, 1.0));

    if (c.a < 0.002) discard;
    gl_FragColor = vec4(c.rgb / c.a, c.a);
    #include <colorspace_fragment>
  }`;

const WHITE = new Color('#ffffff');
const FROST = 0.12;
const SMOKE = 0.06;
const LINE = 0.5;
const EDGE = 0.8;
const EDGE_WIDTH = 0.022;
/** How far the glass runs in under the edge's light. */
const FILL = EDGE_WIDTH / 2;

/** The five levels (see above). Decorative: nothing here takes a click. */
export const Levels = ({ focusLevel }: { focusLevel: number | null }) => {
  const reach = FRAME.half + MARGIN;
  // The player's border width and brightness (settings-env.ts): the square
  // of light widens outward from the glass's edge, never into the squares
  const borderWidth = useEnvSetting<number>('env.borderWidth');
  const borderBright = useEnvSetting<number>('env.borderBrightness');
  const plane = useMemo(
    // Out to the middle of the edge's light, so no seam can open between them
    () => new PlaneGeometry((reach + FILL) * 2, (reach + FILL) * 2).rotateX(-Math.PI / 2),
    [reach],
  );
  const edge = useMemo(
    () => frameGeometry(reach, EDGE_WIDTH * borderWidth, 0.03),
    [reach, borderWidth],
  );
  useEffect(() => () => plane.dispose(), [plane]);
  useEffect(() => () => edge.dispose(), [edge]);
  const materials = useMemo(
    () =>
      LEVEL_COLORS.map((hex, z) => {
        const tint = new Color(hex);
        return {
          glass: new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: tint.clone() },
              // The frost: the level's light, mostly white
              uFrost: { value: tint.clone().lerp(new Color('#ffffff'), 0.55) },
              uSmoke: { value: new Color('#000000') },
              uCells: { value: GRID_SIZE },
              uLevel: { value: z },
              uReach: { value: MARGIN / FRAME.pitch },
              uFill: { value: (MARGIN + FILL) / FRAME.pitch },
              uFrostA: { value: FROST },
              uSmokeA: { value: SMOKE },
              uLine: { value: LINE },
              uWidth: { value: 0.011 },
              uFocus: { value: 0 },
              uDim: { value: 0 },
              uLead: { value: z === LEVEL_COLORS.length - 1 ? 1 : 0 },
              uHalf: { value: FRAME.half },
              uPitch: { value: FRAME.pitch },
            },
            vertexShader,
            fragmentShader,
          }),
          // The edge: one thin square of the level's light, lifted toward white
          edgeColor: tint.clone().lerp(new Color('#ffffff'), 0.3),
          edge: new MeshBasicMaterial({
            color: tint.clone().lerp(new Color('#ffffff'), 0.3),
            transparent: true,
            opacity: EDGE,
            depthWrite: false,
            toneMapped: false,
            fog: false,
          }),
        };
      }),
    [],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.glass.dispose();
        m.edge.dispose();
      }),
    [materials],
  );
  // The player's checker and line strengths (settings-env.ts)
  const checker = useEnvSetting<number>('env.checker');
  const lines = useEnvSetting<number>('env.gridLines');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    for (const m of materials) {
      m.glass.uniforms.uFrostA.value = FROST * checker;
      m.glass.uniforms.uSmokeA.value = SMOKE * checker;
      m.glass.uniforms.uLine.value = LINE * lines;
    }
    invalidate();
  }, [materials, checker, lines, invalidate]);
  // Each edge's light: its focus (below) times the player's brightness. Up to
  // full opacity the light is the edge's opacity; past it, its colour, which
  // keeps its hue at full strength and then pales a little toward white, so
  // a focused edge still stands out, in its own colour, at any brightness
  const edgeLight = useRef(LEVEL_COLORS.map(() => EDGE));
  const bright = useRef(borderBright);
  bright.current = borderBright;
  const applyEdge = (z: number) => {
    const m = materials[z];
    const light = edgeLight.current[z] * bright.current;
    m.edge.opacity = Math.min(light, 1);
    const c = m.edge.color.copy(m.edgeColor).multiplyScalar(Math.max(light, 1));
    const peak = Math.max(c.r, c.g, c.b);
    if (peak > 1) {
      c.multiplyScalar(1 / peak).lerp(WHITE, Math.min((peak - 1) * 0.35, 0.4));
    }
  };
  useEffect(() => {
    materials.forEach((_, z) => applyEdge(z));
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyEdge reads refs
  }, [materials, borderBright, invalidate]);
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        if (!m) return;
        const dim = any * (1 - w);
        m.glass.uniforms.uFocus.value = w;
        m.glass.uniforms.uDim.value = dim;
        // The lead from above: the level attended to, else the top one
        const top = z === weights.length - 1 ? 1 : 0;
        m.glass.uniforms.uLead.value = Math.min(1, w + (1 - any) * top);
        edgeLight.current[z] = EDGE * (1 - 0.35 * dim) + (1 - EDGE) * w;
        applyEdge(z);
      });
    },
    { ms: 160, key: materials },
  );

  return (
    <group name="monolith-levels">
      {FRAME.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={plane}
            material={materials[z].glass}
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
