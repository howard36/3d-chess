import { useEffect, useMemo, useState } from 'react';
import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import type { Orientation } from '../../layout';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout, Vec3 } from '../types';

// The board's coordinates as crisp pixel glyphs: Press Start 2P drawn at its
// native pixel grid with a hard drop shadow, sampled nearest-neighbour.
// Files run under the front face, ranks up its left edge, and each level's
// letter sits beside its slice on the right, in that level's neon.

const FONT = '"Press Start 2P"';

const glyph = (text: string, color: string, shadow: string) => {
  const c = document.createElement('canvas');
  c.width = 20;
  c.height = 20;
  const ctx = c.getContext('2d')!;
  ctx.font = `16px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = shadow;
  ctx.fillText(text, 3, 3);
  ctx.fillStyle = color;
  ctx.fillText(text, 1, 1);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  return t;
};

export const PixelLabels = ({
  layout,
  orientation,
  color,
  shadow,
  levelColors,
}: {
  layout: BoardLayout;
  orientation: Orientation;
  color: string;
  shadow: string;
  levelColors: string[];
}) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setReady(true);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts.load(`16px ${FONT}`).then(done, done);
    } else {
      done();
    }
    return () => {
      live = false;
    };
  }, []);

  const labels = useMemo(() => {
    if (!ready) return [];
    const [hx, hy, hz] = layout.halfExtents;
    const w = (x: number, y: number, z: number) => layout.toWorld({ x, y, z }, orientation);
    const out: { text: string; position: Vec3; size: number; map: CanvasTexture }[] = [];
    FILES.forEach((text, x) =>
      out.push({
        text,
        position: [w(x, 0, 0)[0], -hy - 0.62, hz + 0.1],
        size: 0.42,
        map: glyph(text, color, shadow),
      }),
    );
    RANKS.forEach((text, y) =>
      out.push({
        text,
        position: [-hx - 0.62, w(0, y, 0)[1], hz + 0.1],
        size: 0.42,
        map: glyph(text, color, shadow),
      }),
    );
    LEVELS.forEach((text, z) =>
      out.push({
        text,
        position: [hx + 0.7, -hy - 0.25, w(0, 0, z)[2]],
        size: 0.56,
        map: glyph(text, levelColors[z], '#0a0314'),
      }),
    );
    return out;
  }, [ready, layout, orientation, color, shadow, levelColors]);

  useEffect(() => () => labels.forEach((l) => l.map.dispose()), [labels]);

  return (
    <group name="board-labels">
      {labels.map((l) => (
        <sprite
          key={`${l.text}-${l.size}`}
          position={l.position}
          scale={l.size}
          raycast={noRaycast}
        >
          <spriteMaterial map={l.map} transparent depthWrite={false} toneMapped={false} />
        </sprite>
      ))}
    </group>
  );
};
