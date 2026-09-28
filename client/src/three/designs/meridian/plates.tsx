import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRID_SIZE } from '../../layout';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import { FRAME, LEVEL_COLORS, MARGIN } from './palette';

// The observing decks: five sheets of smoked glass, one per level, each drawn
// by one quad whose shader paints everything on it.
//
// - The checker, after Orbital's: the light squares of the Raumschach
//   colouring (dark where x + y + z is even, so Aa1 is dark and a bishop keeps
//   to its colour through the levels) are frosted with a pale starlight veil,
//   the dark ones left as clear smoked glass. It reads through all five decks.
// - Hairlines between the 25 squares in the level's colour, complete and
//   crisp at any distance (Ben Golus's pristine grid), with nothing at their
//   crossings.
// - The border is not drawn here: it is the thin frame of the level's light
//   round the deck, one square of light with a small meridian tick at the
//   middle of each side, pointing out to the horizon like the graduation of
//   an instrument.
//
// Seen from straight above, the five decks nest at five scales, and their
// checkers, of alternating parity, would blur into a plaid. As on Orbital's
// decks, the deck in play (the focused deck, else the top one) keeps its
// whole checker, a little stronger; every other keeps its lines and a trace
// of its frost, so each level's 25 squares still read and the board reads as
// one clear 5×5.

const vertex = /* glsl */ `
  varying vec2 vP;
  varying vec3 vWorld;
  void main() {
    vP = position.xy;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragment = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uFrost;
  uniform vec3 uGlass;
  uniform vec3 uSheen;
  uniform float uLevel;
  uniform float uHalf;
  uniform float uPitch;
  uniform float uCells;
  uniform float uReach;
  uniform float uFrostA;
  uniform float uGlassA;
  uniform float uLine;
  uniform float uWidth;
  uniform float uFocus;
  uniform float uDim;
  uniform float uKeep;
  varying vec2 vP;
  varying vec3 vWorld;

  // Composites a layer over what is below (premultiplied)
  void over(inout vec4 acc, vec3 c, float a) {
    acc.rgb = c * a + acc.rgb * (1.0 - a);
    acc.a = a + acc.a * (1.0 - a);
  }

  void main() {
    vec2 c = (vP + uHalf) / uPitch;
    // The deck runs out to its frame: the outer squares, their frost and the
    // lines between them all meet the frame, so it is the only border
    float inside = step(-uReach, c.x) * step(c.x, uCells + uReach)
      * step(-uReach, c.y) * step(c.y, uCells + uReach);
    vec3 v = normalize(cameraPosition - vWorld);
    float slant = 1.0 - abs(v.y);
    // From straight above, the deck in play leads: it carries its checker a
    // little more strongly, and every other deck's steps back
    float top = smoothstep(0.6, 0.93, abs(v.y));
    float above = top * (1.0 - uKeep);

    // Smoked glass, catching a sheen at a slant
    vec4 acc = vec4(0.0);
    float sheen = slant * slant * slant;
    over(acc, uGlass + uSheen * sheen, (uGlassA + 0.22 * sheen) * inside);

    // The light squares, frosted
    vec2 sq = floor(clamp(c, 0.0, uCells - 0.001));
    float lightSq = mod(sq.x + sq.y + uLevel, 2.0) * inside;
    float frost = uFrostA * (1.0 + 0.3 * uFocus) * (1.0 - 0.8 * above) * (1.0 + 0.25 * top * uKeep);
    over(acc, uFrost, lightSq * frost);

    // Hairlines between the squares (the frame is the border)
    vec4 d = vec4(dFdx(c), dFdy(c));
    vec2 deriv = max(vec2(length(d.xz), length(d.yw)), vec2(1e-6));
    vec2 target = vec2(uWidth);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 g = 1.0 - abs(fract(c) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
    vec2 nearest = floor(c + 0.5);
    vec2 innerLine = step(0.5, nearest) * step(nearest, vec2(uCells - 0.5));
    // A line runs the whole width of the deck and no further
    vec2 span = vec2(
      step(-uReach, c.y) * step(c.y, uCells + uReach),
      step(-uReach, c.x) * step(c.x, uCells + uReach)
    );
    lines *= innerLine * span;
    // One coverage where lines cross, so a crossing is never brighter than a line
    float line = max(lines.x, lines.y);
    // A breath of light round each line, so it reads as a thread of light
    // rather than ink (the larger of the two, so no glow gathers at a
    // crossing), gone where lines crowd into haze far away
    vec2 dist = g * 0.5 * uPitch;
    vec2 halo = exp(-(dist * dist) / (0.045 * 0.045)) * innerLine * span;
    float glow = max(halo.x, halo.y) * 0.07 * (1.0 - smoothstep(0.06, 0.2, max(deriv.x, deriv.y)));
    over(acc, uTint, glow * (1.0 + 0.5 * uFocus) * (1.0 - 0.6 * above));
    over(acc, uTint, line * uLine * (1.0 + 0.5 * uFocus) * (1.0 - 0.35 * above));

    acc *= 1.0 - uDim;
    if (acc.a < 0.003) discard;
    gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
    #include <colorspace_fragment>
  }`;

