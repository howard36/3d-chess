---
name: check
description: Run the full CI-equivalent locally before committing or opening a PR — client lint, build, vitest with coverage, server ruff + pytest, and both generated-protocol-type freshness gates. Use after finishing a change or when asked to verify everything passes.
---

Run every step from the repo root; report each step's pass/fail with the failing output verbatim. Do not stop at the first failure — run them all so the user sees the whole picture.

Optional argument: `$ARGUMENTS` may be `client`, `server`, or `e2e` to run only that group.

1. Client (in `client/`): `npm run lint`, `npm run build`, `npm run test -- --coverage`.
   Coverage thresholds (90%) apply only to `src/engine/**` (hooks/lib are reported, not gated). The `not configured to support act(...)` warnings from the r3f test renderer are expected noise.
2. Client codegen gate (in `client/`): `npm run generate:types && git diff --exit-code src/types/schema.ts`.
3. Server: `uv run --project server ruff check server && uv run --project server ruff format --check server && uv run --project server pytest`.
4. Server codegen gate (in `server/`): `uv run datamodel-codegen --input schema.json --input-file-type jsonschema --output messages.py --output-model-type pydantic_v2.BaseModel --disable-timestamp && git diff --exit-code messages.py`.
5. Only if asked for `e2e` or the change touches the UI, socket hook, or protocol: `cd client && npm run e2e` (starts its own servers; on a remote container set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`, see `/run-3d-chess`).

If a codegen gate fails, the fix is to commit the regenerated file (`/regen-types`), not to revert the schema.
