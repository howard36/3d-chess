import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  Color,
  CurvePath,
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  LineCurve3,
  MeshStandardMaterial,
  PlaneGeometry,
  QuadraticBezierCurve3,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
  ZeroFactor,
} from 'three';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { SmartLabels } from '../kit/smartLabels';
import type { GridProps } from '../types';
import { publishSeat } from './pieces';
import { frame, GLASS, INK, LEVEL_COLORS, RIM, SPARKLE } from './palette';

// Jelly platforms: one slab of clear sugar glass per level, rimmed with a
// glossy gummy edge.
//
// The glass multiplies what lies behind it, like real tinted glass, rather
// than laying a milky haze over it: a haze of 12% per level greys a navy
// piece four levels down to a mid-tone, while multiplying keeps every
// contrast ratio behind the glass (dark stays dark, cream stays the lightest
// thing there), so pieces three or four levels down keep their colour and
// their edge. The checker is two tones of that tint (by x + y + z, as in
// Raumschach), a touch stronger toward the slab's border to give the jelly
// a thickness.

const MARGIN = 0.1;
const SIDE = frame.half + MARGIN;

const glassVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Written straight to the (sRGB) framebuffer as a multiply factor, so no
// colour-space conversion here.
const glassFragment = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uDark;
  uniform vec3 uBorder;
  uniform float uHalf;
  uniform float uSide;
  uniform float uPitch;
  uniform float uLevel;
  varying vec2 vP;
  void main() {
    vec2 cell = floor((vP + uHalf) / uPitch);
    float parity = mod(cell.x + cell.y + uLevel, 2.0);
    bool inside = all(lessThan(abs(vP), vec2(uHalf)));
    vec3 tint = inside ? (parity < 0.5 ? uDark : uLight) : uBorder;
    // A slightly deeper tint along the slab's border: the jelly's thickness
    float edge = uSide - max(abs(vP.x), abs(vP.y));
    tint *= mix(0.94, 1.0, smoothstep(0.0, 0.22, edge));
    gl_FragColor = vec4(tint, 1.0);
  }`;

/** The framebuffer is sRGB and so is this shader's output: keep the tints in sRGB. */
const srgb = (hex: string) => new Color(hex).convertLinearToSRGB();

/** The rounded-square path of a platform's rim, at height 0. */
const rimPath = (half: number, corner: number) => {
  const path = new CurvePath<Vector3>();
  const s = half - corner;
  const pts: [number, number][] = [
    [s, half],
    [-s, half],
    [-half, s],
    [-half, -s],
    [-s, -half],
    [s, -half],
    [half, -s],
    [half, s],
  ];
  const corners: [number, number][] = [
    [-half, half],
    [-half, -half],
    [half, -half],
    [half, half],
  ];
  for (let i = 0; i < 4; i++) {
    const [a, b] = [pts[i * 2], pts[i * 2 + 1]];
    const next = pts[(i * 2 + 2) % 8];
    path.add(new LineCurve3(new Vector3(a[0], 0, a[1]), new Vector3(b[0], 0, b[1])));
    path.add(
      new QuadraticBezierCurve3(
        new Vector3(b[0], 0, b[1]),
        new Vector3(corners[i][0], 0, corners[i][1]),
        new Vector3(next[0], 0, next[1]),
      ),
    );
  }
  return path;
};

const RIM_RADIUS = 0.03;
const rimGeometry = new TubeGeometry(
  rimPath(SIDE + RIM_RADIUS * 0.4, 0.16),
  128,
  RIM_RADIUS,
  6,
  true,
);
const surfaceGeometry = new PlaneGeometry(SIDE * 2, SIDE * 2);

/** A glossy gummy rope, translucent, lit by the scene (and its reflections). */
const rimMaterial = new MeshStandardMaterial({
  color: RIM,
  roughness: 0.16,
  metalness: 0,
  emissive: '#c9c3ff',
  emissiveIntensity: 0.22,
  envMapIntensity: 1.1,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
});

export const JellyPlates = () => {
  const materials = useMemo(
    () =>
      frame.levelY.map(
        (_, z) =>
          new ShaderMaterial({
            vertexShader: glassVertex,
            fragmentShader: glassFragment,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            blending: CustomBlending,
            blendSrc: DstColorFactor,
            blendDst: ZeroFactor,
            uniforms: {
              uLight: { value: srgb(GLASS.light) },
              uDark: { value: srgb(GLASS.dark) },
              uBorder: { value: srgb(GLASS.light) },
              uHalf: { value: frame.half },
              uSide: { value: SIDE },
              uPitch: { value: frame.pitch },
              uLevel: { value: z },
            },
          }),
      ),
    [],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <group name="jelly-plates">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={surfaceGeometry}
            material={materials[z]}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.003, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={rimGeometry}
            material={rimMaterial}
            position={[0, -RIM_RADIUS * 0.55, 0]}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};

/** Platforms and coordinates. Decorative only: Board draws this outside the clickable group. */
export const Grid = ({ layout, orientation }: GridProps) => {
  useLayoutEffect(() => publishSeat(orientation), [orientation]);
  return (
    <>
      <JellyPlates />
      <SmartLabels
        layout={layout}
        orientation={orientation}
        font='"Fredoka", "Trebuchet MS", sans-serif'
        weight={600}
        levelWeight={700}
        color={SPARKLE}
        outline={INK}
        outlineWidth={0.1}
        size={0.36}
        opacity={1}
        levelScale={1.5}
        levelColors={LEVEL_COLORS}
      />
    </>
  );
};
