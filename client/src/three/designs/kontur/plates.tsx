import { useEffect, useMemo } from 'react';
import {
  AddEquation,
  BoxGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
  SrcColorFactor,
  ZeroFactor,
} from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER } from '../kit/layers';
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
  varying float vY;
  varying float vUp;
  void main() {
    vY = position.y;
    vUp = normal.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const edgeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uInk;
  uniform float uThickness;
  uniform float uHairline;
  uniform float uOpacity;
  varying float vY;
  varying float vUp;
  void main() {
    // Top and bottom faces are ink; the cut face is the level's colour
    // between ink hairlines at its top and bottom
    float aa = max(fwidth(vY), 1e-4);
    float top = smoothstep(-uHairline - aa, -uHairline + aa, vY);
    float bottom = 1.0 - smoothstep(-uThickness + uHairline - aa, -uThickness + uHairline + aa, vY);
    float ink = max(max(top, bottom), step(0.5, abs(vUp)));
    gl_FragColor = vec4(mix(uColor, uInk, ink), uOpacity);
    #include <colorspace_fragment>
  }`;

/** A square frame of four bars around a platform, its top flush with the surface. */
const frameGeometry = (inner: number, width: number, height: number): BufferGeometry => {
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
}

export const AcrylicPlates = ({
  washes,
  edges,
  strength = 0.15,
  dark = 0.7,
  grazing = 0.8,
  thickness = 0.065,
  rim = 0.03,
  hairline = 0.014,
  margin = 0.05,
  edgeOpacity = 0.95,
}: AcrylicPlatesProps) => {
  const side = frame.half + margin;
  const { surface, edge } = useMemo(
    () => ({
      surface: new PlaneGeometry(side * 2, side * 2),
      edge: frameGeometry(side, rim, thickness),
    }),
    [side, rim, thickness],
  );
  useEffect(
    () => () => {
      surface.dispose();
      edge.dispose();
    },
    [surface, edge],
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
        edge: new ShaderMaterial({
          uniforms: {
            uColor: { value: new Color(edgeKey.split(',')[z]) },
            uInk: { value: new Color(INK) },
            uThickness: { value: thickness },
            uHairline: { value: hairline },
            uOpacity: { value: edgeOpacity },
          },
          vertexShader: edgeVertex,
          fragmentShader: edgeFragment,
          transparent: true,
          depthWrite: false,
        }),
      })),
    [washKey, edgeKey, strength, dark, grazing, thickness, hairline, edgeOpacity, squares],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.surface.dispose();
        m.edge.dispose();
      }),
    [materials],
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
        </group>
      ))}
    </group>
  );
};
