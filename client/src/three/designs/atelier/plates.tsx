import { useEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import type { Mesh } from 'three';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import type { BoardLayout } from '../types';
import { LEVELS, PAL } from './palette';

// Tinted acrylic platforms: one continuous slab per level.
//
// - The face is nearly clear frost. Its squares are a small frost difference,
//   coloured by x + y + z so a bishop keeps its colour between levels, and
//   filtered in the shader so they stay calm at grazing angles. Checker
//   contrast eases off as the view steepens, so stacked plates seen from
//   above never mosaic, and each level's frost is a step lighter than the one
//   below it.
// - A fresnel term makes the slab read as a surface from the low opening view
//   and clear from above, where the player looks down through it.
// - The level's tint lives where tinted acrylic really shows its colour: in
//   the edge. Each edge is a bright polished bevel, the tinted body of the
//   slab, and a dark hairline underneath, so an upper plate's front edge
//   cuts visibly across the pieces standing on the level below.
// - The focused level (the one under the pointer, or of the selected piece)
//   deepens and thickens its tinted edge and frosts a touch more, while the
//   other edges dim. It eases in over 150 ms, never pulses.
//
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
  /** The level to emphasise (`focusLevelOf(focus)`), or null. */
  focusLevel?: number | null;
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
  uniform float uValue;
  uniform float uOpacity;
  uniform float uFocus;
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
    // 0 on dark squares (x + y + z even, as Aa1), 1 on light
    float steep = smoothstep(0.32, 0.85, abs(v.y));
    float light = mix(0.5, checker(p), 1.0 - 0.65 * steep);
    // The margin past the outer squares is plain light frost
    vec2 q = abs(vWorld.xz);
    float inSquares = step(max(q.x, q.y), uHalf);
    light = mix(1.0, light, inSquares);
    vec3 col = mix(uDark, uLight, light) * uValue;
    float grazing = pow(1.0 - abs(v.y), 3.0);
    float a = uOpacity * (0.8 + 0.4 * light) * (1.0 + uFresnel * grazing) + uFocus;
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
  uniform vec3 uTint;
  uniform vec3 uUnder;
  uniform float uOpacity;
  varying vec3 vNormal0;
  varying float vDepth;
  void main() {
    vec3 col;
    float a;
    if (vNormal0.y > 0.5) {
      // The polished top bevel
      col = uTop;
      a = 0.92;
    } else if (vNormal0.y < -0.5) {
      col = uUnder;
      a = 0.7;
    } else {
      // The slab's face: bright at the bevel, the tint through its body,
      // darkening to a hairline at its base. The face is only a few pixels
      // tall, so these are smooth ramps: hard bands would stair-step.
      col = mix(uTop, uTint, smoothstep(0.05, 0.5, vDepth));
      col = mix(col, uUnder, smoothstep(0.5, 1.0, vDepth) * 0.85);
      a = 0.9;
    }
    gl_FragColor = vec4(col, a * uOpacity);
    #include <colorspace_fragment>
  }`;

// Each level's frost, a step lighter than the one below (A darkest)
const VALUE = [0.93, 0.95, 0.97, 0.985, 1];

export const AcrylicPlates = ({
  layout,
  opacity = 0.09,
  fresnel = 2.2,
  margin = 0.09,
  thickness = 0.055,
  edgeWidth = 0.024,
  focusLevel = null,
}: AcrylicPlatesProps) => {
  const frame = useMemo(() => towerFrame(layout), [layout]);
  const side = frame.half + margin;
  const { surface, edge, focusEdge } = useMemo(
    () => ({
      surface: new PlaneGeometry(side * 2, side * 2),
      edge: frameGeometry(side, edgeWidth, thickness),
      // The focused edge: a wider band of the level's tint, a little deeper
      focusEdge: frameGeometry(side - 0.005, 0.045, thickness * 1.3),
    }),
    [side, edgeWidth, thickness],
  );
  useEffect(
    () => () => {
      surface.dispose();
      edge.dispose();
      focusEdge.dispose();
    },
    [surface, edge, focusEdge],
  );
  const materials = useMemo(
    () =>
      frame.levelY.map((_, z) => ({
        surface: new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          uniforms: {
            uLight: { value: new Color(PAL.frostLight) },
            uDark: { value: new Color(PAL.frostDark) },
            uValue: { value: VALUE[z] ?? 1 },
            uOpacity: { value: opacity },
            uFocus: { value: 0 },
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
            uTint: { value: new Color(LEVELS[z]?.edge ?? '#ffffff') },
            uUnder: { value: new Color(PAL.edgeUnder) },
            uOpacity: { value: 1 },
            uThickness: { value: thickness },
          },
          vertexShader: edgeVertex,
          fragmentShader: edgeFragment,
        }),
        focus: new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: {
            uTop: { value: new Color(PAL.edgeTop) },
            uTint: { value: new Color(LEVELS[z]?.focus ?? '#888888') },
            uUnder: { value: new Color(PAL.edgeUnder) },
            uOpacity: { value: 0 },
            uThickness: { value: thickness * 1.3 },
          },
          vertexShader: edgeVertex,
          fragmentShader: edgeFragment,
        }),
      })),
    [frame, opacity, fresnel, thickness],
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
        m.surface.uniforms.uFocus.value = w * 0.04;
        // The focused level's own edge hands over to its focus edge
        m.edge.uniforms.uOpacity.value = (1 - any * 0.4 * (1 - w)) * (1 - w);
        m.focus.uniforms.uOpacity.value = w;
        const mesh = focusMeshes.current[z];
        if (mesh) mesh.visible = w > 0.002;
      });
    },
    { levels: frame.levelY.length, key: materials },
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
