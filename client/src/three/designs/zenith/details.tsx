import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Line,
  LinearMipmapLinearFilter,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Texture } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import { TOWER_MASK } from './mask';
import { GROUND_Y, PALETTE } from './palette';

// The touches that reward a close look, all faint, still and abstract:
// - the colossal board's notation, engraved in light in the polished ground
//   along its edges (files a–h beyond the first and eighth ranks, ranks 1–8
//   beyond the a- and h-files), each set to read upright from the tower, as
//   a board's own letters read from the player's chair;
// - for a camera looking up, now and then (a minute or so apart) a slow,
//   faint shooting star high overhead, well off to one side of the tower,
//   falling away from it.
// Whatever lies behind the tower is held down to nothing (mask.ts).

/** The side of a colossal square (stage.tsx), and so where the board's edge lies. */
const SQUARE = 8;
const EDGE = 4 * SQUARE;

const FONT = '"Manrope", system-ui, sans-serif';

/** Draws on a canvas once the font has loaded (and at once, in a fallback face). */
const canvasTexture = (
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
  font: string,
): Texture => {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const t = new CanvasTexture(c);
  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    paint(ctx);
    t.needsUpdate = true;
  };
  draw();
  document.fonts?.load(font).then(draw, () => undefined);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  return t;
};

// --- The board's notation ------------------------------------------------------------

const GLYPHS = 'abcdefgh12345678';
const CELL = 128;

/** The sixteen glyphs in a 4 × 4 atlas, each an outline of light over a faint fill. */
const glyphAtlas = () =>
  canvasTexture(
    CELL * 4,
    CELL * 4,
    (ctx) => {
      ctx.font = `600 ${CELL * 0.72}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      [...GLYPHS].forEach((g, i) => {
        const x = (i % 4) * CELL + CELL / 2;
        const y = Math.floor(i / 4) * CELL + CELL / 2 + CELL * 0.03;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillText(g, x, y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
        ctx.lineWidth = CELL * 0.035;
        ctx.strokeText(g, x, y);
      });
    },
    `600 ${CELL * 0.72}px ${FONT}`,
  );

/**
 * Half a glyph's cell on the ground (world units): across, and along its
 * height, drawn long as road markings are so it reads at a low angle.
 */
const GLYPH_HALF = 1.3;
const GLYPH_LONG = 2.9;
/** How far beyond the board's edge the glyphs' centres lie. */
const GLYPH_OUT = 3.6;

/**
 * Every glyph as a quad lying on the ground: `up` points away from the
 * board (so it reads upright from the tower, inside it) and `right` along
 * the edge as a viewer at the tower sees it.
 */
const notationGeometry = (): BufferGeometry => {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const y = GROUND_Y + 0.01;
  const add = (glyph: string, cx: number, cz: number, right: number[], up: number[]) => {
    const i = GLYPHS.indexOf(glyph);
    const u0 = (i % 4) / 4;
    const v1 = 1 - Math.floor(i / 4) / 4;
    const u1 = u0 + 0.25;
    const v0 = v1 - 0.25;
    const base = pos.length / 3;
    for (const [sr, su, u, v] of [
      [-1, -1, u0, v0],
      [1, -1, u1, v0],
      [1, 1, u1, v1],
      [-1, 1, u0, v1],
    ]) {
      pos.push(
        cx + right[0] * sr * GLYPH_HALF + up[0] * su * GLYPH_LONG,
        y,
        cz + right[2] * sr * GLYPH_HALF + up[2] * su * GLYPH_LONG,
      );
      uv.push(u, v);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const out = EDGE + GLYPH_OUT;
  for (let k = 0; k < 8; k++) {
    const along = (k - 3.5) * SQUARE;
    const file = 'abcdefgh'[k];
    const rank = String(8 - k);
    // Beyond the eighth rank (read from White's side) and the first (Black's)
    add(file, along, -out, [1, 0, 0], [0, 0, -1]);
    add(file, along, out, [-1, 0, 0], [0, 0, 1]);
    // Beyond the a-file and the h-file; `along` runs from rank 8 (-z) to 1
    add(rank, -out, along, [0, 0, -1], [-1, 0, 0]);
    add(rank, out, along, [0, 0, 1], [1, 0, 0]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  return g;
};

const glyphVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const glyphFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  varying vec3 vWorld;
  ${TOWER_MASK}
  void main() {
    float a = texture2D(uMap, vUv).a;
    // Fading into the night far off, as the board's lines do
    float far = 1.0 - smoothstep(40.0, 110.0, distance(vWorld, cameraPosition));
    float light = a * uIntensity * far * (1.0 - towerCover(vWorld));
    if (light < 0.001) discard;
    gl_FragColor = vec4(uColor * light, 1.0);
    #include <colorspace_fragment>
  }`;

const Notation = () => {
  const { geometry, material, map } = useMemo(() => {
    const map = glyphAtlas();
    return {
      map,
      geometry: notationGeometry(),
      material: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uMap: { value: map },
          uColor: { value: new Color(PALETTE.neon) },
          uIntensity: { value: 0.016 },
        },
        vertexShader: glyphVertex,
        fragmentShader: glyphFragment,
      }),
    };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
    [geometry, material, map],
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-895}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

// --- A shooting star ------------------------------------------------------------------

/** Points along the streak's path. */
const TRAIL = 48;
const METEOR_DOME = 290;
/** How long one takes to cross its path (seconds). */
const METEOR_SECONDS = 1.9;
/** The share of the path its tail covers. */
const METEOR_TAIL = 0.35;

const meteorVertex = /* glsl */ `
  uniform vec3 uFrom;
  uniform vec3 uTo;
  attribute float aAlong;
  varying float vAlong;
  varying vec3 vWorld;
  void main() {
    // Along the great circle from uFrom to uTo, on the dome
    float o = acos(clamp(dot(uFrom, uTo), -1.0, 1.0));
    vec3 d = (sin((1.0 - aAlong) * o) * uFrom + sin(aAlong * o) * uTo) / max(sin(o), 1e-4);
    vec4 w = vec4(normalize(d) * ${METEOR_DOME.toFixed(1)}, 1.0);
    vAlong = aAlong;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const meteorFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHead;
  uniform float uLight;
  varying float vAlong;
  varying vec3 vWorld;
  ${TOWER_MASK}
  void main() {
    // Brightest at the head, thinning out along the tail behind it
    float behind = uHead - vAlong;
    float tail = behind < 0.0 ? 0.0 : pow(1.0 - clamp(behind / ${METEOR_TAIL.toFixed(2)}, 0.0, 1.0), 2.2);
    float light = tail * uLight * (1.0 - towerCover(vWorld));
    if (light < 0.002) discard;
    gl_FragColor = vec4(uColor * light, 1.0);
    #include <colorspace_fragment>
  }`;

const DEG = Math.PI / 180;
const skyDirection = (azimuth: number, elevation: number) =>
  new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  );

