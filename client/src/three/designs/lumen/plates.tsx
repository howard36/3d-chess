import { useEffect, useMemo } from 'react';
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
// it. A faint veil of the level's colour, edge-lit like acrylic (brighter
// toward its rim), with the Raumschach checker only just showing through;
// crisp light threads between the 25 squares, each with a soft halo; and a
// small light node where the threads cross, like the snap points of a design
// tool. A thin 3D frame in the level's colour gives the pane its edge from
// low angles.
//
// Seen from high up, five stacked grids would nest into a plaid, so as the
// view steepens toward a bird's-eye view every level's threads but one's
// fade to quiet hairlines and their nodes go out. The one kept whole is the
// level the player is attending to (the hovered or selected level), else
// the top one: the board reads like a 2D board seen through glass.

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
  uniform vec3 uColor;
  uniform vec3 uThreadColor;
  uniform float uHalf;
  uniform float uPitch;
  uniform float uEdge;
  uniform float uCells;
  uniform float uLevel;
  uniform float uFill;
  uniform float uThread;
  uniform float uWidth;
  uniform float uFocus;
  uniform float uLead;
  uniform float uDim;
  uniform float uSteep;
  varying vec2 vP;
  varying vec3 vWorld;

  void main() {
    vec2 cell = (vP + uHalf) / uPitch;
    float onBoard = step(0.0, cell.x) * step(cell.x, uCells) * step(0.0, cell.y) * step(cell.y, uCells);

    // The veil: the checker only just shows (dark where x + y + z is even,
    // as in Raumschach), brighter toward the rim like edge-lit acrylic
    vec2 ci = floor(clamp(cell, 0.0, uCells - 0.001));
    float dark = 1.0 - mod(ci.x + ci.y + uLevel, 2.0);
    float rim = uEdge - max(abs(vP.x), abs(vP.y));
    float edgeLit = exp(-max(rim, 0.0) * 5.0);
    float fill = uFill * (0.7 + 0.6 * dark) * onBoard + edgeLit * 0.12;
    fill *= 1.0 + 0.25 * uFocus;

    // The threads between squares (not the border: the frame is the border),
    // coverage-correct at any distance (Ben Golus's pristine grid)
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
    vec2 inner = step(0.5, nearest) * step(nearest, vec2(uCells - 0.5));
    // A thread runs across the board only (x lines between y = 0 and 5)
    vec2 span = vec2(
      step(0.0, uv.y) * step(uv.y, uCells),
      step(0.0, uv.x) * step(uv.x, uCells)
    );
    lines *= inner * span;

    // Seen from above, the threads of every level but the attended one
    // fade to a whisper, and their nodes go out
    float reach = uSteep * (1.0 - uLead);
    float keepX = 1.0 - 0.62 * reach;
    float keepY = keepX;
    float thread = max(lines.x * keepX, lines.y * keepY);

    // A soft halo round each thread, so it reads as light rather than ink
    vec2 dist = g * 0.5 * uPitch;
    vec2 halo = exp(-(dist * dist) / (0.05 * 0.05)) * inner * span;
    float glow = max(halo.x * keepX, halo.y * keepY) * 0.11 * (1.0 - 0.75 * reach);
    // Wide halos alias into a haze far away; they fade with their footprint
    glow *= 1.0 - smoothstep(0.06, 0.2, max(deriv.x, deriv.y));

    // The nodes where threads cross, never thinner than about a pixel
    float r = 0.04;
    float nd = length(uv - nearest);
    float fw = max(fwidth(nd), 1e-5);
    float rr = max(r, fw * 0.9);
    float node = (1.0 - smoothstep(rr - fw, rr + fw, nd)) * (r / rr);
    node *= step(-0.5, nearest.x) * step(nearest.x, uCells + 0.5) * step(-0.5, nearest.y) * step(nearest.y, uCells + 0.5);
    node *= onBoard > 0.0 || nd < 0.2 ? 1.0 : 0.0;

    node *= 1.0 - reach;
    float lit = (thread + node * 0.55) * uThread * (1.0 + 0.7 * uFocus);
    float dim = 1.0 - uDim;
    float a = (fill + glow + lit) * dim;
    if (a < 0.003) discard;
    vec3 col = (uColor * (fill + glow) + uThreadColor * lit) * dim / max(a, 1e-4);
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const up = new Vector3();

export const HoloPanes = ({ focusLevel }: { focusLevel: number | null }) => {
  const edge = FRAME.half + MARGIN;
  const plane = useMemo(() => new PlaneGeometry(edge * 2, edge * 2), [edge]);
  const bars = useMemo(() => frameGeometry(edge, 0.028, 0.045), [edge]);
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
              uColor: { value: new Color(c) },
              // The threads: the level's colour, lifted toward white light
              uThreadColor: { value: new Color(c).lerp(new Color('#ffffff'), 0.3) },
              uHalf: { value: FRAME.half },
              uPitch: { value: FRAME.pitch },
              uEdge: { value: edge },
              uCells: { value: GRID_SIZE },
              uLevel: { value: z },
              uFill: { value: 0.045 },
              uThread: { value: 0.62 },
              uWidth: { value: 0.022 },
              uFocus: { value: 0 },
              // The level that keeps its grid whole from above: the focused
              // one, or the top one when nothing is focused
              uLead: { value: z === LEVEL_COLORS.length - 1 ? 1 : 0 },
              uDim: { value: 0 },
              uSteep: { value: 0 },
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
            opacity: 0.8,
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

  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        panes[z].uniforms.uFocus.value = w;
        panes[z].uniforms.uLead.value = w + (1 - any) * (z === weights.length - 1 ? 1 : 0);
        panes[z].uniforms.uDim.value = any * (1 - w) * 0.3;
        frames[z].opacity = 0.8 * (1 - any * (1 - w) * 0.4) + 0.2 * w;
      });
    },
    { key: panes },
  );

  // The threads draw back toward their nodes as the view looks down the stack
  useFrame(({ camera }) => {
    camera.getWorldDirection(up);
    const steep = Math.min(Math.max((-up.y - 0.8) / (0.985 - 0.8), 0), 1);
    const s = steep * steep * (3 - 2 * steep);
    for (const m of panes) m.uniforms.uSteep.value = s;
  });

  return (
    <group name="lumen-panes">
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
