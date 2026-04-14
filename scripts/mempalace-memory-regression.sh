#!/usr/bin/env bash
set -euo pipefail

AGENT_ID="${1:-openclaw-optimizer}"
QUERY="${2:-FINAL-USER-VERIFY-20260411}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

need_cmd openclaw
need_cmd jq

extract_json() {
  awk 'BEGIN{capture=0} /^[[:space:]]*[\{\[]/{capture=1} capture{print}'
}

echo "[1/5] memory status"
status_json="$(openclaw memory status --agent "$AGENT_ID" --json)"
provider="$(printf '%s\n' "$status_json" | extract_json | jq -r '.status.provider')"
if [[ "$provider" != "mempalace" ]]; then
  echo "expected mempalace provider, got: $provider" >&2
  exit 1
fi

echo "[2/5] memory search"
search_json="$(openclaw memory search "$QUERY" --agent "$AGENT_ID" --json)"
result_count="$(printf '%s\n' "$search_json" | extract_json | jq '.results | length')"
if [[ "$result_count" -lt 1 ]]; then
  echo "expected at least one search result for query: $QUERY" >&2
  exit 1
fi
first_path="$(printf '%s\n' "$search_json" | extract_json | jq -r '.results[0].path')"

echo "[3/5] memory get"
get_text="$(openclaw memory get "$first_path" --agent "$AGENT_ID")"
if [[ -z "${get_text//[$'\n\r\t ']}" ]]; then
  echo "memory_get returned empty text for: $first_path" >&2
  exit 1
fi

echo "[4/5] memory dream run"
dream_run_json="$(openclaw memory dream run --agent "$AGENT_ID" --json)"
verified_drawer="$(printf '%s\n' "$dream_run_json" | extract_json | jq -r '.verified.drawer')"
verified_kg="$(printf '%s\n' "$dream_run_json" | extract_json | jq -r '.verified.kgFacts')"
if [[ "$verified_drawer" != "true" ]]; then
  echo "expected verified.drawer=true" >&2
  exit 1
fi
if [[ "$verified_kg" -lt 0 ]]; then
  echo "expected verified.kgFacts >= 0" >&2
  exit 1
fi

echo "[5/5] memory dream status"
dream_status="$(openclaw memory dream status --agent "$AGENT_ID")"
if [[ "$dream_status" != *"Last run:"* ]]; then
  echo "dream status did not include last run summary" >&2
  exit 1
fi

echo
echo "MemPalace regression OK"
echo "agent: $AGENT_ID"
echo "query: $QUERY"
echo "first path: $first_path"
echo "verified drawer: $verified_drawer"
echo "verified kg facts: $verified_kg"
