import { useEffect, useMemo, useRef } from 'react';
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
import { FRAME, LEVEL_COLORS, MARGIN } from './palette';

// The hard-light panes: one quad per level whose shader draws everything on
// it, and one thin square of light round it, in the level's colour.
//
// - The checker, Raumschach's (dark where x + y + z is even, so a bishop
//   keeps to its colour through the levels): the dark squares are smoked
//   glass with a trace of the level's colour, the light squares are frosted
//   with the level's light. Smoke darkens what lies behind, frost lightens
//   it, so the checker reads clearly through four panes without the stack
//   filling with light.
// - Crisp light threads between the 25 squares, each with a soft halo, and
//   nothing at their crossings: a crossing is just two threads, never
//   brighter than one. The frame is the border, so the threads stop at it.
//
// Looking straight down the stack, the five checkers nest at five scales:
// the level in play (the hovered or selected level, else the top one) keeps
// its full strength and draws the one crisp 5×5 grid; the others keep their
// checker as tone (a little quieter) while their threads and frames step
// well back, all alike, so no plaid forms. From the side, all five are equal.

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
  uniform vec3 uSmoke;
  uniform vec3 uFrost;
  uniform vec3 uThreadColor;
  uniform float uHalf;
  uniform float uEdge;
  uniform float uPitch;
  uniform float uCells;
  uniform float uLevel;
  uniform float uSmokeA;
  uniform float uFrostA;
  uniform float uThread;
  uniform float uWidth;
  uniform float uFocus;
  uniform float uKeep;
  uniform float uDim;
  uniform float uSteep;
  varying vec2 vP;
  varying vec3 vWorld;

  // Premultiplied "over"
  vec4 over(vec4 dst, vec3 c, float a) {
    return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
  }

  void main() {
    vec2 cell = (vP + uHalf) / uPitch;
    float onBoard = step(0.0, cell.x) * step(cell.x, uCells) * step(0.0, cell.y) * step(cell.y, uCells);
    // The pane itself runs out to its frame
    float onPane = step(max(abs(vP.x), abs(vP.y)), uEdge);
    vec3 view = normalize(cameraPosition - vWorld);
    // Glassy toward grazing, so a pane reads as a surface from low down
    float grazing = pow(1.0 - abs(view.y), 3.0);

    vec2 ci = floor(clamp(cell, 0.0, uCells - 0.001));
    float light = mod(ci.x + ci.y + uLevel, 2.0) * onBoard;
    float focus = 1.0 + 0.25 * uFocus;
    float dim = 1.0 - uDim;
    // Looking down the stack, the five checkers nest at five scales; the level
    // in play (the top one, with none) keeps its full strength, and the
    // others step back a little, every square still showing
    float back = 1.0 - 0.35 * uSteep * (1.0 - uKeep);

    // Smoked glass: a veil over the whole pane, deeper on the dark squares;
    // frost on the light squares
    vec4 c = vec4(0.0);
    c = over(c, uSmoke, (uSmokeA * (0.35 + 0.65 * (1.0 - light) * onBoard) + 0.1 * grazing) * onPane * dim * back);
    c = over(c, uFrost, uFrostA * light * focus * dim * back);

    // The threads between the squares, coverage-correct at any distance (Ben
    // Golus's pristine grid): never thinner than a pixel, fading instead
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
    // Inner lines only (the frame is the border), each across the whole board
    vec2 inner = step(0.5, nearest) * step(nearest, vec2(uCells - 0.5));
    vec2 span = vec2(step(0.0, uv.y) * step(uv.y, uCells), step(0.0, uv.x) * step(uv.x, uCells));
    lines *= inner * span;
    float thread = max(lines.x, lines.y);

    // A soft halo round each thread, so it reads as light rather than ink (a
    // max, so a crossing is no brighter than a thread)
    vec2 dist = g * 0.5 * uPitch;
    vec2 halo = exp(-(dist * dist) / (0.045 * 0.045)) * inner * span;
    float glow = max(halo.x, halo.y) * 0.1;
    // Wide halos alias into a haze far away; they fade with their footprint
    glow *= 1.0 - smoothstep(0.06, 0.2, max(deriv.x, deriv.y));

    // From above, every level but the one in play thins its threads a little
    float keep = 1.0 - 0.8 * uSteep * (1.0 - uKeep);
    float lit = (thread + glow) * uThread * keep * (1.0 + 0.3 * uFocus) * dim;
    c = over(c, uThreadColor, min(lit, 1.0));

    if (c.a < 0.003) discard;
    gl_FragColor = vec4(c.rgb / c.a, c.a);
    #include <colorspace_fragment>
  }`;

const up = new Vector3();

/**
 * How far the view looks straight down the stack (0 at 53° and below, 1 from
 * 76°), shared with the markers.
 */
export const steepness = { value: 0 };
/**
 * Per level, 1 for the level the player is attending to (the hovered or
 * selected level), eased; shared with the markers.
 */
export const leads = LEVEL_COLORS.map(() => ({ value: 0 }));

const WHITE = new Color('#ffffff');

export const HoloPanes = ({ focusLevel }: { focusLevel: number | null }) => {
  const edge = FRAME.half + MARGIN;
  const plane = useMemo(() => new PlaneGeometry(edge * 2, edge * 2), [edge]);
  // One square of light per level, just outside its outer squares
  const bars = useMemo(() => frameGeometry(edge, 0.03, 0.04), [edge]);
  useEffect(
    () => () => {
      plane.dispose();
      bars.dispose();
    },
    [plane, bars],
  );
  const panes = useMemo(
    () =>
      LEVEL_COLORS.map(
        (c, z) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              // Smoke: the level's colour, deep; frost: its light, pale
              uSmoke: { value: new Color(c).multiplyScalar(0.1) },
              uFrost: { value: new Color(c).lerp(WHITE, 0.35) },
              uThreadColor: { value: new Color(c).lerp(WHITE, 0.3) },
              uHalf: { value: FRAME.half },
              uEdge: { value: edge },
              uPitch: { value: FRAME.pitch },
              uCells: { value: GRID_SIZE },
              uLevel: { value: z },
              uSmokeA: { value: 0.24 },
              uFrostA: { value: 0.11 },
              uThread: { value: 0.62 },
              uWidth: { value: 0.02 },
              uFocus: leads[z],
              uKeep: { value: z === LEVEL_COLORS.length - 1 ? 1 : 0 },
              uDim: { value: 0 },
              uSteep: steepness,
            },
            vertexShader,
            fragmentShader,
          }),
      ),
    [edge],
  );
  const frames = useMemo(
    () =>
      LEVEL_COLORS.map(
        (c) =>
          new MeshBasicMaterial({
            color: new Color(c),
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            toneMapped: false,
            fog: false,
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      panes.forEach((m) => m.dispose());
      frames.forEach((m) => m.dispose());
    },
    [panes, frames],
  );

  // The attended level brightens its threads, frost and frame; the others
  // step back a little (never out of sight)
  const frameBase = useRef(LEVEL_COLORS.map(() => 0.85));
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        leads[z].value = w;
        // The level that keeps its whole strength from above: the one in
        // play, else the top
        panes[z].uniforms.uKeep.value = Math.min(
          1,
          w + (1 - any) * (z === weights.length - 1 ? 1 : 0),
        );
        panes[z].uniforms.uDim.value = any * (1 - w) * 0.18;
        frameBase.current[z] = 0.85 * (1 - any * (1 - w) * 0.25) + 0.15 * w;
      });
    },
    { key: panes },
  );

  useFrame(({ camera }) => {
    camera.getWorldDirection(up);
    const steep = Math.min(Math.max((-up.y - 0.8) / (0.97 - 0.8), 0), 1);
    const s = steep * steep * (3 - 2 * steep);
    steepness.value = s;
    // From above, the frames of the levels not in play step back too, so
    // five nested borders do not run through the back rank's pieces
    frames.forEach((m, z) => {
      m.opacity = frameBase.current[z] * (1 - 0.35 * s * (1 - panes[z].uniforms.uKeep.value));
    });
  });

  return (
    <group name="lumina-panes">
      {FRAME.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={plane}
            material={panes[z]}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.001, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={bars}
            material={frames[z]}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};
