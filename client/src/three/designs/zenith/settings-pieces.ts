import { useDesignSetting } from '../settings';
import type { SettingSpec, SettingValue } from '../settings';

// Zenith's player-adjustable settings for this area, listed in the settings
// panel in this order under their groups. Read them with useDesignSetting.

/** How a piece shows the level it stands on. */
export type LevelCue = 'band' | 'ring' | 'both';

const times = (v: number) => `${Number(v.toFixed(2))}×`;

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
    default: 1,
    min: 0.7,
    max: 1.4,
    step: 0.05,
    format: times,
    hint: 'How light the charcoal pieces are: deeper, or lighter to show more of their carving.',
  },
  {
    kind: 'slider',
    key: 'piece.edgeLight',
    label: 'Edge light',
    group: 'Pieces',
    default: 1,
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
    default: 0.08,
    min: 0,
    max: 0.16,
    step: 0.01,
    format: (v) => (v === 0 ? 'none' : v.toFixed(2)),
    hint: 'How far a piece rises under the pointer (held, it rises a little more).',
  },
  {
    kind: 'toggle',
    key: 'piece.hoverGlow',
    label: 'Glow under hovered piece',
    group: 'Pieces',
    default: true,
    hint: 'A soft light on the glass just under a piece you point at.',
  },
  {
    kind: 'slider',
    key: 'piece.columnHeight',
    label: 'Column height',
    group: 'Selection',
    default: 1,
    min: 0.6,
    max: 1.6,
    step: 0.05,
    format: times,
    hint: "The column of light round a held piece, in proportion to the piece's height.",
  },
  {
    kind: 'slider',
    key: 'piece.columnBrightness',
    label: 'Column brightness',
    group: 'Selection',
    default: 1,
    min: 0.4,
    max: 1.6,
    step: 0.05,
    format: times,
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
    default: 'once',
    options: [
      { value: 'once', label: 'Once' },
      { value: 'slow', label: 'Circling' },
      { value: 'off', label: 'Off' },
    ],
    hint: 'A glint running round the circle at the held piece’s foot: once as it is picked up, or slowly round and round.',
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
    label: 'King lit red',
    group: 'Check',
    default: true,
    hint: 'The king in check takes the red, cross and all, lit from below by the red platform.',
  },
];

const DEFAULTS = Object.fromEntries(PIECE_SETTINGS.map((s) => [s.key, s.default]));

/**
 * One of these settings, falling back to its default where the design in
 * context has none (the piece gallery, tests).
 */
export const usePieceSetting = <T extends SettingValue>(key: string): T =>
  (useDesignSetting<T>(key) ?? DEFAULTS[key]) as T;
