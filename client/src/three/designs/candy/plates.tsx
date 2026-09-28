import { useEffect, useMemo, useRef } from 'react';
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
import type { Mesh } from 'three';
import { focusLevelOf, useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { SmartLabels } from '../kit/smartLabels';
import type { GridProps } from '../types';
import { frame, GLASS, INK, LEVEL_COLORS, SPARKLE } from './palette';

// Jelly platforms: one slab of clear sugar glass per level, rimmed with a
// glossy gummy rope in the level's candy colour (the same colour as its
// letter and as the band round the base of every piece standing on it).
//
// The glass multiplies what lies behind it, like real tinted glass, rather
// than laying a milky haze over it: a haze greys a navy piece four levels
// down, while multiplying keeps every contrast ratio behind the glass (dark
// stays dark, cream stays the lightest thing there). The checker is two
// tones of an almost clear tint (coloured by x + y + z), the dark
// one leaning toward the level's colour; three stacked plates darken what
// is under them by under 10%, so the stack stays clean from above. Level
// identity lives on the rims, the letters and the pieces' bands.
//
// The level the player is pointing at (or has a piece selected on) lifts
// its rim: fuller, brighter, a touch thicker, while the other rims fade back.

const MARGIN = 0.1;
const SIDE = frame.half + MARGIN;
/** How far each level's glass leans toward its colour (a faint, even tint). */
export const GLASS_TINT = 0.08;
/**
 * The dark squares pass this share of the light ones. Kept close to 1: seen
 * from above through three plates, the checker's swing compounds, and at
 * 0.965 it stays near 10% (0.965³ ≈ 0.9), so the stack never turns to mud.
 */
export const CHECKER = 0.965;

/** The glass's two multiply tones for a level, as sRGB factors (0–1). */
export const glassTones = (level: number) => {
  const light = new Color(GLASS.light)
    .lerp(new Color(LEVEL_COLORS[level]), GLASS_TINT)
    .convertLinearToSRGB();
  const dark = light.clone().multiplyScalar(CHECKER);
  return { light, dark };
};

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
  uniform float uHalf;
  uniform float uSide;
  uniform float uPitch;
  uniform float uLevel;
  uniform float uFocus;
  varying vec2 vP;
  void main() {
    vec2 cell = floor((vP + uHalf) / uPitch);
    float parity = mod(cell.x + cell.y + uLevel, 2.0);
    bool inside = all(lessThan(abs(vP), vec2(uHalf)));
    vec3 tint = inside ? (parity < 0.5 ? uDark : uLight) : uLight;
    // A slightly deeper tint along the slab's border: the jelly's thickness
    float edge = uSide - max(abs(vP.x), abs(vP.y));
    tint *= mix(0.965, 1.0, smoothstep(0.0, 0.2, edge));
    // The focused level's glass takes a little more of its colour
    tint = mix(tint, uDark * uDark, 0.35 * uFocus);
    gl_FragColor = vec4(tint, 1.0);
  }`;

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

const RIM_RADIUS = 0.032;
const FOCUS_RADIUS = 0.05;
const rimCurve = rimPath(SIDE + RIM_RADIUS * 0.4, 0.16);
const rimGeometry = new TubeGeometry(rimCurve, 128, RIM_RADIUS, 6, true);
const focusGeometry = new TubeGeometry(rimCurve, 128, FOCUS_RADIUS, 8, true);
const surfaceGeometry = new PlaneGeometry(SIDE * 2, SIDE * 2);

const RIM_OPACITY = 0.8;
/** The other rims keep this share of their opacity while one level is focused. */
const FOCUS_DIM = 0.45;

/** A glossy gummy rope, translucent, lit by the scene (and its reflections). */
const gummy = (color: string, opacity: number) =>
  new MeshStandardMaterial({
    color,
    roughness: 0.18,
    metalness: 0,
    emissive: color,
    emissiveIntensity: 0.3,
    envMapIntensity: 1.1,
    transparent: true,
    opacity,
    depthWrite: false,
  });

export const JellyPlates = ({ focusLevel = null }: { focusLevel?: number | null }) => {
  const materials = useMemo(
    () =>
      frame.levelY.map((_, z) => {
        const { light, dark } = glassTones(z);
        return {
          glass: new ShaderMaterial({
            vertexShader: glassVertex,
            fragmentShader: glassFragment,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            blending: CustomBlending,
            blendSrc: DstColorFactor,
            blendDst: ZeroFactor,
            uniforms: {
              // The framebuffer is sRGB and so is this shader's output
              uLight: { value: light },
              uDark: { value: dark },
              uHalf: { value: frame.half },
              uSide: { value: SIDE },
              uPitch: { value: frame.pitch },
              uLevel: { value: z },
              uFocus: { value: 0 },
            },
          }),
          rim: gummy(LEVEL_COLORS[z], RIM_OPACITY),
          focus: gummy(LEVEL_COLORS[z], 0),
        };
      }),
    [],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.glass.dispose();
        m.rim.dispose();
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
        m.glass.uniforms.uFocus.value = w;
        m.rim.opacity = RIM_OPACITY * (1 - any * (1 - FOCUS_DIM) * (1 - w));
        m.focus.opacity = w;
        m.focus.emissiveIntensity = 0.3 + 0.25 * w;
        const mesh = focusMeshes.current[z];
        if (mesh) mesh.visible = w > 0.002;
      });
    },
    { levels: frame.levelY.length, ms: 160, key: materials },
  );
  return (
    <group name="jelly-plates">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={surfaceGeometry}
            material={materials[z].glass}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.003, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={rimGeometry}
            material={materials[z].rim}
            position={[0, -RIM_RADIUS * 0.55, 0]}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
          <mesh
            ref={(m) => {
              focusMeshes.current[z] = m;
            }}
            geometry={focusGeometry}
            material={materials[z].focus}
            position={[0, -RIM_RADIUS * 0.55, 0]}
            renderOrder={LAYER.plateEdge}
            visible={false}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};

/** Platforms and coordinates. Decorative only: Board draws this outside the clickable group. */
export const Grid = ({ layout, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <JellyPlates focusLevel={focusLevel} />
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
        focusLevel={focusLevel}
        focusScale={1.25}
        focusDim={0.55}
      />
    </>
  );
};
