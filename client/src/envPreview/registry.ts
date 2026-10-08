// ENV PREVIEW (temporary): the features the settings menu offers. Each
// feature declares itself in its own file under ./features (picked up by
// ./index.ts, no list to edit), with defineEnvFeature.

export interface EnvOption {
  /** In the address (`?env=feature:option`): letters, digits, `-` and `_`. */
  id: string;
  /** On the menu's button. */
  label: string;
}

export interface EnvFeature {
  /** In the address and in code: letters, digits, `-` and `_`, starting with a letter. */
  id: string;
  /** On the menu. */
  label: string;
  /** The menu's section: 'Sky', 'Constellations', 'Horizon', 'Garden', 'Events' (or a new one). */
  group: string;
  /** Mutually exclusive choices; an on/off toggle is exactly `off` and `on`. */
  options: readonly EnvOption[];
  /** The recommended choice: what the page shows unless told otherwise. */
  default: string;
  /** The choice that looks like today's main (`off` if not given). */
  baseline?: string;
  /** Sorts features within a group (then by label). */
  order?: number;
  /** A word or two under the label on the menu, for what the board can't show. */
  note?: string;
}

/** The sections, in the menu's order; any other group follows, alphabetically. */
export const ENV_GROUPS = ['Sky', 'Constellations', 'Horizon', 'Garden', 'Events'];

const ID = /^[A-Za-z][\w-]*$/;
const OPTION = /^[\w-]+$/;

const features: EnvFeature[] = [];

/** The choice that looks like today's main. */
export const baselineOf = (f: EnvFeature) => f.baseline ?? 'off';

/**
 * Declares a feature for the settings menu and returns it (pass it to
 * useEnvSetting for a typed value). A feature declared again (a hot update)
 * replaces the old declaration.
 */
export function defineEnvFeature<const F extends EnvFeature>(feature: F): F {
  const { id, options } = feature;
  const fail = (why: string) => {
    throw new Error(`defineEnvFeature(${id}): ${why}`);
  };
  if (!ID.test(id)) fail('the id must be letters, digits, - or _, starting with a letter');
  if (!options.length) fail('no options');
  const ids = options.map((o) => o.id);
  for (const o of ids) if (!OPTION.test(o)) fail(`option "${o}" must be letters, digits, - or _`);
  if (new Set(ids).size !== ids.length) fail('two options share an id');
  if (!ids.includes(feature.default)) fail(`the default "${feature.default}" is not an option`);
  if (!ids.includes(baselineOf(feature)))
    fail(`no "${baselineOf(feature)}" option: give "baseline", the option that looks like main`);
  const at = features.findIndex((f) => f.id === id);
  if (at >= 0) features[at] = feature;
  else features.push(feature);
  return feature;
}

/** Every feature, in the menu's order (by group, then order, then label). */
export const envFeatures = (): readonly EnvFeature[] => {
  const rank = (g: string) => {
    const i = ENV_GROUPS.indexOf(g);
    return i < 0 ? ENV_GROUPS.length : i;
  };
  return [...features].sort(
    (a, b) =>
      rank(a.group) - rank(b.group) ||
      a.group.localeCompare(b.group) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      a.label.localeCompare(b.label),
  );
};

/** The feature with this id, if declared. */
export const envFeature = (id: string) => features.find((f) => f.id === id);

/** For tests: forget every feature (returns them, to put back with restore). */
export const takeEnvFeaturesForTest = () => features.splice(0, features.length);
export const restoreEnvFeaturesForTest = (list: EnvFeature[]) => {
  features.splice(0, features.length, ...list);
};
