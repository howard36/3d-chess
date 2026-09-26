import { useEffect, useMemo, useState } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import { GRID_SIZE } from '../../layout';
import type { Orientation } from '../../layout';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout, Vec3 } from '../types';

// The kit's coordinate labels, re-anchored for a lattice seen from the
// opening camera (up and to the right): files along the near bottom edge,
// ranks up the near left edge, and levels along the bottom right edge,
// which is on the cube's silhouette, so the letters never sit over pieces.

interface Anchor {
  text: string;
  position: Vec3;
  level: boolean;
}

const anchorsFor = (layout: BoardLayout, orientation: Orientation): Anchor[] => {
  const n = GRID_SIZE;
  const w = (x: number, y: number, z: number) => layout.toWorld({ x, y, z }, orientation);
  const [hx, hy, hz] = layout.halfExtents;
  const gap = 0.5;
  const out: Anchor[] = [];
  for (let x = 0; x < n; x++) {
    out.push({ text: FILES[x], position: [w(x, 0, 0)[0], -hy - gap, hz + 0.1], level: false });
  }
  for (let y = 0; y < n; y++) {
    const floor = w(0, y, 0)[1] + layout.floorY + 0.25;
    out.push({ text: RANKS[y], position: [-hx - gap, floor, hz + 0.1], level: false });
  }
  for (let z = 0; z < n; z++) {
    out.push({ text: LEVELS[z], position: [hx + gap, -hy - gap, w(0, 0, z)[2]], level: true });
  }
  return out;
};

const drawLabel = (text: string, font: string, color: string, shadow: string) => {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = size * 0.12;
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, size / 2 + size * 0.04);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

export const LatticeLabels = ({
  layout,
  orientation,
  family,
  weight,
  color,
  levelColor,
  shadow,
  size,
}: {
  layout: BoardLayout;
  orientation: Orientation;
  family: string;
  weight: number;
  color: string;
  levelColor: string;
  shadow: string;
  size: number;
}) => {
  // Draw once the font is ready: a canvas drawn before then silently uses a
  // fallback face and never updates.
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setFontReady(true);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts.load(`${weight} 64px ${family}`).then(done, done);
    } else {
      done();
    }
    return () => {
      live = false;
    };
  }, [family, weight]);

  const labels = useMemo(() => {
    if (!fontReady) return [];
    const font = `${weight} ${128 * 0.62}px ${family}`;
    return anchorsFor(layout, orientation).map((a) => ({
      ...a,
      texture: drawLabel(a.text, font, a.level ? levelColor : color, shadow),
    }));
  }, [fontReady, layout, orientation, family, weight, color, levelColor, shadow]);

  useEffect(() => () => labels.forEach((l) => l.texture.dispose()), [labels]);

  return (
    <group name="board-labels">
      {labels.map((l) => (
        <sprite
          key={`${l.text}-${l.level ? 'level' : 'axis'}`}
          position={l.position}
          scale={l.level ? size * 1.35 : size}
          raycast={noRaycast}
        >
          <spriteMaterial
            map={l.texture}
            transparent
            opacity={0.9}
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </sprite>
      ))}
    </group>
  );
};
