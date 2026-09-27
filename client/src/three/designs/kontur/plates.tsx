import { useEffect, useMemo, useRef } from 'react';
import {
  AddEquation,
  Color,
  CustomBlending,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
  SrcColorFactor,
  ZeroFactor,
} from 'three';
import type { Mesh } from 'three';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { frameGeometry } from '../kit/plates';
import { noRaycast } from '../kit/noRaycast';
import { frame } from './layout';
import { INK } from './palette';

// Coloured acrylic sheets, one continuous slab per level. Each is a filter:
// it multiplies whatever lies behind it by its colour, the way a gel or a
// sheet of tinted acrylic does, so it can only darken and tint, never fog.
// Because a filter scales a piece and the paper behind it alike, a piece
// seen through two or three sheets keeps its contrast with its
// surroundings, and a black piece stays black.
//
// The tint deepens where the sheet is seen edge-on (light crosses more of
// it), so from the low opening camera each level reads as a coloured band,
// while from above, looking down through the whole stack, every sheet
// thins out and the levels below stay clear. The squares are a faint
// two-tone checker in the same colour, coloured by x + y + z as in
// Raumschach, and the only line is the perimeter: a stripe of the level's
// own colour (acrylic glows at its cut edge) between two ink hairlines.

const surfaceVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const surfaceFragment = /* glsl */ `
  uniform vec3 uWash;
  uniform float uStrength;
  uniform float uDark;
  uniform float uParity;
  uniform float uGrazing;
  varying vec2 vUv;
  varying vec3 vWorld;

  // Box-filtered checker: stays calm at grazing angles (no shimmer)
  float checker(vec2 p) {
    vec2 w = max(fwidth(p), 1e-4);
    vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
    return 0.5 - 0.5 * i.x * i.y;
  }

  void main() {
    // uv (0,0) is file a, rank 1's corner; squares are dark where x + y + z is even
    float c = checker(vUv * 5.0);
    // c is 0 on squares where (file + rank) is even
    float dark = uParity > 0.5 ? 1.0 - c : c;
    vec3 v = normalize(cameraPosition - vWorld);
    // Path length through the sheet grows as it is seen edge-on
    float path = pow(1.0 / max(abs(v.y), 0.2), uGrazing);
    float s = clamp(uStrength * (1.0 + uDark * dark) * path, 0.0, 0.85);
    vec3 pass = mix(vec3(1.0), uWash, s);
    gl_FragColor = vec4(pass, 1.0);
    #include <colorspace_fragment>
  }`;

const edgeVertex = /* glsl */ `
  varying vec3 vP;
  varying float vUp;
  void main() {
    vP = position;
    vUp = normal.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const edgeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uInk;
  uniform float uThickness;
  uniform float uHairline;
  uniform float uOpacity;
  uniform float uInner;
  uniform float uWidth;
  uniform float uTopInk;
  varying vec3 vP;
  varying float vUp;
  void main() {
    // The cut face is the level's colour between ink hairlines at its top
    // and bottom. The top face is ink, or (the focused edge) the level's
    // colour between ink hairlines along its inner and outer borders.
    float aa = max(fwidth(vP.y), 1e-4);
    float top = smoothstep(-uHairline - aa, -uHairline + aa, vP.y);
    float bottom = 1.0 - smoothstep(-uThickness + uHairline - aa, -uThickness + uHairline + aa, vP.y);
    float across = max(abs(vP.x), abs(vP.z)) - uInner;
    float ab = max(fwidth(across), 1e-4);
    float rims = max(
      1.0 - smoothstep(uHairline - ab, uHairline + ab, across),
      smoothstep(uWidth - uHairline - ab, uWidth - uHairline + ab, across)
    );
    float face = step(0.5, abs(vUp));
    float ink = mix(max(top, bottom), max(uTopInk, rims), face);
    gl_FragColor = vec4(mix(uColor, uInk, ink), uOpacity);
    #include <colorspace_fragment>
  }`;

const edgeMaterial = (
  color: string,
  o: {
    thickness: number;
    hairline: number;
    opacity: number;
    inner: number;
    width: number;
    topInk: boolean;
  },
) =>
  new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uInk: { value: new Color(INK) },
      uThickness: { value: o.thickness },
      uHairline: { value: o.hairline },
      uOpacity: { value: o.opacity },
      uInner: { value: o.inner },
      uWidth: { value: o.width },
      uTopInk: { value: o.topInk ? 1 : 0 },
    },
    vertexShader: edgeVertex,
    fragmentShader: edgeFragment,
    transparent: true,
    depthWrite: false,
  });

