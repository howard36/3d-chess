// ENV PREVIEW (temporary): the settings the preview deploy's menu offers,
// for the scene to read. See README.md here. Every feature declares itself
// in its own file in ./features, which is all a new feature adds here.

import { useSyncExternalStore } from 'react';
import { envStore } from './store';
import type { EnvFeature } from './registry';

import.meta.glob(['./features/*.ts', '!./features/*.test.ts'], { eager: true });

export { defineEnvFeature, envFeatures, ENV_GROUPS } from './registry';
export type { EnvFeature, EnvOption } from './registry';
export { envStore, createEnvStore, replaceEnvStoreForTest } from './store';
export type { EnvStore } from './store';

type OptionOf<F extends EnvFeature> = F['options'][number]['id'];

const subscribe = (listener: () => void) => envStore.subscribe(listener);

/** A feature's value now, by id or by its declaration (typed then). For code outside React. */
export function getEnvSetting<F extends EnvFeature>(feature: F): OptionOf<F>;
export function getEnvSetting(id: string): string;
export function getEnvSetting(feature: string | EnvFeature) {
  return envStore.get(typeof feature === 'string' ? feature : feature.id);
}

/** Calls `listener` whenever any value changes; returns the unsubscribe. */
export const subscribeEnv = subscribe;

/** A feature's value, re-rendering when it changes. */
export function useEnvSetting<F extends EnvFeature>(feature: F): OptionOf<F>;
export function useEnvSetting(id: string): string;
export function useEnvSetting(feature: string | EnvFeature) {
  const id = typeof feature === 'string' ? feature : feature.id;
  return useSyncExternalStore(subscribe, () => envStore.get(id));
}

/** Changes whenever any value does (EnvRedraw redraws on it). */
export const useEnvVersion = () => useSyncExternalStore(subscribe, () => envStore.version());
