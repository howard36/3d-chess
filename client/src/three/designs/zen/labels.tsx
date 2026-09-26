import { useEffect, useMemo, useState } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import { GRID_SIZE } from '../../layout';
import type { Orientation } from '../../layout';
import { noRaycast } from '../kit/noRaycast';
import { towerBoardY } from '../kit/layouts';
import type { BoardLayout, Vec3 } from '../types';

// Coordinates brushed in ink: files and ranks along the bottom tray's near
// and left edges, and each level's letter on a vermilion seal beside its
// tray, as a scroll is signed.

const FONT = '"Cormorant Garamond", Georgia, serif';

const draw = (text: string, seal: boolean) => {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (seal) {
    // A rounded-square hanko, its ink uneven at the edge
    const m = size * 0.12;
    const r = size * 0.14;
    ctx.fillStyle = '#b8392a';
    ctx.beginPath();
    ctx.roundRect(m, m, size - 2 * m, size - 2 * m, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(250, 244, 230, 0.9)';
    ctx.lineWidth = size * 0.025;
    ctx.beginPath();
    ctx.roundRect(m * 1.6, m * 1.6, size - 3.2 * m, size - 3.2 * m, r * 0.6);
    ctx.stroke();
    ctx.fillStyle = '#fbf4e4';
    ctx.font = `700 ${size * 0.56}px ${FONT}`;
    ctx.fillText(text, size / 2, size / 2 + size * 0.03);
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 3; i < img.data.length; i += 4) {
      const x = (i >> 2) % size;
      const y = (i >> 2) / size;
      const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      if (s - Math.floor(s) > 0.93) img.data[i] *= 0.55;
    }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.font = `700 ${size * 0.7}px ${FONT}`;
    ctx.shadowColor = 'rgba(255, 250, 238, 1)';
    ctx.shadowBlur = size * 0.14;
    ctx.fillStyle = '#1d1916';
    // Twice over: a denser paper halo lifts the ink off the sand behind it
    ctx.fillText(text, size / 2, size / 2 + size * 0.02);
    ctx.fillText(text, size / 2, size / 2 + size * 0.02);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

interface Anchor {
  text: string;
  position: Vec3;
  seal: boolean;
}

const anchorsFor = (layout: BoardLayout, orientation: Orientation, tray: number): Anchor[] => {
  const n = GRID_SIZE;
  const w = (x: number, y: number, z: number) => layout.toWorld({ x, y, z }, orientation);
  const edge = tray / 2;
  const floor0 = towerBoardY(layout, 0);
  const out: Anchor[] = [];
  for (let x = 0; x < n; x++) {
    out.push({
      text: FILES[x],
      position: [w(x, 0, 0)[0], floor0 - 0.05, edge + 0.4],
      seal: false,
    });
  }
  for (let y = 0; y < n; y++) {
    out.push({
      text: RANKS[y],
      position: [-edge - 0.75, floor0 + 0.1, w(0, y, 0)[2]],
      seal: false,
    });
  }
  for (let z = 0; z < n; z++) {
    out.push({
      text: LEVELS[z],
      position: [-edge - 0.55, towerBoardY(layout, z) + 0.25, edge - 0.35],
      seal: true,
    });
  }
  return out;
};

export const ZenLabels = ({
  layout,
  orientation,
  tray,
}: {
  layout: BoardLayout;
  orientation: Orientation;
  tray: number;
}) => {
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setFontReady(true);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts.load(`700 64px ${FONT}`).then(done, done);
    } else {
      done();
    }
    return () => {
      live = false;
    };
  }, []);

  const labels = useMemo(
    () =>
      fontReady
        ? anchorsFor(layout, orientation, tray).map((a) => ({
            ...a,
            texture: draw(a.text, a.seal),
          }))
        : [],
    [fontReady, layout, orientation, tray],
  );
  useEffect(() => () => labels.forEach((l) => l.texture.dispose()), [labels]);

  return (
    <group name="board-labels">
      {labels.map((l) => (
        <sprite
          key={`${l.text}-${l.seal ? 'level' : 'axis'}`}
          position={l.position}
          scale={l.seal ? 0.52 : 0.62}
          raycast={noRaycast}
        >
          <spriteMaterial
            map={l.texture}
            transparent
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </sprite>
      ))}
    </group>
  );
};
