import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace, Vector3 } from 'three';
import type { Sprite, SpriteMaterial, Texture } from 'three';
import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import type { Orientation } from '../../layout';
import { LAYER } from './layers';
import { labelAnchors } from './labelAnchors';
import type { AnchorOptions, AnchorState, LabelAnchor } from './labelAnchors';
import { noRaycast } from './noRaycast';
import type { BoardLayout, Vec3 } from '../types';

export interface SmartLabelStyle {
  /** CSS font family. */
  font?: string;
  /** CSS font weight. */
  weight?: number | string;
  color?: string;
  /** Outline drawn around each glyph (keeps it legible over anything). */
  outline?: string;
  /** Outline thickness, as a fraction of the glyph size (0 for none). */
  outlineWidth?: number;
  /** Soft shadow or glow colour behind the glyphs. */
  shadow?: string;
  /** World height of a file or rank label at the reference distance. */
  size?: number;
  opacity?: number;
  /** Level letters are drawn this much larger. */
  levelScale?: number;
  /** One colour per level letter, A to E (e.g. matching the platform tints). */
  levelColors?: string[];
  /** Font weight of the level letters (default: `weight`). */
  levelWeight?: number | string;
}

export interface SmartLabelsProps extends SmartLabelStyle, AnchorOptions {
  layout: BoardLayout;
  orientation: Orientation;
  /**
   * How labels keep legible as the camera zooms: 0 keeps their world size
   * (they shrink with distance like everything else), 1 keeps their size on
   * screen. In between grows them part of the way.
   */
  distanceScaling?: number;
  /** Camera distance at which labels are exactly `size` (default: the opening view's). */
  referenceDistance?: number;
  /** Length of the crossfade when a label moves to another edge or corner. */
  fadeMs?: number;
  /** Test against depth, so pieces can hide labels (they sit outside the tower, so off by default). */
  depthTest?: boolean;
  /**
   * The level whose letter to emphasise (usually `focusLevelOf(focus)` from
   * GridProps): it grows by `focusScale` while the other letters dim to
   * `focusDim` of their opacity, eased over `focusMs`. Null or unset for none.
   */
  focusLevel?: number | null;
  focusScale?: number;
  focusDim?: number;
  focusMs?: number;
}

