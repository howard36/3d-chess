import type { SettingSpec } from '../settings';
import { ENV_SETTINGS } from './settings-env';
import { MARKER_SETTINGS } from './settings-markers';
import { PIECE_SETTINGS } from './settings-pieces';

// The settings panel lists groups in the order they first appear: board and
// world first, then the pieces and how they are held, then the marks on the
// board, and check (with the mate) last
const GROUP_ORDER = ['Board', 'World', 'Pieces', 'Selection', 'Markers', 'Check'];
const rank = (group: string) => {
  const i = GROUP_ORDER.indexOf(group);
  return i < 0 ? GROUP_ORDER.length : i;
};

let ordered: SettingSpec[] | null = null;

/**
 * Every setting the player may adjust, with its default, in the settings
 * panel's order. Built on first use: the settings store and the modules
 * that declare the settings import each other.
 */
export const settingSpecs = (): SettingSpec[] =>
  (ordered ??= [...ENV_SETTINGS, ...PIECE_SETTINGS, ...MARKER_SETTINGS]
    .map((spec, i) => ({ spec, i }))
    .sort((a, b) => rank(a.spec.group) - rank(b.spec.group) || a.i - b.i)
    .map(({ spec }) => spec));
