import { useSetting } from '../settings';
import type { SettingSpec, SettingValue } from '../settings';

// The player's settings for the marks on the board (destinations, the last
// move, check and mate), listed in the settings panel in this order under
// their groups. Read them with useMarkSetting.

export const CAPTURE_STYLES = ['arcs', 'rise', 'ember', 'close', 'orbit'] as const;
export type CaptureStyle = (typeof CAPTURE_STYLES)[number];

/** The blades round a king in check (blades.tsx), or none. */
export const BLADE_STYLES = [
  'shards',
  'clusters',
  'teeth',
  'thorns',
  'scythes',
  'cracks',
  'needles',
] as const;
export type BladeStyle = (typeof BLADE_STYLES)[number];

const percent = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(1)}×`;

export const MARKER_SETTINGS: SettingSpec[] = [
  {
    kind: 'choice',
    key: 'mark.captureStyle',
    label: 'Capture marker',
    group: 'Markers',
    default: 'arcs',
    options: [
      { value: 'arcs', label: 'Turning arcs' },
      { value: 'rise', label: 'Rising glow' },
      { value: 'ember', label: 'Embers' },
      { value: 'close', label: 'Closing in' },
      { value: 'orbit', label: 'Orbiting mote' },
    ],
    hint: 'The red circle round a piece you can take.',
  },
  {
    kind: 'slider',
    key: 'mark.lineStrength',
    label: 'Last-move line',
    group: 'Markers',
    default: 0.7,
    min: 0.35,
    max: 1,
    step: 0.05,
    format: percent,
    hint: 'How bright and thick the line between the last move’s squares is.',
  },
  {
    kind: 'toggle',
    key: 'mark.lineShimmer',
    label: 'Line shimmer',
    group: 'Markers',
    default: true,
    hint: 'A soft light travelling along the last-move line.',
  },
  {
    kind: 'choice',
    key: 'mark.checkBlades',
    label: 'Blades',
    group: 'Check',
    default: 'clusters',
    options: [
      { value: 'shards', label: 'Obsidian shards' },
      { value: 'clusters', label: 'Obsidian clusters' },
      { value: 'teeth', label: 'Obsidian teeth' },
      { value: 'thorns', label: 'Iron thorns' },
      { value: 'scythes', label: 'Scythes' },
      { value: 'cracks', label: 'Cracked glass' },
      { value: 'needles', label: 'Needles' },
      { value: 'off', label: 'Off' },
    ],
    hint: 'Dark, keen shapes of threat round the king in check.',
  },
  {
    kind: 'toggle',
    key: 'mark.checkCrown',
    label: 'Crown over the king',
    group: 'Check',
    default: false,
    hint: 'A small crown of red light floating over the king in check.',
  },
  {
    kind: 'slider',
    key: 'mark.crownGap',
    label: 'Crown height',
    group: 'Check',
    default: 0.08,
    min: 0.02,
    max: 0.4,
    step: 0.01,
    format: (v) => `+${v.toFixed(2)}`,
    hint: 'How far the crown floats over the king’s cross when he is held up (a king stands 0.87 tall); it stays there whether he is lifted or not.',
  },
  {
    kind: 'slider',
    key: 'mark.checkPulse',
    label: 'Check pulse',
    group: 'Check',
    default: 0.8,
    min: 0.4,
    max: 1.5,
    step: 0.1,
    format: times,
    hint: 'The strike when check arrives.',
  },
  {
    kind: 'slider',
    key: 'mark.mateSpeed',
    label: 'Checkmate pulse',
    group: 'Check',
    default: 1,
    min: 0.6,
    max: 1.6,
    step: 0.1,
    format: times,
    hint: "How fast the pulse spreads across the mated king's level.",
  },
];

/** One of these settings (see useSetting). */
export const useMarkSetting = <T extends SettingValue>(key: string): T => useSetting<T>(key);
