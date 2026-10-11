MoveHistory alone in the HUD's wrappers, rendered at phone sizes with a touch pointer (run 20261011-0531, ledger I4).
Copy `probe-history.html` to `client/` and `probeHistory.tsx` to `client/src/dev/`, run `npx vite --port 5199` in `client/`,
then `node shot.mjs 5199 <out dir>` (SIZES='[[w,h],...]' to choose sizes). Prints each step row's right edge against its panel and the window.
