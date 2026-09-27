import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, MeshBasicMaterial, PlaneGeometry, ShaderMaterial } from 'three';
import type { Mesh } from 'three';
import { GRID_SIZE } from '../../layout';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import type { BoardLayout } from '../types';
import { elevationOf } from './shared';
import { frostTexture } from './textures';

// The platforms: five panes of sea ice, each laid as 25 tiles. Every tile
// is its own pane: an etched joint in the level's colour runs round it, a
// bevel just inside the joint catches the light, and frost creeps in from
// its corners, so the 25 squares read one by one from any angle, top-down
// included. The checker is the frost itself: "light" squares are frosted
// ice, "dark" squares clear, so a bishop still keeps to its colour. The
// panes are faint, so the pieces below show through four of them; the
// slab's edge glows in the level's colour, as light gathers at the edge of
// glass.

const vertex = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vCell = (position.xy + uHalf) / uPitch;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragment = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uIce;
  uniform vec3 uFrostColor;
  uniform float uParity;
  uniform float uCells;
  uniform float uFocus;
  uniform float uKeep;
  uniform float uTop;
  uniform float uHigh;
  uniform float uClear;
  uniform float uFrosted;
  uniform sampler2D uFrost;
  varying vec2 vCell;
  varying vec3 vWorld;

  // Straight-alpha "over"
  void over(inout vec3 c, inout float a, vec3 lc, float la) {
    float oa = la + a * (1.0 - la);
    c = (lc * la + c * a * (1.0 - la)) / max(oa, 1e-4);
    a = oa;
  }

  float line(float d, float halfWidth) {
    float aa = max(fwidth(d), 1e-5) * 1.2;
    return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, d);
  }

  void main() {
    vec2 uv = vCell;
    vec2 cell = floor(uv);
    vec2 f = fract(uv);
    // 1 on the frosted ("light") squares; Aa1 is clear ("dark")
    float frosted = mod(cell.x + cell.y + uParity, 2.0);
    vec2 d2 = min(f, 1.0 - f);
    float d = min(d2.x, d2.y);

    // Seen from straight above, the five grids would nest into a plaid: every
    // pane but the one in play (the focused level) thins to its joints
    // alone, as hairlines
    float quiet = 1.0 - uTop * (1.0 - uKeep) * 0.92;

    vec3 c = uIce;
    float a = mix(uClear, mix(uClear, uFrosted, quiet), frosted) * (0.6 + 0.4 * quiet);

    // Frost: feathery growth from each tile's corners, and a fine rime all over the frosted tiles
    vec4 fr = texture2D(uFrost, uv * 0.43 + cell * vec2(0.173, 0.291));
    float corner = smoothstep(0.62, 0.0, length(d2));
    float frost = fr.r * corner * (0.55 + 0.45 * frosted) + fr.g * frosted * 0.3;
    // Higher views look through more panes at once: the frost of those not in play thins
    float thin = 1.0 - 0.5 * uHigh * (1.0 - uFocus);
    over(c, a, uFrostColor, clamp(frost * 0.22 * quiet * thin, 0.0, 1.0));

    // The bevel just inside each tile, catching the light
    float bevel = line(abs(d - 0.05), 0.008);
    over(c, a, mix(uFrostColor, uTint, 0.35), bevel * (0.16 + 0.1 * uFocus) * quiet);

    // The etched joint between tiles, in the level's colour (not round the outside: the slab edge does that)
    vec2 nearest = floor(uv + 0.5);
    vec2 inner = step(0.5, nearest) * step(nearest, vec2(uCells - 0.5));
    vec2 dl = abs(uv - nearest);
    float jx = line(dl.x, 0.012) * inner.x;
    float jy = line(dl.y, 0.012) * inner.y;
    float joint = max(jx, jy);
    over(c, a, uTint, joint * (0.5 + 0.35 * uFocus) * (0.3 + 0.7 * quiet));

    // Ice turns to a mirror at grazing angles: a faint sheen of the night sky
    vec3 view = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - abs(view.y), 4.0);
    over(c, a, uFrostColor * 0.6, fres * 0.08);

    a += uFocus * 0.04;
    if (a < 0.003) discard;
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }`;

export interface IcePlatesProps {
  layout: BoardLayout;
  /** Level colours, A to E. */
  colors: string[];
  focusLevel: number | null;
}

/** Five ice panes of 25 tiles each, with glowing edges in the level colours. */
export const IcePlates = ({ layout, colors, focusLevel }: IcePlatesProps) => {
  const frame = towerFrame(layout);
  const margin = 0.07;
  const side = frame.half + margin;
  const geometry = useMemo(
    () => ({
      // The tiles; the margin out to the glowing edge is left clear
      surface: new PlaneGeometry(frame.half * 2, frame.half * 2),
      edge: frameGeometry(side, 0.03, 0.06),
      focusEdge: frameGeometry(side, 0.042, 0.07),
    }),
    [frame.half, side],
  );
  useEffect(() => () => Object.values(geometry).forEach((g) => g.dispose()), [geometry]);
  const colorKey = colors.join();
  const materials = useMemo(
    () =>
      frame.levelY.map((_, z) => ({
        surface: new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          uniforms: {
            uTint: { value: new Color(colors[z]) },
            uIce: { value: new Color('#1d3d57').lerp(new Color(colors[z]), 0.18) },
            uFrostColor: { value: new Color('#d9ecff') },
            uParity: { value: z % 2 },
            uCells: { value: GRID_SIZE },
            uHalf: { value: frame.half },
            uPitch: { value: frame.pitch },
            uFocus: { value: 0 },
            // 1 for the pane that keeps its detail when the view is straight down
            uKeep: { value: 0 },
            uTop: { value: 0 },
            uHigh: { value: 0 },
            uClear: { value: 0.05 },
            uFrosted: { value: 0.11 },
            uFrost: { value: frostTexture() },
          },
          vertexShader: vertex,
          fragmentShader: fragment,
        }),
        edge: new MeshBasicMaterial({
          color: new Color(colors[z]),
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
        focus: new MeshBasicMaterial({
          color: new Color(colors[z]).lerp(new Color('#ffffff'), 0.25),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colours by value (key)
    [colorKey, frame.half, frame.pitch, frame.levelY.length],
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
  // The pane in play: the focused level, if any
  const keep = useRef<number[]>(frame.levelY.map(() => 0));
  const top = useRef(0);
  const edgeBase = useRef<number[]>(frame.levelY.map(() => 0.7));
  const applyEdges = () =>
    materials.forEach((m, z) => {
      // Straight down, the other panes' edges step back too
      m.edge.opacity = edgeBase.current[z] * (1 - top.current * (1 - keep.current[z]) * 0.55);
    });
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        if (!m) return;
        m.surface.uniforms.uFocus.value = w;
        edgeBase.current[z] = 0.7 * (1 - any * 0.45 * (1 - w));
        // Nothing in play: from overhead every grid steps back (perspective
        // would slide lower pieces onto the top grid's lines); each piece's
        // own square is framed at its foot instead
        keep.current[z] = w;
        m.surface.uniforms.uKeep.value = keep.current[z];
        m.focus.opacity = w * 0.55;
        const mesh = focusMeshes.current[z];
        if (mesh) mesh.visible = w > 0.002;
      });
      applyEdges();
    },
    { levels: frame.levelY.length, ms: 160, key: materials },
  );

  // How close the view is to straight down (0 below 60°, 1 from 80°), and
  // how high it is at all (0 below 35°, 1 from 60°)
  useFrame(({ camera }) => {
    const el = elevationOf(camera.position);
    const t = Math.min(Math.max((el - 60) / 20, 0), 1);
    const h = Math.min(Math.max((el - 35) / 25, 0), 1);
    for (const m of materials) m.surface.uniforms.uHigh.value = h * h * (3 - 2 * h);
    if (t === top.current) return;
    top.current = t;
    for (const m of materials) m.surface.uniforms.uTop.value = t;
    applyEdges();
  });

  return (
    <group name="ice-plates">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={geometry.surface}
            material={materials[z].surface}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={geometry.edge}
            material={materials[z].edge}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
          <mesh
            ref={(m) => {
              focusMeshes.current[z] = m;
            }}
            geometry={geometry.focusEdge}
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
