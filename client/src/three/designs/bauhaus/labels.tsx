import { useEffect, useMemo, useState } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import type { Orientation } from '../../layout';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout, Vec3 } from '../types';

// Coordinates set like poster type: files along the front edge, ranks up the
// left, and the level letters reversed out of black squares along the
// right-hand edge that recedes into the picture.

const draw = (text: string, font: string, ink: string, block: string | null) => {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  if (block) {
    ctx.fillStyle = block;
    ctx.fillRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8);
  }
  ctx.fillStyle = ink;
  ctx.font = `700 ${s * (block ? 0.56 : 0.66)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s / 2, s / 2 + s * 0.06);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

export const PosterLabels = ({
  layout,
  orientation,
  font,
  ink,
  paper,
}: {
  layout: BoardLayout;
  orientation: Orientation;
  font: string;
  ink: string;
  paper: string;
}) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setReady(true);
    if (document.fonts?.load) document.fonts.load(`700 64px ${font}`).then(done, done);
    else done();
    return () => {
      live = false;
    };
  }, [font]);

  const labels = useMemo(() => {
    if (!ready) return [];
    const w = (x: number, y: number, z: number) => layout.toWorld({ x, y, z }, orientation);
    const [hx, hy, hz] = layout.halfExtents;
    const out: { text: string; at: Vec3; level: boolean }[] = [];
    for (let i = 0; i < 5; i++) {
      out.push({ text: FILES[i], at: [w(i, 0, 0)[0], -hy - 0.42, hz], level: false });
      out.push({ text: RANKS[i], at: [-hx - 0.42, w(0, i, 0)[1] - 0.12, hz], level: false });
      out.push({ text: LEVELS[i], at: [hx + 0.5, -hy - 0.1, w(0, 0, i)[2]], level: true });
    }
    return out.map((l) => ({
      ...l,
      texture: draw(l.text, font, l.level ? paper : ink, l.level ? ink : null),
    }));
  }, [ready, layout, orientation, font, ink, paper]);

  useEffect(() => () => labels.forEach((l) => l.texture.dispose()), [labels]);

  return (
    <group name="board-labels">
      {labels.map((l) => (
        <sprite
          key={`${l.text}-${l.level}`}
          position={l.at}
          scale={l.level ? 0.62 : 0.5}
          raycast={noRaycast}
        >
          <spriteMaterial map={l.texture} transparent depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
};
