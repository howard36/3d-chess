import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace, Vector3 } from 'three';
import type { Group, Sprite, SpriteMaterial, Texture } from 'three';
import { FILES, LEVELS, RANKS } from '../../engine/coords';
import type { Orientation } from '../layout';
import { LAYER } from './layers';
import { LABEL_SIZE, labelAnchors } from './labelAnchors';
import type { AnchorState, LabelAnchor } from './labelAnchors';
import { noRaycast } from '../noRaycast';
import { LEVEL_COLORS, PALETTE } from './palette';
import type { BoardLayout, Vec3 } from '../types';
import { useIntro } from '../intro/clock';
import { labelFade } from '../intro/timeline';
import { smooth } from './ease';

// How the labels are drawn. Manrope's double-storey "a" never reads as "o";
// its "1" has a flag.
const FONT = '"Manrope", system-ui, sans-serif';
const AXIS_WEIGHT = 600;
const LEVEL_WEIGHT = 700;
const OUTLINE = 'rgba(2, 3, 7, 0.9)';
const OUTLINE_WIDTH = 0.08;
const SHADOW = 'rgba(200, 215, 255, 0.25)';
const OPACITY = 0.9;
/** How much the labels of the levels other than the one in play dim (to this share of their opacity). */
const FOCUS_DIM = 0.55;
/** Length of the crossfade when a label moves to another edge or corner. */
const FADE_MS = 240;
/** Length of the ease when the level in play changes. */
const FOCUS_MS = 150;
/**
 * How labels keep legible as the camera zooms: 0 keeps their world size
 * (they shrink with distance like everything else), 1 keeps their size on
 * screen. In between grows them part of the way, from the opening view's
 * distance.
 */
const DISTANCE_SCALING = 0.5;

