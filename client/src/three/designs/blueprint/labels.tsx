import { useEffect, useMemo, useState } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import type { Orientation } from '../../layout';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout, Vec3 } from '../types';

// Coordinates as a draughtsman letters them: files and ranks in item
// balloons (circles) along the near edges, levels in hexagon tags along the
// edge that recedes into the drawing.

const draw = (text: string, font: string, ink: string, hex: boolean) => {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = ink;
  ctx.fillStyle = 'rgba(13, 63, 148, 0.8)';
  ctx.lineWidth = s * 0.045;
  ctx.beginPath();
  if (hex) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = s / 2 + Math.cos(a) * s * 0.44;
      const y = s / 2 + Math.sin(a) * s * 0.44;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `400 ${s * 0.52}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s / 2, s / 2 + s * 0.04);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

export const DraftLabels = ({
  layout,
  orientation,
  font,
  ink,
}: {
  layout: BoardLayout;
  orientation: Orientation;
  font: string;
  ink: string;
}) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setReady(true);
    if (document.fonts?.load) document.fonts.load(`400 64px ${font}`).then(done, done);
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
      out.push({ text: FILES[i], at: [w(i, 0, 0)[0], -hy - 0.38, hz], level: false });
      out.push({ text: RANKS[i], at: [-hx - 0.38, w(0, i, 0)[1] - 0.1, hz], level: false });
      out.push({ text: LEVELS[i], at: [hx + 0.42, -hy - 0.12, w(0, 0, i)[2]], level: true });
    }
    return out.map((l) => ({ ...l, texture: draw(l.text, font, ink, l.level) }));
  }, [ready, layout, orientation, font, ink]);

  useEffect(() => () => labels.forEach((l) => l.texture.dispose()), [labels]);

  return (
    <group name="board-labels">
      {labels.map((l) => (
        <sprite
          key={`${l.text}-${l.level}`}
          position={l.at}
          scale={l.level ? 0.5 : 0.4}
          raycast={noRaycast}
        >
          <spriteMaterial map={l.texture} transparent depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
};