const drawGlyph = (
  text: string,
  font: string,
  color: string,
  outline: string | undefined,
  outlineWidth: number,
  shadow: string | undefined,
): Texture => {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.font = font.replace('{px}', `${Math.round(size * 0.66)}`);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = size / 2;
  const y = size / 2 + size * 0.04;
  if (shadow) {
    ctx.shadowColor = shadow;
    ctx.shadowBlur = size * 0.1;
  }
  if (outline && outlineWidth > 0) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outline;
    ctx.lineWidth = size * outlineWidth * 2;
    ctx.strokeText(text, x, y);
    ctx.shadowColor = 'transparent';
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

interface Slot {
  key: string;
  /** Which of the label's two sprites shows its current anchor. */
  active: 0 | 1;
  positions: [Vec3, Vec3];
  fades: [number, number];
}

const origin = new Vector3();

/**
 * Coordinate labels for a tower layout that follow the camera: files a–e and
 * ranks 1–5 just outside the two edges of the bottom platform (or of every
 * platform) nearest the camera, and each level letter A–E beside its own
 * platform at the corner furthest left on screen, so no label ever sits
 * inside or behind the tower, from either seat. When an orbit carries a label
 * to another edge or corner (past a hysteresis band), it crossfades there
 * rather than jumping. Labels are camera-facing sprites and grow part of the
 * way with distance (`distanceScaling`), so they stay legible zoomed out
 * without swamping a close view. Drawn last, over everything (LAYER.label).
 */
export const SmartLabels = ({
  layout,
  orientation,
  font = 'system-ui, sans-serif',
  weight = 600,
  color = '#e8edf5',
  outline = 'rgba(10, 14, 22, 0.85)',
  outlineWidth = 0.07,
  shadow,
  size = 0.36,
  opacity = 0.9,
  levelScale = 1.45,
  levelColors,
  levelWeight,
  distanceScaling = 0.5,
  referenceDistance,
  fadeMs = 240,
  depthTest = false,
  focusLevel = null,
  focusScale = 1.3,
  focusDim = 0.5,
  focusMs = 150,
  ...anchorOptions
}: SmartLabelsProps) => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;
  const invalidate = useThree((s) => s.invalidate);

  // Draw once the font is ready: a canvas drawn before then silently uses a
  // fallback face and never updates.
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setFontReady(true);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      Promise.all([
        document.fonts.load(`${weight} 64px ${font}`),
        document.fonts.load(`${levelWeight ?? weight} 64px ${font}`),
      ]).then(done, done);
    } else {
      done();
    }
    return () => {
      live = false;
    };
  }, [font, weight, levelWeight]);

  // Per-level colours compared by value, so an inline array does not redraw
  const levelColorKey = JSON.stringify(levelColors ?? null);
  const textures = useMemo(() => {
    const levelColors = JSON.parse(levelColorKey) as string[] | null;
    const map = new Map<string, Texture>();
    if (!fontReady) return map;
    const axisFont = `${weight} {px}px ${font}`;
    for (const t of [...FILES, ...RANKS]) {
      map.set(t, drawGlyph(t, axisFont, color, outline, outlineWidth, shadow));
    }
    LEVELS.forEach((t, z) => {
      map.set(
        `level-${t}`,
        drawGlyph(
          t,
          `${levelWeight ?? weight} {px}px ${font}`,
          levelColors?.[z] ?? color,
          outline,
          outlineWidth,
          shadow,
        ),
      );
    });
    return map;
  }, [fontReady, font, weight, levelWeight, color, outline, outlineWidth, shadow, levelColorKey]);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  // The label set is fixed for a layout; only where each one sits changes.
  const ids = useMemo(
    () => labelAnchors(layout, orientation, [0, 5, 20], [0, 0, 0], null, anchorOptions).labels,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the set depends on everyLevel only
    [layout, orientation, anchorOptions.everyLevel],
  );

  const sprites = useRef(new Map<string, [Sprite | null, Sprite | null]>());
  const slots = useRef(new Map<string, Slot>());
  const state = useRef<AnchorState | null>(null);
  const reference = useRef<number | null>(referenceDistance ?? null);
  const options = useRef(anchorOptions);
  options.current = anchorOptions;
  // Eased emphasis per level letter, and how much any level is focused
  const emphasis = useRef<number[]>([0, 0, 0, 0, 0]);
  const anyFocus = useRef(0);
  useEffect(() => invalidate(), [focusLevel, invalidate]);

  // New anchors (another orientation or layout) start over without a fade
  useEffect(() => {
    slots.current.clear();
    state.current = null;
    invalidate();
  }, [layout, orientation, invalidate]);

  useFrame((_, delta) => {
    const target = controls?.target ?? origin;
    const cam: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
    const tgt: Vec3 = [target.x, target.y, target.z];
    const first = state.current === null;
    const { state: next, labels } = labelAnchors(
      layout,
      orientation,
      cam,
      tgt,
      state.current,
      options.current,
    );
    state.current = next;
    const distance = camera.position.distanceTo(target);
    reference.current ??= distance;
    const grow = Math.min(Math.max((distance / reference.current) ** distanceScaling, 0.6), 2);
    const step = fadeMs > 0 ? Math.min(delta, 1 / 20) / (fadeMs / 1000) : 1;
    let moving = false;
    const focusStep = focusMs > 0 ? Math.min(delta, 1 / 20) / (focusMs / 1000) : 1;
    const ease = (v: number, goal: number) =>
      goal > v ? Math.min(goal, v + focusStep) : Math.max(goal, v - focusStep);
    emphasis.current = emphasis.current.map((w, z) => {
      const goal = z === focusLevel ? 1 : 0;
      const next = ease(w, goal);
      if (next !== goal) moving = true;
      return next;
    });
    const anyGoal = focusLevel === null ? 0 : 1;
    anyFocus.current = ease(anyFocus.current, anyGoal);
    if (anyFocus.current !== anyGoal) moving = true;
    for (const label of labels) {
      let slot = slots.current.get(label.id);
      if (!slot) {
        slot = {
          key: label.key,
          active: 0,
          positions: [label.position, label.position],
          fades: [first ? 1 : 0, 0],
        };
        slots.current.set(label.id, slot);
      } else if (slot.key !== label.key) {
        // Crossfade: the idle sprite takes the new anchor and fades in
        slot.key = label.key;
        slot.active = slot.active === 0 ? 1 : 0;
        slot.fades[slot.active] = 0;
      }
      slot.positions[slot.active] = label.position;
      for (const i of [0, 1] as const) {
        const goal = i === slot.active ? 1 : 0;
        const f = slot.fades[i];
        slot.fades[i] = goal > f ? Math.min(goal, f + step) : Math.max(goal, f - step);
        if (slot.fades[i] !== goal) moving = true;
        const sprite = sprites.current.get(label.id)?.[i];
        if (!sprite) continue;
        const fade = slot.fades[i];
        sprite.visible = fade > 0.001;
        sprite.position.set(...slot.positions[i]);
        const w = label.level !== undefined ? emphasis.current[label.level] : 0;
        const s =
          size * grow * (label.level !== undefined ? levelScale * (1 + (focusScale - 1) * w) : 1);
        sprite.scale.set(s, s, 1);
        const dim = label.level !== undefined ? 1 - anyFocus.current * (1 - focusDim) * (1 - w) : 1;
        (sprite.material as SpriteMaterial).opacity = opacity * fade * dim;
      }
    }
    if (moving) invalidate();
  });

  if (!fontReady) return null;
  return (
    <group name="smart-labels">
      {ids.map((label: LabelAnchor) =>
        [0, 1].map((i) => (
          <sprite
            key={`${label.id}/${i}`}
            ref={(s) => {
              const pair = sprites.current.get(label.id) ?? [null, null];
              pair[i] = s;
              sprites.current.set(label.id, pair);
            }}
            visible={false}
            renderOrder={LAYER.label}
            raycast={noRaycast}
          >
            <spriteMaterial
              map={textures.get(label.level !== undefined ? `level-${label.text}` : label.text)}
              transparent
              depthWrite={false}
              depthTest={depthTest}
              toneMapped={false}
              fog={false}
            />
          </sprite>
        )),
      )}
    </group>
  );
};