const drawGlyph = (text: string, weight: number, color: string): Texture => {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.font = `${weight} ${Math.round(size * 0.66)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = size / 2;
  const y = size / 2 + size * 0.04;
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = size * 0.1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = size * OUTLINE_WIDTH * 2;
  ctx.strokeText(text, x, y);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

export interface Slot {
  key: string;
  /** Which of the label's two sprites shows its current anchor. */
  active: 0 | 1;
  /** The anchor (its key) each sprite stands at. */
  keys: [string, string];
  positions: [Vec3, Vec3];
  fades: [number, number];
}

/**
 * A label's two sprites once its anchor changes to `key`: the fainter one
 * takes the new anchor and fades in from nothing while the other fades out
 * where it stands, so however quickly the anchor changes again (an orbit
 * crossing two boundaries a degree apart), what shows only ever fades, never
 * jumps. Back to the anchor the other sprite still stands at, that one fades
 * back in from where it is.
 */
export const retarget = (slot: Slot, key: string): Slot => {
  if (key === slot.key) return slot;
  const other = slot.active === 0 ? 1 : 0;
  if (slot.keys[other] === key) return { ...slot, key, active: other };
  const faint = slot.fades[0] <= slot.fades[1] ? 0 : 1;
  const keys: [string, string] = [...slot.keys];
  const fades: [number, number] = [...slot.fades];
  keys[faint] = key;
  fades[faint] = 0;
  return { ...slot, key, active: faint, keys, fades };
};

const origin = new Vector3();

/**
 * Where a label comes in the entrance's settling (0 first, 1 last): the
 * letters up their post from A, the files and the ranks along their edges
 * from a and 1.
 */
const entranceOrder = (label: LabelAnchor) =>
  label.level !== undefined
    ? label.level / 4
    : Math.max(FILES.indexOf(label.text), RANKS.indexOf(label.text), 0) / 4;

/**
 * Coordinate labels for a tower layout that follow the camera: files a–e and
 * ranks 1–5 just outside the two edges of the bottom platform nearest the
 * camera, and the level letters A–E up one corner post,
 * each beside its own platform's corner: from low down a column up the side
 * of the tower's outline that carries no labels, from high up a short line
 * along the diagonal of the corner across from the files and ranks, never in
 * line with them, from either seat (labelAnchors). From a camera that dips
 * under 6° (the orbit sinks below the horizon), files and ranks fade as
 * their platform comes edge-on and take its far edges once the camera is
 * under it; the level letters stay. When an orbit or a climb carries labels
 * to another edge or post (past a hysteresis band), they crossfade there
 * rather than jumping, the five letters together. Labels are camera-facing
 * sprites and grow part of the way with distance (DISTANCE_SCALING), so
 * they stay legible zoomed out without swamping a close view. Drawn last
 * (LAYER.label), after the platforms, so only a piece in front of a label
 * hides it: they are depth-tested, and the glass, its border and its rim
 * write no depth.
 * Each sprite carries its label's id (userData.labelId) and the group the
 * current choice of edges and corner (userData.anchors), for tests and tools.
 * In the game's entrance (intro/timeline.ts) they settle in once the tower
 * is up, and grow from the fitted view's distance, not the entrance's camera
 * still far out.
 */
export const SmartLabels = ({
  layout,
  orientation,
  focusLevel,
}: {
  layout: BoardLayout;
  orientation: Orientation;
  /**
   * The level whose letter to emphasise (`focusLevelOf(focus)` from
   * GridProps): the other letters dim while it is set, eased over FOCUS_MS.
   */
  focusLevel: number | null;
}) => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;
  const invalidate = useThree((s) => s.invalidate);
  const intro = useIntro();

  // Draw once the font is ready: a canvas drawn before then silently uses a
  // fallback face and never updates.
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setFontReady(true);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      Promise.all([
        document.fonts.load(`${AXIS_WEIGHT} 64px ${FONT}`),
        document.fonts.load(`${LEVEL_WEIGHT} 64px ${FONT}`),
      ]).then(done, done);
    } else {
      done();
    }
    return () => {
      live = false;
    };
  }, []);

  const textures = useMemo(() => {
    const map = new Map<string, Texture>();
    if (!fontReady) return map;
    for (const t of [...FILES, ...RANKS]) map.set(t, drawGlyph(t, AXIS_WEIGHT, PALETTE.ink));
    LEVELS.forEach((t, z) => map.set(`level-${t}`, drawGlyph(t, LEVEL_WEIGHT, LEVEL_COLORS[z])));
    return map;
  }, [fontReady]);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  // The label set is fixed for a layout; only where each one sits changes.
  const ids = useMemo(
    () => labelAnchors(layout, orientation, [0, 5, 20], [0, 0, 0], null).labels,
    [layout, orientation],
  );

  const group = useRef<Group>(null);
  const sprites = useRef(new Map<string, [Sprite | null, Sprite | null]>());
  const slots = useRef(new Map<string, Slot>());
  const state = useRef<AnchorState | null>(null);
  const reference = useRef<number | null>(null);
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
    const { state: next, labels } = labelAnchors(layout, orientation, cam, tgt, state.current);
    state.current = next;
    if (group.current) group.current.userData.anchors = next;
    const distance = camera.position.distanceTo(target);
    // The view as fitted, even while the entrance's camera is still far out
    reference.current ??= (camera.userData.fitDistance as number | undefined) ?? distance;
    const grow = Math.min(Math.max((distance / reference.current) ** DISTANCE_SCALING, 0.6), 2);
    const step = Math.min(delta, 1 / 20) / (FADE_MS / 1000);
    let moving = false;
    const focusStep = Math.min(delta, 1 / 20) / (FOCUS_MS / 1000);
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
          keys: [label.key, ''],
          positions: [label.position, label.position],
          fades: [first ? 1 : 0, 0],
        };
        slots.current.set(label.id, slot);
      } else if (slot.key !== label.key) {
        // Crossfade to the new anchor
        slot = retarget(slot, label.key);
        slots.current.set(label.id, slot);
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
        sprite.position.set(...slot.positions[i]);
        const w = label.level !== undefined ? emphasis.current[label.level] : 0;
        // The entrance: the letters settle in up their post, A first, the
        // files and ranks along their edges, each easing down from a little larger
        const arrive = smooth(labelFade(intro.plan, intro.t, entranceOrder(label)));
        const s = LABEL_SIZE * grow * (1 + 0.3 * (1 - arrive) ** 2);
        sprite.scale.set(s, s, 1);
        const dim =
          label.level !== undefined ? 1 - anyFocus.current * (1 - FOCUS_DIM) * (1 - w) : 1;
        // A file or rank on a platform seen edge-on fades (labelAnchors' axisView)
        const seen = label.opacity ?? 1;
        sprite.visible = fade * seen * arrive > 0.001;
        (sprite.material as SpriteMaterial).opacity = OPACITY * fade * dim * seen * arrive;
      }
    }
    if (moving) invalidate();
  });

  if (!fontReady) return null;
  return (
    <group name="smart-labels" ref={group}>
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
            userData={{ labelId: label.id }}
            renderOrder={LAYER.label}
            raycast={noRaycast}
          >
            <spriteMaterial
              map={textures.get(label.level !== undefined ? `level-${label.text}` : label.text)}
              transparent
              depthWrite={false}
              depthTest
              toneMapped={false}
              fog={false}
            />
          </sprite>
        )),
      )}
    </group>
  );
};
