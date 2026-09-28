import { useDesignSetting } from '../settings';
import type { SettingSpec, SettingValue } from '../settings';

// Zenith's player-adjustable settings for this area, listed in the settings
// panel in this order under their groups. Read them with useMarkSetting.

export const CAPTURE_STYLES = ['ember', 'close', 'arcs', 'rise', 'orbit'] as const;
export type CaptureStyle = (typeof CAPTURE_STYLES)[number];

const seconds = (v: number) => `${v.toFixed(1)} s`;
const percent = (v: number) => `${Math.round(v * 100)}%`;

export const MARKER_SETTINGS: SettingSpec[] = [
  {
    kind: 'choice',
    key: 'mark.captureStyle',
    label: 'Capture marker',
    group: 'Markers',
    default: 'rise',
    options: [
      { value: 'rise', label: 'Rising glow' },
      { value: 'ember', label: 'Embers' },
      { value: 'close', label: 'Closing in' },
      { value: 'arcs', label: 'Closing arcs' },
      { value: 'orbit', label: 'Orbiting mote' },
    ],
    hint: 'The red circle round a piece you can take.',
  },
  {
    kind: 'slider',
    key: 'mark.lineStrength',
    label: 'Last-move line',
    group: 'Markers',
    default: 0.55,
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
    kind: 'toggle',
    key: 'mark.checkCrown',
    label: 'Crown over the king',
    group: 'Check',
    default: true,
    hint: 'A small crown of red light floating over the king in check.',
  },
  {
    kind: 'toggle',
    key: 'mark.checkBlades',
    label: 'Blades of light',
    group: 'Check',
    default: false,
    hint: 'Four tall red blades rising round the king in check.',
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
    format: percent,
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
