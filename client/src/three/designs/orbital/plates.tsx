import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import type { BoardLayout } from '../types';

// The decks: sheets of smoked glass in thin brushed-metal frames. The glass
// is nearly clear seen from above and catches a sheen at a slant, so pieces
// below stay in view while each deck still reads as a surface. Its squares
// are told apart three ways: the light squares are faintly frosted (in the
// Raumschach colouring, Aa1 dark), fine lines are etched between them, and a
// small dim docking light marks every inner corner, all in the deck's colour
// (kept well below the play lights, which are rings). Seen from straight
// above, every deck but the one in focus (or the top one) thins its grid to
// hairlines, so the nested decks never read as a plaid. The slim frame
// carries a strip light of that colour and a small clamp at each corner.

const MARGIN = 0.05;
const FRAME_WIDTH = 0.045;
const FRAME_DEPTH = 0.035;

const vertex = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vCell = (position.xy + uHalf) / uPitch;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragment = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uLight;
  uniform vec3 uGlass;
  uniform vec3 uSheen;
  uniform vec3 uFrost;
  uniform float uParity;
  uniform float uPitch;
  uniform float uLineOpacity;
  uniform float uDotOpacity;
  uniform float uGlassOpacity;
  uniform float uFocus;
  uniform float uKeep;
  varying vec2 vCell;
  varying vec3 vWorld;

  // Composites a layer over what is below (premultiplied)
  void over(inout vec4 acc, vec3 c, float a) {
    acc.rgb = c * a + acc.rgb * (1.0 - a);
    acc.a = a + acc.a * (1.0 - a);
  }

  void main() {
    vec2 c = vCell;
    float inside = step(0.0, c.x) * step(c.x, 5.0) * step(0.0, c.y) * step(c.y, 5.0);
    vec3 v = normalize(cameraPosition - vWorld);
    float slant = 1.0 - abs(v.y);
    float sheen = slant * slant * slant;

    // Seen from straight above, the five decks nest at five scales and their
    // grids would read as a plaid: every deck but the one in focus (or, with
    // none, the top one) thins to a quiet lattice of hairlines
    float steep = smoothstep(0.8, 0.95, abs(v.y)) * (1.0 - uKeep);

    // The glass: smoked, with a sheen at a slant; light squares frosted
    vec2 sq = floor(c);
    float lightSq = mod(sq.x + sq.y + uParity, 2.0) * inside;
    vec4 acc = vec4(0.0);
    over(acc, uGlass + uSheen * sheen, (uGlassOpacity + 0.3 * sheen) * inside);
    over(acc, uFrost, lightSq * (0.045 + 0.02 * uFocus) * (1.0 - 0.75 * steep));

    // Etched lines between the squares (not the border: the frame is there)
    vec4 d = vec4(dFdx(c), dFdy(c));
    vec2 deriv = max(vec2(length(d.xz), length(d.yw)), vec2(1e-6));
    vec2 target = vec2(0.011);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 g = 1.0 - abs(fract(c) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
    vec2 nearest = floor(c + 0.5);
    vec2 innerLine = step(0.5, nearest) * step(nearest, vec2(4.5));
    lines *= innerLine;
    float line = mix(lines.x, 1.0, lines.y) * inside;
    over(acc, uTint, line * uLineOpacity * (1.0 - 0.6 * steep));
    float dots = uDotOpacity * (1.0 - 0.9 * steep);

    // A docking light at every inner corner: a small bright core in a soft halo
    vec2 corner = clamp(floor(c + 0.5), vec2(1.0), vec2(4.0));
    float r = length(c - corner) * uPitch;
    float fw = max(fwidth(r), 1e-4);
    float core = 1.0 - smoothstep(0.012 - fw, 0.012 + fw, r);
    float halo = exp(-r * r / 0.0032) * 0.2;
    over(acc, uTint, halo * dots);
    over(acc, uLight, core * dots);

    if (acc.a < 0.003) discard;
    gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
    #include <colorspace_fragment>
  }`;

const cornerClamp = (half: number): BufferGeometry => {
  const s = half + MARGIN + FRAME_WIDTH / 2;
  const parts = [-1, 1].flatMap((x) =>
    [-1, 1].map((z) => new BoxGeometry(0.1, 0.05, 0.1).translate(x * s, -0.018, z * s)),
  );
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
};

const cornerLights = (half: number): BufferGeometry => {
  const s = half + MARGIN + FRAME_WIDTH / 2;
  const parts = [-1, 1].flatMap((x) =>
    [-1, 1].map((z) => new CylinderGeometry(0.022, 0.022, 0.01, 16).translate(x * s, 0.011, z * s)),
  );
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
};

/** Brushed dark aluminium: metal, but quieter than the strip light that carries the deck's colour. */
const frameMetal = new MeshStandardMaterial({
  color: '#5d6673',
  metalness: 0.85,
  roughness: 0.34,
});

export interface DecksProps {
  layout: BoardLayout;
  /** One colour per level, A to E. */
  colors: string[];
  focusLevel: number | null;
}

/** The five decks (see above). Decorative: nothing here takes a click. */
export const Decks = ({ layout, colors, focusLevel }: DecksProps) => {
  const frame = towerFrame(layout);
  const reach = frame.half + MARGIN;
  const geometries = useMemo(
    () => ({
      glass: new PlaneGeometry(reach * 2, reach * 2),
      frame: frameGeometry(reach, FRAME_WIDTH, FRAME_DEPTH),
      // The strip light, set into the frame's top along its inner edge
      strip: frameGeometry(reach + 0.012, 0.016, 0.004).translate(0, 0.0015, 0),
      clamps: cornerClamp(frame.half),
      lights: cornerLights(frame.half),
    }),
    [reach, frame.half],
  );
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);
  const colorKey = colors.join();
  const materials = useMemo(
    () =>
      colors.map((hex, z) => {
        const tint = new Color(hex);
        return {
          glass: new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            fog: false,
            uniforms: {
              uTint: { value: tint },
              uLight: { value: tint.clone().lerp(new Color('#ffffff'), 0.15) },
              uGlass: { value: new Color('#0d1624') },
              uSheen: { value: new Color('#5d7697') },
              uFrost: { value: new Color('#a9bdd6') },
              uParity: { value: z % 2 },
              uPitch: { value: frame.pitch },
              uHalf: { value: frame.half },
              uLineOpacity: { value: 0.3 },
              uDotOpacity: { value: 0.5 },
              uGlassOpacity: { value: 0.06 },
              uFocus: { value: 0 },
              uKeep: { value: z === colors.length - 1 ? 1 : 0 },
            },
            vertexShader: vertex,
            fragmentShader: fragment,
          }),
          strip: new MeshBasicMaterial({ color: tint.clone(), toneMapped: false }),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the colours by value (key)
    [colorKey, frame.pitch, frame.half],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.glass.dispose();
        m.strip.dispose();
      }),
    [materials],
  );
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        if (!m) return;
        const dim = 1 - any * 0.35 * (1 - w);
        const u = m.glass.uniforms;
        u.uFocus.value = w;
        // The deck that keeps its grid from above: the focused one, else the top
        u.uKeep.value = Math.min(1, w + (1 - any) * (z === weights.length - 1 ? 1 : 0));
        u.uLineOpacity.value = (0.3 + 0.25 * w) * dim;
        u.uDotOpacity.value = (0.5 + 0.3 * w) * dim;
        u.uGlassOpacity.value = 0.06 + 0.03 * w;
        m.strip.color.set(colors[z]).multiplyScalar((0.75 + 0.5 * w) * dim);
      });
    },
    { levels: frame.levelY.length, ms: 150, key: materials },
  );

  return (
    <group name="orbital-decks">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={geometries.glass}
            material={materials[z].glass}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh geometry={geometries.frame} material={frameMetal} raycast={noRaycast} />
          <mesh geometry={geometries.clamps} material={frameMetal} raycast={noRaycast} />
          <mesh geometry={geometries.strip} material={materials[z].strip} raycast={noRaycast} />
          <mesh geometry={geometries.lights} material={materials[z].strip} raycast={noRaycast} />
        </group>
      ))}
    </group>
  );
};
