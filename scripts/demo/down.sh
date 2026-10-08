#!/usr/bin/env bash
# Stops the lab processes started by up.sh. Keeps .demo/ (use --purge to delete it).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for name in frontend backend; do
  pidfile="$ROOT/.demo/$name.pid"
  [[ -f "$pidfile" ]] || continue
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    echo "stopped $name"
  fi
  rm -f "$pidfile"
done
if [[ "${1:-}" == "--purge" ]]; then rm -rf "$ROOT/.demo"; echo "removed .demo/"; fi
