import { useDesignSetting } from '../settings';
import type { SettingSpec, SettingValue } from '../settings';

// Zenith's player-adjustable settings for this area, listed in the settings
// panel in this order under their groups. Read them with useEnvSetting.

const times = (v: number) => `${v.toFixed(1)}×`;

export const ENV_SETTINGS: SettingSpec[] = [
  {
    kind: 'slider',
    key: 'env.checker',
    label: 'Checker',
    group: 'Board',
    default: 0.9,
    min: 0.8,
    max: 1.5,
    step: 0.1,
    format: times,
    hint: 'How strongly the light and dark squares of each level differ.',
  },
  {
    kind: 'slider',
    key: 'env.gridLines',
    label: 'Grid lines',
    group: 'Board',
    default: 1.1,
    min: 0.5,
    max: 1.6,
    step: 0.1,
    format: times,
    hint: 'The thin level-coloured lines between the squares.',
  },
  {
    kind: 'slider',
    key: 'env.giantBoard',
    label: 'Giant board',
    group: 'World',
    default: 1.5,
    min: 0.5,
    max: 2,
    step: 0.1,
    format: times,
    hint: 'Brightness of the colossal 8 × 8 board of light on the ground round the tower.',
  },
  {
    kind: 'slider',
    key: 'env.sculptures',
    label: 'Sculptures',
    group: 'World',
    default: 1,
    min: 0.4,
    max: 1.8,
    step: 0.1,
    format: times,
    hint: 'Brightness of the colossal neon chess pieces round the board.',
  },
  {
    kind: 'slider',
    key: 'env.sculptureFade',
    label: 'Fade near the tower',
    group: 'World',
    default: 1,
    min: 0.7,
    max: 2,
    step: 0.1,
    format: times,
    hint: 'How early a sculpture starts to dim as it passes behind the tower: lower is later.',
  },
  {
    kind: 'toggle',
    key: 'env.lookUp',
    label: 'Look up',
    group: 'World',
    default: true,
    hint: 'Let the view sink below the horizon to look up past the tower into the sky; off, it stops just above level.',
  },
  {
    kind: 'toggle',
    key: 'env.details',
    label: 'Close-look details',
    group: 'World',
    default: true,
    hint: 'Far banks of mist along the horizon and a rare shooting star for a camera looking up.',
  },
  {
    kind: 'toggle',
    key: 'env.constellations',
    label: 'Constellations',
    group: 'World',
    default: true,
    hint: 'Chess pieces drawn in the stars high overhead: look up past the tower to find them.',
  },
  {
    kind: 'toggle',
    key: 'env.stars',
    label: 'Stars',
    group: 'World',
    default: true,
    hint: 'A sparse field of faint stars in the night sky.',
  },
];

const DEFAULTS = Object.fromEntries(ENV_SETTINGS.map((s) => [s.key, s.default]));

/** One of this area's settings, falling back to its default outside Zenith (tests, galleries). */
export const useEnvSetting = <T extends SettingValue>(key: string): T =>
  (useDesignSetting<T>(key) ?? DEFAULTS[key]) as T;
