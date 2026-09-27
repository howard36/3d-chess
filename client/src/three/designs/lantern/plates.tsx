import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
} from 'three';
import type { Texture } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRID_SIZE } from '../../layout';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import { rng } from '../kit/textures';
import type { BoardLayout } from '../types';
import { PAPER } from './palette';

// The platforms: five shoji screens laid flat. A frame of dark lacquered
// wood, inlaid on top and banded on its outer face in the level's colour;
// kumiko slats in the same colour dividing it into its 25 panes, with a
// small diamond where the slats cross; and between them washi so thin the
// pieces below show through, glowing faintly warm, a little brighter at the
// heart of each pane and a little denser on the light squares.

/** How far the frame reaches past the outer squares, and its size. */
const MARGIN = 0.035;
const FRAME_WIDTH = 0.1;
const FRAME_DEPTH = 0.075;

let fibreTexture: Texture | null = null;
/** Washi: long soft fibres, white on clear, tiling. */
const fibres = () => {
  if (fibreTexture) return fibreTexture;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const random = rng(17);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = random() * size;
    const y = random() * size;
    const a = random() * Math.PI * 2;
    const len = 10 + random() * 40;
    const bend = (random() - 0.5) * 20;
    const v = random() < 0.5 ? 200 : 70;
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + random() * 0.35})`;
    ctx.lineWidth = 0.6 + random() * 1.4;
    for (const [dx, dy] of [
      [0, 0],
      [-size, 0],
      [size, 0],
      [0, -size],
      [0, size],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.quadraticCurveTo(
        x + dx + Math.cos(a) * len * 0.5 - Math.sin(a) * bend,
        y + dy + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
        x + dx + Math.cos(a) * len,
        y + dy + Math.sin(a) * len,
      );
      ctx.stroke();
    }
  }
  fibreTexture = new CanvasTexture(c);
  fibreTexture.wrapS = fibreTexture.wrapT = RepeatWrapping;
  fibreTexture.minFilter = LinearMipmapLinearFilter;
  fibreTexture.anisotropy = 4;
  return fibreTexture;
};

const vertexShader = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vCell = (position.xy + uHalf) / uPitch;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uFibre;
  uniform vec3 uPaper;
  uniform vec3 uLine;
  uniform float uLevel;
  uniform float uPaperOpacity;
  uniform float uLineOpacity;
  uniform float uPattern;
  uniform float uWidth;
  uniform float uCells;
  varying vec2 vCell;
  varying vec3 vWorld;

  // Coverage of lines of half-width w on whole numbers of u (after Ben Golus)
  vec2 gridLines(vec2 uv, float w) {
    vec4 d = vec4(dFdx(uv), dFdy(uv));
    vec2 deriv = max(vec2(length(d.xz), length(d.yw)), vec2(1e-6));
    vec2 target = vec2(w);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    return mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
  }

  void main() {
    vec2 uv = vCell;
    if (uv.x < -0.02 || uv.y < -0.02 || uv.x > uCells + 0.02 || uv.y > uCells + 0.02) discard;
    // The pane: the 3D board's colouring (dark where x + y + z is even)
    vec2 id = clamp(floor(uv), 0.0, uCells - 1.0);
    float darkSquare = 1.0 - mod(id.x + id.y + uLevel, 2.0);
    vec2 f = fract(uv) - 0.5;
    float heart = 1.0 - smoothstep(0.05, 0.5, max(abs(f.x), abs(f.y)));
    float fibre = texture2D(uFibre, uv * 0.55 + uLevel * 0.31).r;
    // uPattern: the checker, the glowing heart of each pane and the joints,
    // all of which thin to a plain veil on a level set back from above
    float paper = uPaperOpacity * mix(1.0, 0.4, darkSquare * uPattern);
    paper *= mix(0.9, 0.62 + 0.6 * heart, uPattern) * (0.55 + 0.9 * fibre);
    vec3 paperColor = uPaper * mix(1.0, 0.82, darkSquare * uPattern);
    // The kumiko: slats between the panes and round them, and a small
    // diamond where two cross
    vec2 lines = gridLines(uv, uWidth);
    float slat = max(lines.x, lines.y);
    vec2 g = uv - floor(uv + 0.5);
    float dia = abs(g.x) + abs(g.y) - 0.075;
    float daa = fwidth(dia) * 1.2;
    float joint = (1.0 - smoothstep(-daa, daa, dia)) * (1.0 - smoothstep(-daa, daa, 0.03 - abs(g.x) - abs(g.y) + 0.0));
    vec2 nearest = floor(uv + 0.5);
    joint *= step(0.5, min(nearest.x, nearest.y)) * step(max(nearest.x, nearest.y), uCells - 0.5);
    float line = max(slat, joint * 0.55 * uPattern) * uLineOpacity;
    float a = paper + line * (1.0 - paper);
    if (a < 0.003) discard;
    vec3 color = (paperColor * paper * (1.0 - line) + uLine * line) / max(a, 1e-4);
    gl_FragColor = vec4(color, a);
    #include <colorspace_fragment>
  }`;

export interface ShojiPlatesProps {
  layout: BoardLayout;
  /** One colour per level, A to E. */
  colors: string[];
  focusLevel?: number | null;
}

/** Opacity of the paper on a light square (dark squares are thinner). */
const PAPER_OPACITY = 0.17;
const LINE_OPACITY = 0.5;
const FOCUS_LINE = 0.95;
const FOCUS_DIM = 0.6;
const LINE_WIDTH = 0.018;