/**
 * Now and then, while the camera looks up past the tower, one faint streak
 * falls slowly across the sky beside it. Everything runs on r3f's clock and
 * nothing wakes the canvas: once one is due (a minute or so after the last)
 * it starts on the next frame drawn while the camera has been looking up
 * for a moment (a player exploring the sky is turning the view), and then
 * keeps the frames coming only while it lasts.
 */
const ShootingStar = () => {
  const invalidate = useThree((s) => s.invalidate);
  const { geometry, material, line } = useMemo(() => {
    const along = Float32Array.from({ length: TRAIL }, (_, i) => i / (TRAIL - 1));
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(TRAIL * 3), 3));
    g.setAttribute('aAlong', new BufferAttribute(along, 1));
    const m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uFrom: { value: new Vector3(0, 1, 0) },
        uTo: { value: new Vector3(0, 1, 0) },
        uColor: { value: new Color(PALETTE.neon) },
        uHead: { value: 0 },
        uLight: { value: 0 },
      },
      vertexShader: meteorVertex,
      fragmentShader: meteorFragment,
    });
    const l = new Line(g, m);
    l.visible = false;
    l.renderOrder = -986;
    l.frustumCulled = false;
    l.raycast = noRaycast;
    return { geometry: g, material: m, line: l };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const state = useRef({ random: rng(907), next: -1, start: -1, upSince: -1 });
  useFrame(({ clock, camera }) => {
    const s = state.current;
    const t = clock.elapsedTime;
    if (s.next < 0) s.next = t + 30 + s.random() * 30;
    // Looking up far enough that the frame holds the sky at 20–25° beside
    // the tower
    const dir = camera.getWorldDirection(new Vector3());
    const up = dir.y > Math.sin(8 * DEG);
    if (!up) s.upSince = -1;
    else if (s.upSince < 0) s.upSince = t;
    if (s.start < 0 && t >= s.next && up && t - s.upSince > 1.5) {
      const look = Math.atan2(dir.x, dir.z);
      const side = s.random() < 0.5 ? -1 : 1;
      const az = look + side * (20 + s.random() * 7) * DEG;
      const el = (20 + s.random() * 5) * DEG;
      material.uniforms.uFrom.value.copy(skyDirection(az, el));
      material.uniforms.uTo.value.copy(
        skyDirection(az + side * (8 + s.random() * 4) * DEG, el - (8 + s.random() * 3) * DEG),
      );
      s.start = t;
      s.next = t + 45 + s.random() * 45;
    }
    if (s.start >= 0) {
      const p = (t - s.start) / METEOR_SECONDS;
      if (p >= 1 + METEOR_TAIL) {
        s.start = -1;
        line.visible = false;
      } else {
        material.uniforms.uHead.value = p;
        // In gently, out as the head burns away
        material.uniforms.uLight.value =
          0.45 * Math.min(p / 0.15, 1) * Math.min(Math.max((1.1 - p) / 0.35, 0), 1);
        line.visible = true;
        invalidate();
      }
    }
  });
  return <primitive object={line} />;
};

/**
 * The close-look touches (see above). `turn` is -1 for Black, whose view
 * of the colossal board is turned half about, as the tower's is.
 */
export const Details = ({ turn }: { turn: number }) => (
  <group name="zenith-details">
    <group rotation={[0, turn < 0 ? Math.PI : 0, 0]}>
      <Notation />
    </group>
    <ShootingStar />
  </group>
);
