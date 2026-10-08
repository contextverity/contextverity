#!/usr/bin/env bash
# Verifies the chart's NetworkPolicy in the running cluster and writes
# test-results/kubernetes-network.json:
#   - a pod in another namespace cannot reach the lab (ingress isolation)
#   - a pod in the release namespace can
#   - the backend pod cannot open outbound connections (egress), but DNS works
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONTEXT="kind-${CV_KIND_CLUSTER:-contextverity}"
NS="${CV_KUBE_NAMESPACE:-contextverity}"
RELEASE="${CV_HELM_RELEASE:-lab}"
SVC="${RELEASE}-contextverity-lab"
IMAGE="localhost/contextverity-lab:0.1.0"
k() { kubectl --context "$CONTEXT" "$@"; }
URL="http://${SVC}.${NS}.svc.cluster.local:7007/.backstage/health/v1/readiness"
OV=$(node -e '
const [image, url] = process.argv.slice(1);
const sc = { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } };
const cmd = `fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(6000)}).then(r=>console.log("REACHED",r.status)).catch(e=>console.log("BLOCKED",e.name))`;
console.log(JSON.stringify({ spec: { securityContext: { runAsNonRoot: true, runAsUser: 1000, seccompProfile: { type: "RuntimeDefault" } },
  containers: [{ name: "p", image, imagePullPolicy: "Never", command: ["node", "-e", cmd], securityContext: sc }] } }));
' "$IMAGE" "$URL")
probe() { k -n "$1" run "np-probe-$RANDOM" --rm -i --restart=Never --quiet --image="$IMAGE" --image-pull-policy=Never --overrides="$OV" </dev/null 2>&1 | grep -oE "REACHED [0-9]+|BLOCKED" | head -1; }
k create namespace cv-np-other --dry-run=client -o yaml | k apply -f - >/dev/null
other="$(probe cv-np-other)"
same="$(probe "$NS")"
k delete namespace cv-np-other --wait=false >/dev/null
egress="$(k -n "$NS" exec "deployment/$SVC" -c backend -- node -e "fetch('https://example.com',{signal:AbortSignal.timeout(5000)}).then(r=>console.log('REACHED',r.status)).catch(()=>console.log('BLOCKED'))" </dev/null 2>&1 | tail -1)"
dns="$(k -n "$NS" exec "deployment/$SVC" -c backend -- node -e "require('dns').promises.lookup('kubernetes.default.svc.cluster.local').then(()=>console.log('RESOLVED')).catch(()=>console.log('FAILED'))" </dev/null 2>&1 | tail -1)"
node - "$ROOT" "$other" "$same" "$egress" "$dns" <<'NODE'
const [root, other, same, egress, dns] = process.argv.slice(2);
const { execSync } = require('node:child_process');
const commit = (() => { try { return execSync('git rev-parse HEAD', { cwd: root }).toString().trim(); } catch { return 'uncommitted'; } })();
const checks = [
  { name: 'ingress from another namespace is blocked', observed: other, pass: other === 'BLOCKED' },
  { name: 'ingress from the release namespace is allowed', observed: same, pass: /^REACHED 200$/.test(same) },
  { name: 'egress from the backend to the internet is blocked', observed: egress, pass: egress === 'BLOCKED' },
  { name: 'DNS from the backend resolves', observed: dns, pass: dns === 'RESOLVED' },
];
const report = { schemaVersion: 1, kind: 'contextverity.kubernetes-network', generatedAt: new Date().toISOString(), commit, checks, pass: checks.every(c => c.pass) };
require('node:fs').writeFileSync(`${root}/test-results/kubernetes-network.json`, JSON.stringify(report, null, 2) + '\n');
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name} (${c.observed})`);
process.exit(report.pass ? 0 : 1);
NODE