/**
 * Five shoji platforms, colour-coded per level. Decorative (never raycast).
 * The paper and slats are one quad per level, drawn with the platforms
 * (LAYER.plate), so shadows and markers lie over them; the frames are solid.
 * Seen from high above, every level but one (the focused level, else the
 * top) quietens to hairlines, so the nested grids never tangle; the level
 * in focus lights its slats and inlay.
 */
export const ShojiPlates = ({ layout, colors, focusLevel = null }: ShojiPlatesProps) => {
  const frame = towerFrame(layout);
  const camera = useThree((s) => s.camera);
  const side = frame.half + MARGIN;
  const colorKey = colors.join();

  const geometries = useMemo(() => {
    const paper = new PlaneGeometry(frame.half * 2 + 0.04, frame.half * 2 + 0.04);
    const wood = frameGeometry(side, FRAME_WIDTH, FRAME_DEPTH);
    // The lacquer band on the frame's outer face and the inlay along its top
    const band = frameGeometry(side + FRAME_WIDTH, 0.008, 0.032).translate(0, -0.018, 0);
    const inlay = frameGeometry(side + FRAME_WIDTH * 0.32, 0.028, 0.004).translate(0, 0.0035, 0);
    const accent = mergeGeometries([band, inlay]);
    band.dispose();
    inlay.dispose();
    // Bronze fittings capping the four corners, each with a short arm along
    // both sides, as on a lacquered box
    const mid = side + FRAME_WIDTH / 2;
    const caps: BoxGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = FRAME_WIDTH + 0.014;
        const h = FRAME_DEPTH + 0.01;
        caps.push(
          new BoxGeometry(0.2, h, w).translate(sx * (mid + w / 2 - 0.1), -h / 2 + 0.006, sz * mid),
          new BoxGeometry(w, h, 0.2).translate(sx * mid, -h / 2 + 0.006, sz * (mid + w / 2 - 0.1)),
        );
      }
    }
    const corners = mergeGeometries(caps);
    caps.forEach((c) => c.dispose());
    return { paper, wood, accent, corners };
  }, [frame.half, side]);
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);

  const materials = useMemo(
    () => ({
      bronze: new MeshStandardMaterial({
        color: '#7a5a34',
        metalness: 0.75,
        roughness: 0.42,
        fog: false,
      }),
      wood: new MeshStandardMaterial({
        color: '#2e1c15',
        roughness: 0.34,
        metalness: 0.05,
        fog: false,
      }),
      levels: colorKey.split(',').map((hex, z) => ({
        paper: new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          uniforms: {
            uFibre: { value: fibres() },
            uPaper: { value: new Color(PAPER) },
            uLine: { value: new Color(hex) },
            uLevel: { value: z },
            uPaperOpacity: { value: PAPER_OPACITY },
            uLineOpacity: { value: LINE_OPACITY },
            uPattern: { value: 1 },
            uWidth: { value: LINE_WIDTH },
            uCells: { value: GRID_SIZE },
            uHalf: { value: frame.half },
            uPitch: { value: frame.pitch },
          },
          vertexShader,
          fragmentShader,
        }),
        accent: new MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.5,
          roughness: 0.4,
          fog: false,
        }),
      })),
    }),
    [colorKey, frame.half, frame.pitch],
  );
  useEffect(
    () => () => {
      materials.wood.dispose();
      materials.bronze.dispose();
      materials.levels.forEach((m) => {
        m.paper.dispose();
        m.accent.dispose();
      });
    },
    [materials],
  );

  // Focus, and how far the view looks straight down: both set each level's
  // slats and glow
  const weights = useMemo(() => ({ w: [0, 0, 0, 0, 0], any: 0, steep: 0 }), []);
  const apply = () => {
    const { w, any, steep } = weights;
    const top = materials.levels.length - 1;
    materials.levels.forEach((m, z) => {
      const wz = w[z] ?? 0;
      // From above, one level keeps its full screen: the focused one, else
      // the top; the others thin to hairlines over a plain veil of paper,
      // so the nested grids never read as a plaid
      const primary = any * wz + (1 - any) * (z === top ? 1 : 0);
      const quiet = steep * (1 - primary);
      const base = LINE_OPACITY * (1 - any * (1 - FOCUS_DIM) * (1 - wz));
      m.paper.uniforms.uLineOpacity.value = (base + (FOCUS_LINE - base) * wz) * (1 - 0.78 * quiet);
      m.paper.uniforms.uPattern.value = 1 - 0.9 * quiet;
      m.paper.uniforms.uPaperOpacity.value = PAPER_OPACITY * (1 + 0.45 * wz) * (1 - 0.4 * quiet);
      m.accent.emissiveIntensity = 0.5 + 0.9 * wz - 0.2 * any * (1 - wz);
    });
  };
  useLevelFocus(
    focusLevel,
    (w, any) => {
      weights.w = w;
      weights.any = any;
      apply();
    },
    { levels: frame.levelY.length, key: materials },
  );
  useFrame(() => {
    const d = camera.position.clone().normalize();
    const elevation = (Math.asin(Math.min(Math.max(d.y, -1), 1)) * 180) / Math.PI;
    const steep = Math.min(Math.max((elevation - 48) / 22, 0), 1);
    const eased = steep * steep * (3 - 2 * steep);
    if (Math.abs(eased - weights.steep) > 1e-3) {
      weights.steep = eased;
      apply();
    }
  });

  return (
    <group name="shoji-plates">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={geometries.paper}
            material={materials.levels[z].paper}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh geometry={geometries.wood} material={materials.wood} raycast={noRaycast} />
          <mesh geometry={geometries.corners} material={materials.bronze} raycast={noRaycast} />
          <mesh
            geometry={geometries.accent}
            material={materials.levels[z].accent}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};
