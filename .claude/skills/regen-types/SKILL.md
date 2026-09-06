---
name: regen-types
description: Regenerate the protocol types (server/messages.py and client/src/types/schema.ts) from server/schema.json. Use after any edit to schema.json; CI fails if either generated file is stale.
---

`server/schema.json` is the source of truth for the WebSocket protocol. Both generated files are committed and CI runs `git diff --exit-code` on them.

1. From `server/`:
   `uv run datamodel-codegen --input schema.json --input-file-type jsonschema --output messages.py --output-model-type pydantic_v2.BaseModel --disable-timestamp`
   (requires `uv sync --extra test` once; the codegen version is pinned in pyproject.toml so output is byte-stable — do not upgrade it casually).
2. From `client/`: `npm run generate:types`.
3. Run `git status -s` and show the diff of both generated files. Stage them together with the schema change.
4. If a message name changed, update the hand-written re-exports in `client/src/types/messages.ts` — app code imports from there, never from `schema.ts`. Then run `npm run build` in `client/` to catch broken imports.
