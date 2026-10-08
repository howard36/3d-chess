// ENV PREVIEW (temporary): the only part of the preview layer in the entry.
// It decides, from the address the page was opened at, whether the preview
// settings apply and whether the menu loads. It imports nothing; keep it
// tiny (it ships on the start page).

/** Where the page was opened (captured once: in-app navigation drops the query). */
export interface EnvStart {
  host: string;
  search: string;
}

export const envStart: EnvStart | null =
  typeof location === 'undefined' ? null : { host: location.hostname, search: location.search };

/** A Cloudflare Pages preview of this repo (production is not on this domain). */
export const isPreviewHost = (host: string) => host.endsWith('.3d-chess.pages.dev');

const param = (search: string, name: string) => new URLSearchParams(search).get(name);

/** The preview's settings apply: a preview deploy, or `?env` / `?envpanel` in the address. */
export const envPreviewOn = (start: EnvStart | null = envStart) =>
  !!start &&
  (isPreviewHost(start.host) ||
    param(start.search, 'env') !== null ||
    param(start.search, 'envpanel') !== null);

/** The menu loads: the preview is on and the address does not say `envpanel=0` (captures). */
export const envPanelOn = (start: EnvStart | null = envStart) =>
  envPreviewOn(start) && param(start!.search, 'envpanel') !== '0';