/** A small tick at the middle of each side of the frame, pointing outward. */
const ticksGeometry = (side: number, width: number, height: number): BufferGeometry => {
  const reach = 0.1;
  const thin = 0.016;
  const out = side + width + reach / 2;
  const parts = [
    new BoxGeometry(thin, height, reach).translate(0, -height / 2, out),
    new BoxGeometry(thin, height, reach).translate(0, -height / 2, -out),
    new BoxGeometry(reach, height, thin).translate(out, -height / 2, 0),
    new BoxGeometry(reach, height, thin).translate(-out, -height / 2, 0),
  ];
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
};

const FRAME_WIDTH = 0.03;
const FRAME_DEPTH = 0.04;
const FRAME_OPACITY = 0.8;

const view = new Vector3();

/** The five decks (see above). Decorative: nothing here takes a click. */
export const Decks = ({ focusLevel }: { focusLevel: number | null }) => {
  const side = FRAME.half + MARGIN;
  const geometries = useMemo(
    () => ({
      glass: new PlaneGeometry(side * 2, side * 2),
      border: frameGeometry(side, FRAME_WIDTH, FRAME_DEPTH),
      ticks: ticksGeometry(side, FRAME_WIDTH, FRAME_DEPTH * 0.6),
    }),
    [side],
  );
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);

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
              uTint: { value: tint },
              uFrost: { value: new Color('#c6d3ec').lerp(tint, 0.22) },
              uGlass: { value: new Color('#0a1020') },
              uSheen: { value: new Color('#4a5b7a') },
              uLevel: { value: z },
              uHalf: { value: FRAME.half },
              uPitch: { value: FRAME.pitch },
              uCells: { value: GRID_SIZE },
              uReach: { value: MARGIN / FRAME.pitch },
              uFrostA: { value: 0.085 },
              uGlassA: { value: 0.05 },
              uLine: { value: 0.42 },
              uWidth: { value: 0.013 },
              uFocus: { value: 0 },
              uDim: { value: 0 },
              uKeep: { value: z === LEVEL_COLORS.length - 1 ? 1 : 0 },
            },
            vertexShader: vertex,
            fragmentShader: fragment,
          }),
          border: new MeshBasicMaterial({
            color: tint.clone(),
            transparent: true,
            opacity: FRAME_OPACITY,
            depthWrite: false,
            toneMapped: false,
            fog: false,
          }),
          ticks: new MeshBasicMaterial({
            color: tint.clone(),
            transparent: true,
            opacity: FRAME_OPACITY,
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
        m.border.dispose();
        m.ticks.dispose();
      }),
    [materials],
  );

  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        const u = m.glass.uniforms;
        u.uFocus.value = w;
        u.uDim.value = any * (1 - w) * 0.22;
        // The deck that keeps its full strength from above: the one in play, else the top
        u.uKeep.value = Math.min(1, w + (1 - any) * (z === weights.length - 1 ? 1 : 0));
        frameBase.current[z] = FRAME_OPACITY * (1 - any * (1 - w) * 0.35) + 0.18 * w;
      });
      applyFrames();
    },
    { key: materials },
  );

  // Seen from straight above, the frames of the decks not in play step back a
  // little and the ticks go out (five rows of them would line up into a
  // dashed cross over the board): the border is then a plain square of light
  const frameBase = useRef(LEVEL_COLORS.map(() => FRAME_OPACITY));
  const above = useRef(0);
  const applyFrames = () =>
    materials.forEach((m, z) => {
      const keep = m.glass.uniforms.uKeep.value as number;
      m.border.opacity = frameBase.current[z] * (1 - 0.35 * above.current * (1 - keep));
      m.ticks.opacity = frameBase.current[z] * (1 - above.current);
      m.ticks.visible = above.current < 0.99;
    });
  useFrame(({ camera }) => {
    camera.getWorldDirection(view);
    const a = Math.min(Math.max((-view.y - 0.8) / 0.16, 0), 1);
    const next = a * a * (3 - 2 * a);
    if (next === above.current) return;
    above.current = next;
    applyFrames();
  });

  return (
    <group name="meridian-decks">
      {FRAME.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={geometries.glass}
            material={materials[z].glass}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={geometries.border}
            material={materials[z].border}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
          <mesh
            geometry={geometries.ticks}
            material={materials[z].ticks}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};
