#!/usr/bin/env bash
# PostToolUse (Write|Edit) formatter: prettier for client/, ruff for server/.
# Skips generated files (CI byte-compares them against codegen output).
set -u
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0
case "$f" in
  */client/src/types/schema.ts|*/server/messages.py|*/node_modules/*|*/dist/*) exit 0 ;;
  "$root"/client/*.ts|"$root"/client/*.tsx|"$root"/client/*.js|"$root"/client/*.jsx|"$root"/client/*.css|"$root"/client/*.json)
    "$root/client/node_modules/.bin/prettier" --write --log-level warn "$f" ;;
  "$root"/server/*.py)
    cd "$root/server" && uv run -q ruff check --fix -q "$f" && uv run -q ruff format -q "$f" ;;
esac
