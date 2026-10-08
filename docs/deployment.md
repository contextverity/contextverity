# Deployment

ContextVerity runs inside your Backstage backend; there is no separate service to
deploy.

1. Add the backend and frontend plugins ([backstage-integration.md](backstage-integration.md)).
2. Configure `contextverity.issuer`, `integritySecret` and policies.
3. Use the Backstage database service as usual. ContextVerity creates two tables in
   its own plugin database through migrations (SQLite in development, PostgreSQL in
   production). Set `backend.database.plugin.contextverity` to override.
4. Optionally load an OpenTelemetry SDK with `node --require ./instrumentation.js`
   ([telemetry.md](telemetry.md)).

## Consistency

- Receipts are inserted once and never updated; verifications are appended.
- A verification reads the receipt, the catalog and the permission backend at
  slightly different instants; it is not a transaction across them.
- Several backend replicas can serve ContextVerity concurrently: receipts are read
  from the shared database, and the retention task is coordinated by the Backstage
  scheduler.

## Kubernetes (lab)

`deploy/helm/contextverity-lab` deploys the lab — the demo Backstage backend with the
ContextVerity plugins, the bundled frontend, synthetic data and the demo-only lab API —
to Kubernetes. It is validated end to end on a single-node kind cluster running on
**Podman**; the image is built with **Podman** from `deploy/container/Containerfile`.

```sh
make k8s-up      # host build, podman build, kind (Podman provider), helm install, helm test
make k8s-test    # the scenarios against the cluster (writes test-results/scenarios-kubernetes.json)
make k8s-down    # delete the kind cluster
```

Requirements: Podman (rootful machine on macOS), kind ≥ 0.32, Helm ≥ 3.8, and kubectl
within one minor version of the cluster (kind 0.32 runs Kubernetes 1.36).

What the chart does:

| Concern      | Choice                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity     | Dedicated ServiceAccount, `automountServiceAccountToken: false`; no Role or ClusterRole (ContextVerity never calls the Kubernetes API)                                                                                                                 |
| Pod security | `runAsNonRoot`, uid/gid 1000, `readOnlyRootFilesystem`, all capabilities dropped, no privilege escalation, `RuntimeDefault` seccomp                                                                                                                    |
| Health       | startup, liveness and readiness probes on `/.backstage/health/v1/*`                                                                                                                                                                                    |
| Resources    | requests 250m / 512Mi, limits 1 CPU / 1Gi (values)                                                                                                                                                                                                     |
| Storage      | SQLite on a ReadWriteOnce PersistentVolumeClaim; one replica, `Recreate` strategy                                                                                                                                                                      |
| Network      | NetworkPolicy: ingress to the HTTP and metrics ports **only from pods in the release namespace** (plus `networkPolicy.extraIngressFrom`), egress to DNS only; the backend calls its own plugins over loopback and `kubectl port-forward` is unaffected |
| Secrets      | Agent tokens and the integrity secret generated once into a Secret (kept across upgrades), or supplied via `existingSecret`                                                                                                                            |
| Supply chain | Node 22 base image pinned by digest; build context is an allowlist (`.containerignore`)                                                                                                                                                                |
| Test         | `helm test` checks readiness from inside the cluster                                                                                                                                                                                                   |

Verified in the lab (`scripts/k8s/check-network.sh`, `test-results/kubernetes-network.json`):
`helm test` passes; a pod in another namespace cannot reach the lab while a pod in the
release namespace can; the backend pod cannot open outbound connections while DNS
resolves (the NetworkPolicy is enforced by kind's CNI); and the
scenario suite passes against the cluster, including **S29** (the pod is deleted and the
receipt survives on the volume) and **S30** (a row edited inside the pod verifies as
`DENY`). See [results.md](results.md).

This chart is for evaluation. It enables guest sign-in outside development and the lab
control API. A production deployment adds ContextVerity to your own Backstage image and
chart, uses PostgreSQL, and keeps the lab out.

## Local lab

`make demo-up` runs a development-mode Backstage on `127.0.0.1` with SQLite files in
`.demo/data`, guest sign-in, two static agent tokens (generated into `.demo/env`), the
MCP Actions backend, the demo-only lab and OpenTelemetry. `make demo-down` stops it;
`make clean` also removes `.demo/`. Never expose the lab beyond localhost.
