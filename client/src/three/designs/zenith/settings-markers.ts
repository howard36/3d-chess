import { useDesignSetting } from '../settings';
import type { SettingSpec, SettingValue } from '../settings';

// Zenith's player-adjustable settings for this area, listed in the settings
// panel in this order under their groups. Read them with useMarkSetting.

export const CAPTURE_STYLES = ['arcs', 'rise', 'ember', 'close', 'orbit'] as const;
export type CaptureStyle = (typeof CAPTURE_STYLES)[number];

/** The blades round a king in check (blades.tsx), or none. */
export const BLADE_STYLES = ['shards', 'thorns', 'scythes', 'cracks', 'needles'] as const;
export type BladeStyle = (typeof BLADE_STYLES)[number];

const seconds = (v: number) => `${v.toFixed(1)} s`;
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
    default: 'shards',
    options: [
      { value: 'shards', label: 'Obsidian shards' },
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
    key: 'mark.crownHeight',
    label: 'Crown height',
    group: 'Check',
    default: 0.25,
    min: 0.05,
    max: 0.6,
    step: 0.01,
    format: percent,
    hint: 'How far over the king’s cross the crown floats, as a share of his height. Set low, a lifted king can reach it.',
  },
  {
    kind: 'slider',
    key: 'mark.checkPulse',
    label: 'Check pulse',
    group: 'Check',
    default: 1,
    min: 0.4,
    max: 1.5,
    step: 0.1,
    format: times,
    hint: 'The strike when check arrives.',
  },
  {
    kind: 'slider',
    key: 'mark.mateSeconds',
    label: 'Checkmate pulse',
    group: 'Check',
    default: 2.4,
    min: 1.5,
    max: 4,
    step: 0.1,
    format: seconds,
    hint: 'How long the pulse takes to cross the whole board at mate.',
  },
];

const DEFAULTS = Object.fromEntries(MARKER_SETTINGS.map((s) => [s.key, s.default]));

/** One of this area's settings, falling back to its default outside Zenith (tests, galleries). */
export const useMarkSetting = <T extends SettingValue>(key: string): T =>
  (useDesignSetting<T>(key) ?? DEFAULTS[key]) as T;
