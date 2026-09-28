import { useSetting } from '../settings';
import type { SettingSpec, SettingValue, SettingValues } from '../settings';
import type { PieceLift } from '../types';

// The player's settings for the pieces and the held piece's light, listed in
// the settings panel in this order under their groups. Read them with
// usePieceSetting.

/** How a piece shows the level it stands on. */
export type LevelCue = 'band' | 'ring' | 'both';

/** The one format for a multiple: one decimal and a times sign ("1.0×"). */
const times = (v: number) => `${v.toFixed(1)}×`;
/** A height in piece units (a king stands 0.87 tall). */
const height = (v: number) => v.toFixed(2);

export const PIECE_SETTINGS: SettingSpec[] = [
  {
    kind: 'choice',
    key: 'piece.levelCue',
    label: 'Level cue',
    group: 'Pieces',
    default: 'band',
    options: [
      { value: 'band', label: 'Band' },
      { value: 'ring', label: 'Ring' },
      { value: 'both', label: 'Both' },
    ],
    hint: "A thin band of the level's colour round each piece's foot, a ring of it on the glass, or both.",
  },
  {
    kind: 'slider',
    key: 'piece.darkTone',
    label: 'Dark army tone',
    group: 'Pieces',
    default: 0.8,
    min: 0.6,
    max: 1.4,
    step: 0.1,
    format: times,
    hint: 'How light the charcoal pieces are: deeper, or lighter to show more of their carving.',
  },
  {
    kind: 'slider',
    key: 'piece.edgeLight',
    label: 'Edge light',
    group: 'Pieces',
    default: 1.1,
    min: 0,
    max: 2,
    step: 0.1,
    format: times,
    hint: "The cool light along the charcoal pieces' edges, that sets them off the night.",
  },
  {
    kind: 'slider',
    key: 'piece.hoverLift',
    label: 'Hover lift',
    group: 'Pieces',
    default: 0.09,
    min: 0,
    max: 0.25,
    step: 0.01,
    format: (v) => (v === 0 ? 'None' : height(v)),
    hint: 'How high a piece rises under the pointer (a king stands 0.87 tall).',
  },
  {
    kind: 'slider',
    key: 'piece.heldGap',
    label: 'Held gap',
    group: 'Pieces',
    default: 0.05,
    min: 0,
    max: 0.2,
    step: 0.01,
    format: (v) => (v === 0 ? 'None' : `+${height(v)}`),
    hint: 'How much higher a held piece rises than one under the pointer.',
  },
  {
    kind: 'choice',
    key: 'piece.knightMoves',
    label: 'Knight moves',
    group: 'Pieces',
    default: 'straight',
    options: [
      { value: 'straight', label: 'Straight' },
      { value: 'arc', label: 'Arc' },
    ],
    hint: 'How a knight travels: in a straight line like every other piece, or leaping over an arc.',
  },
  {
    kind: 'slider',
    key: 'piece.columnHeight',
    label: 'Column height',
    group: 'Selection',
    default: 1.2,
    min: 0.6,
    max: 1.6,
    step: 0.1,
    format: times,
    hint: "The column of light round a held piece: as high as it is lifted, and this much of the piece's height above that.",
  },
  {
    kind: 'slider',
    key: 'piece.columnBrightness',
    label: 'Column brightness',
    group: 'Selection',
    default: 0.8,
    min: 0.6,
    max: 1.6,
    step: 0.1,
    format: times,
    hint: 'How bright the column of light round a held piece glows once it has settled.',
  },
  {
    kind: 'toggle',
    key: 'piece.particles',
    label: 'Glimmering motes',
    group: 'Selection',
    default: true,
    hint: 'Faint motes of light drifting up round a held piece.',
  },
  {
    kind: 'choice',
    key: 'piece.shimmer',
    label: 'Circle shimmer',
    group: 'Selection',
    default: 'off',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'once', label: 'Once' },
      { value: 'slow', label: 'Circling' },
    ],
    hint: 'A glint on the circle at the held piece’s foot: once round as it is picked up, or circling for as long as it is held.',
  },
  {
    kind: 'toggle',
    key: 'piece.clickPulse',
    label: 'Click pulse',
    group: 'Selection',
    default: true,
    hint: 'One ring of light spreading out from the foot as a piece is picked up.',
  },
  {
    kind: 'toggle',
    key: 'piece.checkTint',
    label: 'Whole king red',
    group: 'Check',
    default: true,
    hint: 'The king in check takes the red, cross and all. Off, only the red platform lights his base.',
  },
];

/** One of these settings (see useSetting). */
export const usePieceSetting = <T extends SettingValue>(key: string): T => useSetting<T>(key);

/**
 * How far a piece rises: under the pointer it stirs; held, it rises a little
 * higher, answering the click at once and settling over a longer ease, and
 * holds still.
 */
export const pieceLift = (settings: SettingValues): PieceLift => {
  const hover = settings['piece.hoverLift'] as number;
  const gap = settings['piece.heldGap'] as number;
  return { hover, selected: hover + gap, hoverSeconds: 0.24, selectSeconds: 0.6 };
};
