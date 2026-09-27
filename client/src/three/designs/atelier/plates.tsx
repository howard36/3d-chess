import { useEffect, useMemo } from 'react';
import { BoxGeometry, Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout } from '../types';
import { PAL } from './palette';

// Frosted acrylic platforms: one continuous slab per level. The squares are a
// frost difference (light squares a touch more frosted), coloured by
// x + y + z so a bishop keeps its colour between levels, and filtered in the
// shader so they stay calm at grazing angles. A fresnel term makes the slab
// read as a surface from the low opening view and clear from above, where
// the player looks down through it. The edge is a polished bevel: a bright
// hairline on top of a whisper of thickness that deepens toward its base.
// Everything is see-through, writes no depth, and draws in the kit's layer
// order, so platforms never hide or tint a marker.

export interface AcrylicPlatesProps {
  layout: BoardLayout;
  /** Surface opacity seen from straight above. */
  opacity?: number;
  /** Extra opacity at grazing angles (fraction of `opacity`). */
  fresnel?: number;
  /** How far the slab reaches past its outer squares. */
  margin?: number;
  thickness?: number;
  /** Width of the edge's top face. */
  edgeWidth?: number;
  /** One tint per level, A (bottom) to E, multiplied into the frost. */
  tints?: string[];
}

const plateVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const plateFragment = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uDark;
  uniform vec3 uTint;
  uniform float uOpacity;
  uniform float uFresnel;
  uniform float uHalf;
  uniform float uPitch;
  uniform float uParity;
  varying vec3 vWorld;

  // A box-filtered checker (after Inigo Quilez): exact at any distance and
  // angle, so the squares never shimmer or moire.
  float checker(vec2 p) {
    vec2 w = max(abs(dFdx(p)), abs(dFdy(p))) + 1e-4;
    vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
    return 0.5 - 0.5 * i.x * i.y;
  }

  void main() {
    // Squares in cell units: files along +x, ranks along -z
    vec2 p = vec2(vWorld.x + uHalf, -vWorld.z + uHalf) / uPitch + vec2(uParity, 0.0);
    vec3 v = normalize(cameraPosition - vWorld);
    // 0 on dark squares (x + y + z even, as Aa1), 1 on light. Looking down
    // through the stack the checkers of several platforms overlap, so their
    // contrast eases off as the view steepens; from the low opening view,
    // where the squares are read, it is full.
    float steep = smoothstep(0.32, 0.85, abs(v.y));
    float light = mix(0.5, checker(p), 1.0 - 0.6 * steep);
    // The margin past the outer squares is plain light frost
    vec2 q = abs(vWorld.xz);
    float inSquares = step(max(q.x, q.y), uHalf);
    light = mix(1.0, light, inSquares);
    vec3 col = mix(uDark, uLight, light) * uTint;
    float grazing = pow(1.0 - abs(v.y), 3.0);
    float a = uOpacity * (0.75 + 0.5 * light) * (1.0 + uFresnel * grazing);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const edgeVertex = /* glsl */ `
  varying vec3 vNormal0;
  varying float vDepth;
  uniform float uThickness;
  void main() {
    vNormal0 = normal;
    vDepth = clamp(-position.y / uThickness, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const edgeFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uSide;
  uniform vec3 uBottom;
  uniform float uOpacity;
  varying vec3 vNormal0;
  varying float vDepth;
  void main() {
    vec3 col;
    float a;
    if (vNormal0.y > 0.5) {
      // The polished top bevel
      col = uTop;
      a = 0.9;
    } else if (vNormal0.y < -0.5) {
      col = uBottom;
      a = 0.45;
    } else {
      // The slab's face: a bright bevel along its top, then the acrylic's
      // body, a translucent grey that gives the edge a crisp underline
      float bevel = 1.0 - smoothstep(0.18, 0.34, vDepth);
      col = mix(uBottom, uTop, bevel);
      col = mix(col, uSide, (1.0 - bevel) * (1.0 - vDepth) * 0.35);
      a = mix(0.5, 0.95, bevel);
    }
    gl_FragColor = vec4(col, a * uOpacity);
    #include <colorspace_fragment>
  }`;

/** A square frame of four bars, its top flush with y = 0. */
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

export const AcrylicPlates = ({
  layout,
  opacity = 0.1,
  fresnel = 2.2,
  margin = 0.09,
  thickness = 0.05,
  edgeWidth = 0.022,
  tints,
}: AcrylicPlatesProps) => {
  const frame = useMemo(() => towerFrame(layout), [layout]);
  const side = frame.half + margin;
  const { surface, edge } = useMemo(
    () => ({
      surface: new PlaneGeometry(side * 2, side * 2),
      edge: frameGeometry(side, edgeWidth, thickness),
    }),
    [side, edgeWidth, thickness],
  );
  useEffect(
    () => () => {
      surface.dispose();
      edge.dispose();
    },
    [surface, edge],
  );
  const tintKey = JSON.stringify(tints ?? null);
  const materials = useMemo(() => {
    const t = JSON.parse(tintKey) as string[] | null;
    return frame.levelY.map((_, z) => ({
      surface: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uLight: { value: new Color(PAL.frostLight) },
          uDark: { value: new Color(PAL.frostDark) },
          uTint: { value: new Color(t?.[z] ?? '#ffffff') },
          uOpacity: { value: opacity },
          uFresnel: { value: fresnel },
          uHalf: { value: frame.half },
          uPitch: { value: frame.pitch },
          // Dark squares where x + y + z is even: odd levels shift by one
          uParity: { value: z % 2 },
        },
        vertexShader: plateVertex,
        fragmentShader: plateFragment,
      }),
      edge: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTop: { value: new Color(PAL.edgeTop) },
          uSide: { value: new Color(PAL.edgeSide) },
          uBottom: { value: new Color(PAL.edgeBottom) },
          uOpacity: { value: 1 },
          uThickness: { value: thickness },
        },
        vertexShader: edgeVertex,
        fragmentShader: edgeFragment,
      }),
    }));
  }, [frame, tintKey, opacity, fresnel, thickness]);
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
