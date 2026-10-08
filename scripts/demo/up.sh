#!/usr/bin/env bash
# Starts the ContextVerity lab: Backstage backend (+ frontend unless
# CV_NO_FRONTEND=1), waits for readiness, resets the synthetic world.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
"$ROOT/scripts/demo/env.sh" >/dev/null
# shellcheck disable=SC1091
source "$ROOT/.demo/env"
YARN=(node "$ROOT/.yarn/releases/yarn-4.13.0.cjs")

start() { # name, workspace
  local pidfile="$ROOT/.demo/$1.pid"
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "$1 already running (pid $(cat "$pidfile"))"; return
  fi
  ( cd "$ROOT/packages/$2" && nohup "${YARN[@]}" start </dev/null >"$ROOT/.demo/$1.log" 2>&1 & echo $! >"$pidfile" )
  echo "started $1 (log: .demo/$1.log)"
}

wait_for() { # url, name, seconds
  for _ in $(seq 1 "$3"); do
    if curl -sf -o /dev/null "$1"; then echo "$2 ready"; return 0; fi
    sleep 2
  done
  echo "$2 did not become ready; see .demo logs" >&2; return 1
}

start backend backend
[[ "${CV_NO_FRONTEND:-0}" == "1" ]] || start frontend app
wait_for "$CV_BACKEND_URL/.backstage/health/v1/readiness" backend 120

TOKEN=$(curl -sf "$CV_BACKEND_URL/api/auth/guest/refresh" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).backstageIdentity.token))")
node -e "
const fs=require('fs');const y=require('yaml');
const {policies}=y.parse(fs.readFileSync('examples/lab/policies.yaml','utf8'));
fetch(process.argv[1]+'/api/lab/policies',{method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer '+process.argv[2]},body:JSON.stringify({policies})}).then(r=>{if(!r.ok)process.exit(1)});
" "$CV_BACKEND_URL" "$TOKEN"
curl -sf -X POST -H "Authorization: Bearer $TOKEN" "$CV_BACKEND_URL/api/lab/reset" >/dev/null
echo "lab world reset to seed state"

[[ "${CV_NO_FRONTEND:-0}" == "1" ]] || wait_for http://127.0.0.1:3000 frontend 180
cat <<MSG

ContextVerity lab is up (synthetic data, local only):
  Backstage UI        http://127.0.0.1:3000   (sign in as guest -> user:default/alex)
  Receipts page       http://127.0.0.1:3000/contextverity
  Backend API         $CV_BACKEND_URL/api/contextverity/v1
  MCP Actions         $CV_BACKEND_URL/api/mcp-actions/v1
  Metrics             http://127.0.0.1:9464/metrics
  Traces (JSONL)      .demo/traces.jsonl
Next: make demo-run
MSG
