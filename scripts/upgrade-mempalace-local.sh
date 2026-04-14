#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: scripts/upgrade-mempalace-local.sh <version>" >&2
  echo "Example: scripts/upgrade-mempalace-local.sh 3.1.0" >&2
  exit 1
fi

PYTHON_BIN="${MEMPALACE_PYTHON_BIN:-/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12}"
PALACE_PATH="${MEMPALACE_PALACE_PATH:-$HOME/.mempalace-data}"
VENV_ROOT="${MEMPALACE_VENV_ROOT:-$HOME/.mempalace-venvs}"
TARGET_VENV="$VENV_ROOT/$VERSION"
CURRENT_LINK="$VENV_ROOT/current"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python runtime not found: $PYTHON_BIN" >&2
  exit 1
fi

mkdir -p "$VENV_ROOT"

echo "[mempalace-upgrade] creating venv: $TARGET_VENV"
rm -rf "$TARGET_VENV"
"$PYTHON_BIN" -m venv "$TARGET_VENV"

echo "[mempalace-upgrade] installing mempalace==$VERSION"
"$TARGET_VENV/bin/python" -m pip install --upgrade pip setuptools wheel >/dev/null
"$TARGET_VENV/bin/python" -m pip install "mempalace==$VERSION"

echo "[mempalace-upgrade] smoke test: pip show"
MEMPALACE_PALACE_PATH="$PALACE_PATH" "$TARGET_VENV/bin/python" -m pip show mempalace >/dev/null

echo "[mempalace-upgrade] smoke test: CLI status"
MEMPALACE_PALACE_PATH="$PALACE_PATH" "$TARGET_VENV/bin/mempalace" status >/dev/null

echo "[mempalace-upgrade] smoke test: MCP tools/list"
TOOLS_JSON="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | MEMPALACE_PALACE_PATH="$PALACE_PATH" "$TARGET_VENV/bin/python" -m mempalace.mcp_server)"
if ! grep -q '"mempalace_search"' <<<"$TOOLS_JSON"; then
  echo "MCP tools/list did not include mempalace_search" >&2
  exit 1
fi

echo "[mempalace-upgrade] smoke test: programmatic search"
MEMPALACE_PALACE_PATH="$PALACE_PATH" "$TARGET_VENV/bin/python" - <<PY >/dev/null
from mempalace.searcher import search_memories
res = search_memories("__healthcheck__", palace_path="${PALACE_PATH}", n_results=1)
assert "error" not in res, res
PY

echo "[mempalace-upgrade] switching current symlink -> $TARGET_VENV"
ln -sfn "$TARGET_VENV" "$CURRENT_LINK"

echo "[mempalace-upgrade] done"
echo "current -> $(readlink "$CURRENT_LINK")"
