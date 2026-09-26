import { useEffect, useMemo, useState } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import { GRID_SIZE } from '../../layout';
import type { Orientation } from '../../layout';
import { noRaycast } from './noRaycast';
import type { BoardLayout, Vec3 } from '../types';

export interface LabelStyle {
  /** CSS font family, e.g. `Cinzel, serif` or `"Press Start 2P"`. */
  font?: string;
  /** CSS font weight. */
  weight?: number | string;
  color?: string;
  /** Soft glow or outline around the glyphs. */
  shadow?: string;
  /** World height of a label. */
  size?: number;
  opacity?: number;
  /** Draw the level letters larger: they are the axis players look for first. */
  levelScale?: number;
}

interface Anchor {
  text: string;
  position: Vec3;
  level?: boolean;
}

const avg = (ps: Vec3[]): Vec3 =>
  [0, 1, 2].map((i) => ps.reduce((a, p) => a + p[i], 0) / ps.length) as Vec3;

/**
 * Where each coordinate label goes: files along the near bottom edge,
 * ranks up (lattice) or along (tower) the near left edge, and levels beside
 * their layer. Worked out from the layout's own cell positions, so it
 * follows the orientation and any spacing a design picks.
 */
const anchorsFor = (layout: BoardLayout, orientation: Orientation): Anchor[] => {
  const n = GRID_SIZE;
  const w = (x: number, y: number, z: number) => layout.toWorld({ x, y, z }, orientation);
  const all = Array.from({ length: n ** 3 }, (_, i) => ({
    x: i % n,
    y: Math.floor(i / n) % n,
    z: Math.floor(i / n ** 2),
  }));
  const [hx, hy, hz] = layout.halfExtents;
  const gap = 0.45;
  const out: Anchor[] = [];
  if (layout.kind === 'lattice') {
    const nearZ = Math.max(...all.map((c) => w(c.x, c.y, c.z)[2]));
    for (let x = 0; x < n; x++) {
      const [px] = w(x, 0, 0);
      out.push({ text: FILES[x], position: [px, -hy - gap, nearZ] });
    }
    for (let y = 0; y < n; y++) {
      const [, py] = w(0, y, 0);
      out.push({ text: RANKS[y], position: [-hx - gap, py, nearZ] });
    }
    for (let z = 0; z < n; z++) {
      const [, , pz] = w(0, 0, z);
      out.push({ text: LEVELS[z], position: [-hx - gap, -hy - gap, pz], level: true });
    }
  } else {
    // Tower: labels on the bottom board's near and left edges, and each level
    // letter out to the left of its own board.
    const floorOf = (z: number) => w(0, 0, z)[1] + layout.floorY;
    const nearZ = hz;
    for (let x = 0; x < n; x++) {
      const [px] = w(x, 0, 0);
      out.push({ text: FILES[x], position: [px, floorOf(0) + 0.02, nearZ + gap] });
    }
    for (let y = 0; y < n; y++) {
      const [, , pz] = w(0, y, 0);
      out.push({ text: RANKS[y], position: [-hx - gap, floorOf(0) + 0.02, pz] });
    }
    for (let z = 0; z < n; z++) {
      const [cx, , cz] = avg([w(0, 0, z), w(0, n - 1, z)]);
      out.push({
        text: LEVELS[z],
        position: [cx - hx * 0.55 - 1.1, floorOf(z) + 0.25, cz + hz * 0.6],
        level: true,
      });
    }
  }
  return out;
};

const drawLabel = (
  text: string,
  font: (px: number) => string,
  color: string,
  shadow: string | undefined,
) => {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.font = font(size * 0.62);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (shadow) {
    ctx.shadowColor = shadow;
    ctx.shadowBlur = size * 0.12;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, size / 2 + size * 0.04);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

/**
 * The board's coordinates (files a–e, ranks 1–5, levels A–E) as camera-facing
 * sprites in the design's font, so the typed-move notation can be read off
 * the board.
 */
export const BoardLabels = ({
  layout,
  orientation,
  font = 'system-ui, sans-serif',
  weight = 600,
  color = '#ffffff',
  shadow,
  size = 0.42,
  opacity = 0.85,
  levelScale = 1.35,
}: LabelStyle & { layout: BoardLayout; orientation: Orientation }) => {
  // Draw once the font is ready: a canvas drawn before then silently uses a
  // fallback face and never updates.
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setFontReady(true);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts.load(`${weight} 64px ${font}`).then(done, done);
    } else {
      done();
    }
    return () => {
      live = false;
    };
  }, [font, weight]);

  const labels = useMemo(() => {
    if (!fontReady) return [];
    return anchorsFor(layout, orientation).map((a) => ({
      ...a,
      texture: drawLabel(a.text, (px) => `${weight} ${px}px ${font}`, color, shadow),
    }));
  }, [fontReady, layout, orientation, font, weight, color, shadow]);

  useEffect(() => () => labels.forEach((l) => l.texture.dispose()), [labels]);

  return (
    <group name="board-labels">
      {labels.map((l) => (
        <sprite
          key={`${l.text}-${l.level ? 'level' : 'axis'}`}
          position={l.position}
          scale={l.level ? size * levelScale : size}
          raycast={noRaycast}
        >
          <spriteMaterial
            map={l.texture}
            transparent
            opacity={opacity}
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </sprite>
      ))}
    </group>
  );
};
