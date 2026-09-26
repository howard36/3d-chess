import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, MeshPhysicalMaterial, SRGBColorSpace } from 'three';
import type { Group } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import type { Orientation } from '../../layout';
import { noRaycast } from '../kit/noRaycast';
import type { Vec3 } from '../types';
import { FLOORS, HALF_TRAY, layout, LEVEL_PAINT, NAVY } from './shared';

// The board's coordinates in the Toy Box: files and ranks as chunky
// outlined letters round the bottom tray, and each level's letter on a
// wooden alphabet block floating beside its tray, lettered in the tray's
// own colour.

const FONT = '"Fredoka", sans-serif';

const draw = (paint: (ctx: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  paint(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

const letter = (ctx: CanvasRenderingContext2D, px: number) => {
  ctx.font = `700 ${px}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
};

/** A navy letter with a fat white outline, readable on sky and tray alike. */
const stickerLetter = (text: string) =>
  draw((ctx) => {
    letter(ctx, 88);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 18;
    ctx.strokeText(text, 64, 70);
    ctx.fillStyle = NAVY;
    ctx.fillText(text, 64, 70);
  });

/** One face of an alphabet block: cream wood, a coloured border, a big letter. */
const blockFace = (text: string, color: string) =>
  draw((ctx) => {
    ctx.fillStyle = '#fff4de';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = color;
    ctx.lineWidth = 9;
    ctx.strokeRect(14, 14, 100, 100);
    letter(ctx, 84);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 71);
  });

const blockGeometry = new RoundedBoxGeometry(0.58, 0.58, 0.58, 3, 0.08);

const useFontReady = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setReady(true);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts.load(`700 64px ${FONT}`).then(done, done);
    } else {
      done();
    }
    return () => {
      live = false;
    };
  }, []);
  return ready;
};

export const ToyLabels = ({ orientation }: { orientation: Orientation }) => {
  const ready = useFontReady();
  const blocks = useRef<(Group | null)[]>([]);

  const labels = useMemo(() => {
    if (!ready) return null;
    const bottom = FLOORS[0] + 0.03;
    const axis: { text: string; position: Vec3 }[] = [
      ...FILES.map((text, x) => ({
        text,
        position: [
          layout.toWorld({ x, y: 0, z: 0 }, orientation)[0],
          bottom,
          HALF_TRAY + 0.36,
        ] as Vec3,
      })),
      ...RANKS.map((text, y) => ({
        text,
        position: [
          -HALF_TRAY - 0.36,
          bottom,
          layout.toWorld({ x: 0, y, z: 0 }, orientation)[2],
        ] as Vec3,
      })),
    ];
    return {
      axis: axis.map((a) => ({ ...a, texture: stickerLetter(a.text) })),
      levels: LEVELS.map((text, z) => {
        const map = blockFace(text, LEVEL_PAINT[z].tray);
        return {
          text,
          map,
          material: new MeshPhysicalMaterial({
            map,
            roughness: 0.45,
            clearcoat: 0.6,
            clearcoatRoughness: 0.25,
          }),
        };
      }),
    };
  }, [ready, orientation]);

  useEffect(
    () => () => {
      labels?.axis.forEach((a) => a.texture.dispose());
      labels?.levels.forEach((l) => {
        l.map.dispose();
        l.material.dispose();
      });
    },
    [labels],
  );

  // The blocks bob and turn a little, like toys hung on strings.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    blocks.current.forEach((b, z) => {
      if (!b) return;
      b.position.y = FLOORS[z] + 0.34 + Math.sin(t * 1.3 + z * 1.7) * 0.05;
      b.rotation.y = 0.35 + Math.sin(t * 0.6 + z) * 0.18;
      b.rotation.z = Math.sin(t * 0.9 + z * 2.3) * 0.05;
    });
  });

  if (!labels) return null;
  return (
    <group name="board-labels">
      {labels.axis.map((a) => (
        <sprite key={a.text} position={a.position} scale={0.42} raycast={noRaycast}>
          <spriteMaterial map={a.texture} transparent depthWrite={false} toneMapped={false} />
        </sprite>
      ))}
      {labels.levels.map((l, z) => (
        <group
          key={l.text}
          ref={(g) => {
            blocks.current[z] = g;
          }}
          position={[-HALF_TRAY - 1.55, FLOORS[z] + 0.34, 0.6]}
        >
          <mesh geometry={blockGeometry} material={l.material} raycast={noRaycast} />
        </group>
      ))}
    </group>
  );
};
