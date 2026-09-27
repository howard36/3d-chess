import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { GRID_SIZE } from '../../layout';
import { focusLevelOf, useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import { SmartLabels } from '../kit/smartLabels';
import type { GridProps } from '../types';
import { INK, LEVELS, TITANIUM } from './palette';
import { view } from './view';

// The decks: one pane of pressure glass per level, held in a titanium bezel
// with a light strip in the level's colour. Thin bioluminescent seams glow
// between its 25 squares, with a soft halo on the glass, and alternate
// squares are faintly frosted in the Raumschach colouring, so every square
// reads on its own from any side. All of it stays quieter than the marks of
// play: thin lines, no lit dots, no rings. Seen from straight above, only
// the focused level keeps its glowing grid (with nothing focused, none
// does); the others thin to hairlines, so the nested grids never read as a
// plaid. The decks also publish the view's steepness and the focus for the
// pieces and marks (view.ts).

const MARGIN = 0.07;
const BEZEL = 0.07;
const BEZEL_DEPTH = 0.075;

const vertexShader = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  void main() {
    vCell = (position.xy + uHalf) / uPitch;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGlass;
  uniform vec3 uFrostColor;
  uniform float uParity;
  uniform float uClear;
  uniform float uFrost;
  uniform float uSeam;
  uniform float uWidth;
  uniform float uHalo;
  uniform float uStrength;
  uniform float uCells;
  varying vec2 vCell;

  void main() {
    vec2 uv = vCell;
    if (any(lessThan(uv, vec2(-0.03))) || any(greaterThan(uv, vec2(uCells + 0.03)))) discard;

    // Seams: coverage-correct hairlines on whole squares (Ben Golus's pristine grid)
    vec4 dd = vec4(dFdx(uv), dFdy(uv));
    vec2 deriv = max(vec2(length(dd.xz), length(dd.yw)), vec2(1e-6));
    vec2 target = vec2(uWidth);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 gl = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, gl);
    lines *= clamp(target / draw, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
    float seam = max(lines.x, lines.y);

    // The seams' glow on the glass
    vec2 g = abs(fract(uv + 0.5) - 0.5);
    float halo = exp(-min(g.x, g.y) / 0.045);
    // Fade the halo where it would shimmer (far and grazing)
    float calm = 1.0 - smoothstep(0.02, 0.08, max(deriv.x, deriv.y));

    // Glass, alternate squares frosted (Raumschach colouring)
    vec2 cell = clamp(floor(uv), vec2(0.0), vec2(uCells - 1.0));
    float frosted = mod(cell.x + cell.y + uParity, 2.0);
    // Frost gathers toward each square's edges, clearer at its heart
    vec2 f = abs(fract(uv) - 0.5) * 2.0;
    float rim = pow(max(f.x, f.y), 3.0);
    float glassA = mix(uClear, uFrost * (0.75 + 0.5 * rim), frosted);
    vec3 glass = mix(uGlass, uFrostColor, frosted);

    float light = clamp((seam * uSeam + halo * uHalo * calm) * uStrength, 0.0, 1.0);
    float a = glassA + light * (1.0 - glassA);
    vec3 c = (glass * glassA * (1.0 - light) + uColor * light) / max(a, 1e-4);
    if (a < 0.003) discard;
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }`;

const SEAM = 0.55;
const HALO = 0.1;
const BEZEL_OPACITY = 0.55;

/** The five glass decks with their seams, bezels and light strips. */
export const PressureDecks = ({
  layout,
  focusLevel,
}: GridProps & { focusLevel: number | null }) => {
  // Measured once per layout: the geometry and materials below key on it
  const frame = useMemo(() => towerFrame(layout), [layout]);
  const side = frame.half + MARGIN;
  const camera = useThree((s) => s.camera);

  const { plane, bezel, strip } = useMemo(() => {
    const reach = frame.half + 0.04;
    const bezel = frameGeometry(side, BEZEL, BEZEL_DEPTH).translate(0, -0.004, 0);
    return {
      plane: new PlaneGeometry(reach * 2, reach * 2),
      bezel,
      // The light strip along the bezel's top, a hair above it
      strip: frameGeometry(side + BEZEL * 0.3, BEZEL * 0.34, 0.006),
    };
  }, [frame.half, side]);

  const materials = useMemo(
    () =>
      frame.levelY.map(
        (_, z) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: new Color(LEVELS[z]) },
              uGlass: { value: new Color('#0e3a44') },
              uFrostColor: { value: new Color('#5d8e97') },
              // Aa1 (x + y + z even) is a clear square; the frosted ones alternate
              uParity: { value: z % 2 },
              uClear: { value: 0.05 },
              uFrost: { value: 0.1 },
              uSeam: { value: SEAM },
              uWidth: { value: 0.018 },
              uHalo: { value: HALO },
              uStrength: { value: 1 },
              uCells: { value: GRID_SIZE },
              uHalf: { value: frame.half },
              uPitch: { value: frame.pitch },
            },
            vertexShader,
            fragmentShader,
          }),
      ),
    [frame.levelY, frame.half, frame.pitch],
  );
  const stripMaterials = useMemo(
    () =>
      LEVELS.map(
        (c) =>
          new MeshBasicMaterial({
            color: c,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            toneMapped: false,
          }),
      ),
    [],
  );
  // One bezel material per level, so a level's frame can recede on its own
  const bezelMaterials = useMemo(
    () =>
      LEVELS.map(
        () =>
          new MeshStandardMaterial({
            color: TITANIUM,
            roughness: 0.45,
            metalness: 0.7,
            envMapIntensity: 0.4,
            // See-through, so a bezel never hides a piece on the deck below
            transparent: true,
            opacity: BEZEL_OPACITY,
            depthWrite: false,
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      plane.dispose();
      bezel.dispose();
      strip.dispose();
      materials.forEach((m) => m.dispose());
      stripMaterials.forEach((m) => m.dispose());
      bezelMaterials.forEach((m) => m.dispose());
    },
    [plane, bezel, strip, materials, stripMaterials, bezelMaterials],
  );

  // Focus: the level in play brightens its seams and strip, the others dim
  const focus = useRef<number[]>([0, 0, 0, 0, 0]);
  const anyFocus = useRef(0);
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      focus.current = weights;
      anyFocus.current = any;
    },
    { levels: frame.levelY.length, ms: 180, key: materials },
  );

  // Seen from above, the grids would nest into a plaid: past about 60° of
  // elevation every level but the focused one thins to a quiet hairline
  // lattice, loses its halo and dims its frame. With nothing focused, all
  // five go quiet together (each piece then shows its own square's footprint,
  // pieces.tsx), so no one level's grid organises the view. On the way up the
  // lower decks also recede a little into the water.
  useFrame(() => {
    const p = camera.position;
    const el = Math.atan2(p.y, Math.hypot(p.x, p.z));
    const ease = (a: number, b: number) => {
      const t = Math.min(Math.max((el - a) / (b - a), 0), 1);
      return t * t * (3 - 2 * t);
    };
    const DEG = Math.PI / 180;
    const rising = ease(35 * DEG, 70 * DEG);
    const steep = ease(58 * DEG, 75 * DEG);
    view.steep.value = steep;
    view.ticks.value = ease(50 * DEG, 62 * DEG);
    view.anyFocus = anyFocus.current;
    const top = frame.levelY.length - 1;
    materials.forEach((m, z) => {
      const w = focus.current[z] ?? 0;
      view.focus[z] = w;
      const below = (top - z) / top;
      const recede = 1 - rising * 0.3 * below;
      const quiet = 1 - steep * 0.8 * (1 - w);
      const dim = 1 - anyFocus.current * 0.35 * (1 - w);
      m.uniforms.uStrength.value = recede * quiet * dim * (1 + 0.55 * w);
      m.uniforms.uHalo.value = HALO * (1 - steep * (1 - w));
      stripMaterials[z].opacity =
        (0.55 + 0.45 * w) * (1 - anyFocus.current * 0.3 * (1 - w)) * (1 - steep * 0.65 * (1 - w));
      bezelMaterials[z].opacity = BEZEL_OPACITY * (1 - steep * 0.8 * (1 - w));
    });
  });

  return (
    <group name="abyss-decks">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={bezel}
            material={bezelMaterials[z]}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
          <mesh
            geometry={plane}
            material={materials[z]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={strip}
            material={stripMaterials[z]}
            position={[0, 0.006, 0]}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};

/**
 * The board's visible structure: decks and coordinates. Decorative only:
 * Board draws it outside the clickable group.
 */
export const Grid = ({ layout, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <PressureDecks layout={layout} orientation={orientation} focusLevel={focusLevel} />
      <SmartLabels
        layout={layout}
        orientation={orientation}
        font='"IBM Plex Mono", ui-monospace, monospace'
        weight={500}
        levelWeight={600}
        color={INK}
        outline="rgba(2, 14, 18, 0.9)"
        outlineWidth={0.06}
        size={0.36}
        opacity={0.88}
        levelScale={1.5}
        levelColors={LEVELS}
        focusLevel={focusLevel}
        focusScale={1.3}
        focusDim={0.55}
      />
    </>
  );
};