export interface AcrylicPlatesProps {
  /** Pale filter colours, A to E: what each sheet passes at full strength. */
  washes: string[];
  /** Saturated colours of each sheet's cut edge, A to E. */
  edges: string[];
  /** How far a sheet seen face-on moves toward its wash (0 = clear). */
  strength?: number;
  /** Extra strength on the checker's dark squares, as a fraction. */
  dark?: number;
  /** How much a sheet seen edge-on deepens (0 = not at all, 1 = physically). */
  grazing?: number;
  /** Thickness of the slab (the height of its cut edge). */
  thickness?: number;
  /** Width of the edge's top face. */
  rim?: number;
  /** Ink hairlines along the top and bottom of the cut edge. */
  hairline?: number;
  /** How far the slab reaches past its outer squares. */
  margin?: number;
  edgeOpacity?: number;
  /**
   * The level to emphasise (focusLevelOf(GridProps.focus)): its edge becomes
   * a bold band of its colour, wider and deeper, and its fill deepens a
   * little, while the other levels' edges fade back. Eased over `focusMs`.
   */
  focusLevel?: number | null;
  /** Width of the focused edge's top face. */
  focusRim?: number;
  /** The other levels' edges keep this share of their opacity. */
  focusDim?: number;
  /** Extra fill strength on the focused level, as a fraction. */
  focusFill?: number;
  focusMs?: number;
}

export const AcrylicPlates = ({
  washes,
  edges,
  strength = 0.1,
  dark = 0.55,
  grazing = 0.8,
  thickness = 0.065,
  rim = 0.03,
  hairline = 0.014,
  margin = 0.05,
  edgeOpacity = 0.95,
  focusLevel = null,
  focusRim = 0.085,
  focusDim = 0.6,
  focusFill = 0.6,
  focusMs = 150,
}: AcrylicPlatesProps) => {
  const side = frame.half + margin;
  const { surface, edge, focusEdge } = useMemo(
    () => ({
      surface: new PlaneGeometry(side * 2, side * 2),
      edge: frameGeometry(side, rim, thickness),
      focusEdge: frameGeometry(side, focusRim, thickness * 1.5),
    }),
    [side, rim, focusRim, thickness],
  );
  useEffect(
    () => () => {
      surface.dispose();
      edge.dispose();
      focusEdge.dispose();
    },
    [surface, edge, focusEdge],
  );
  // The checker is laid on the squares only; uv 0..1 spans the margin too,
  // so the squares' uv is rescaled from the slab's
  const squares = frame.half / side;
  // Colour arrays compared by value, so an inline array does not rebuild
  const washKey = washes.join();
  const edgeKey = edges.join();
  const materials = useMemo(
    () =>
      frame.levelY.map((_, z) => ({
        surface: new ShaderMaterial({
          uniforms: {
            uWash: { value: new Color(washKey.split(',')[z]) },
            uStrength: { value: strength },
            uDark: { value: dark },
            // Aa1 is dark: the checker's first square on level z is dark when z is even
            uParity: { value: z % 2 === 0 ? 1 : 0 },
            uGrazing: { value: grazing },
          },
          vertexShader: surfaceVertex.replace(
            'vUv = uv;',
            `vUv = (uv - 0.5) / ${squares.toFixed(6)} + 0.5;`,
          ),
          fragmentShader: surfaceFragment,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          blending: CustomBlending,
          blendEquation: AddEquation,
          blendSrc: ZeroFactor,
          blendDst: SrcColorFactor,
        }),
        edge: edgeMaterial(edgeKey.split(',')[z], {
          thickness,
          hairline,
          opacity: edgeOpacity,
          inner: side,
          width: rim,
          topInk: true,
        }),
        focus: edgeMaterial(edgeKey.split(',')[z], {
          thickness: thickness * 1.5,
          hairline,
          opacity: 0,
          inner: side,
          width: focusRim,
          topInk: false,
        }),
      })),
    [
      washKey,
      edgeKey,
      strength,
      dark,
      grazing,
      thickness,
      hairline,
      edgeOpacity,
      squares,
      side,
      rim,
      focusRim,
    ],
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
        m.surface.uniforms.uStrength.value = strength * (1 + focusFill * w);
        m.edge.uniforms.uOpacity.value = edgeOpacity * (1 - any * (1 - focusDim) * (1 - w));
        m.focus.uniforms.uOpacity.value = w;
        const mesh = focusMeshes.current[z];
        if (mesh) mesh.visible = w > 0.002;
      });
    },
    { levels: frame.levelY.length, ms: focusMs, key: materials },
  );
  return (
    <group name="acrylic-plates">
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
