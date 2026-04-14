#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/3] memory-core dreaming reinforcement regression"
OPENCLAW_LOCAL_CHECK=0 pnpm test extensions/memory-core/src/dreaming-phases.test.ts

echo
echo "[2/3] memory-wiki doctor exit code regression"
OPENCLAW_LOCAL_CHECK=0 pnpm test extensions/memory-wiki/src/cli.test.ts

echo
echo "[3/3] doctor active-memory-slot regression"
OPENCLAW_LOCAL_CHECK=0 pnpm test src/commands/doctor-memory-search.test.ts

echo
echo "Memory regression suite OK"
