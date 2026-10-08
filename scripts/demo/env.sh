#!/usr/bin/env bash
# Creates .demo/ with generated, local-only secrets and mutable lab state.
# Usage: scripts/demo/env.sh [--reset]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO="$ROOT/.demo"
if [[ "${1:-}" == "--reset" ]]; then rm -rf "$DEMO"; fi
mkdir -p "$DEMO/data"
if [[ ! -f "$DEMO/env" ]]; then
  rand() { node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))"; }
  umask 077
  cat > "$DEMO/env" <<ENV
export CV_DATA_DIR="$DEMO/data"
export CV_POLICY_FILE="$DEMO/policies.yaml"
export CV_AGENT_TOKEN="$(rand)"
export CV_OTHER_AGENT_TOKEN="$(rand)"
export CV_INTEGRITY_SECRET="$(rand)"
export CV_BACKEND_URL="http://127.0.0.1:7007"
export CV_TRACE_FILE="$DEMO/traces.jsonl"
export NODE_ENV=development
ENV
fi
[[ -f "$DEMO/policies.yaml" ]] || cp "$ROOT/examples/lab/policies.yaml" "$DEMO/policies.yaml"
echo "$DEMO/env"
