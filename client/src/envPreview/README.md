# Env preview (temporary)

A settings menu for trying environment (garden and sky) features on the Cloudflare Pages
preview of a branch. It is all here, plus a few hook points marked `ENV PREVIEW (temporary)`
(`grep -rn "ENV PREVIEW" client/`). Before the final merge each feature's chosen option is
baked in and this directory and the hook points are deleted.

## Adding a feature

One new file, `features/<feature>.ts` (found by `index.ts`, no list to edit):

```ts
import { defineEnvFeature } from '../registry';

export const aurora = defineEnvFeature({
  id: 'aurora', // in the address: ?env=aurora:soft
  label: 'Aurora',
  group: 'Sky', // 'Sky' | 'Constellations' | 'Horizon' | 'Garden' | 'Events' (or a new one)
  options: [
    { id: 'off', label: 'Off' }, // today's look
    { id: 'soft', label: 'Soft' },
    { id: 'bold', label: 'Bold' },
  ],
  default: 'soft', // the recommended choice
  // baseline: 'on', // only if `off` is not today's look (or there is no `off`)
});
```

An on/off toggle is exactly the options `off` and `on` (the menu draws a switch).

## Reading it in the scene

```tsx
import { useEnvSetting } from '../../envPreview'; // from src/three/scene/
import { aurora } from '../../envPreview/features/aurora';

const mode = useEnvSetting(aurora); // 'off' | 'soft' | 'bold', re-renders on change
// or useEnvSetting('aurora') (a string); outside React:
// getEnvSetting('aurora'), subscribeEnv(() => ...)
```

The canvas redraws by itself after a change (`EnvRedraw`, in `Stage`), and the garden's
copy (`three/scene/backdropCache.tsx`) is not shown stale as long as the change shows in an
object mounted or unmounted, a visibility or a uniform (`envRedraw.test.tsx`). Prefer
mounting a feature only when it is on: `off` then costs nothing and is exactly main.

## Where a value comes from

1. "Baseline (main)" on the menu (or the B key): every feature at its baseline.
2. The address the page was opened at: `?env=aurora:bold,mist:on`. `baseline` or
   `recommended` in the list sets every feature to its baseline or default; pairs after it
   win (`?env=baseline,aurora:soft`).
3. The last choice on the menu (localStorage, this device).
4. The feature's default.

The preview is on only on a preview host (`*.3d-chess.pages.dev`) or with `?env` or
`?envpanel` in the address (local dev: `http://127.0.0.1:5173/?envpanel`). Otherwise
(production, e2e) every feature is its default, nothing is read from the address or
storage, and the menu's code never loads. `envpanel=0` applies `?env` without the menu
(captures).

## The menu

A pill at the bottom right (top right on a phone): A/B toggles today's main, the sliders
open the menu: a section per group, Baseline (main), Reset to recommended, and Copy link
(this page with every feature's value in `?env=`; a game's page becomes `/computer`).

## Capturing

Only Vite needs to run (`npm run dev`); in a remote container prefix with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`.

```bash
# The same six views (white, black, phone, sky, top, lobby) for each combo, and a sheet
node scripts/envshots.mjs --out /tmp/shots --combo off=baseline --combo soft=aurora:soft
#   --views white,sky   --sky "-14,0.7,30" / --top "48,1.5,0" (elevation, zoom, turn)
# Any showcase mode with a combo. --lobby needs only Vite; the others (the game, --stills,
# --orbit, --intro, --review) seat two players through a local backend:
#   (cd ../server && uv run --extra test uvicorn modal_app:create_web_app --factory --port 8000)
#   VITE_WS_URL=ws://127.0.0.1:8000/ws npm run dev
node scripts/showcase.mjs --orbit --stills --query 'env=aurora:soft' --out /tmp/orbit
```
