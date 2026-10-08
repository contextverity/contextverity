#!/usr/bin/env bash
# Builds the lab image with Podman, creates a kind cluster on Podman (if
# needed), loads the image, installs the Helm chart and runs `helm test`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
CLUSTER="${CV_KIND_CLUSTER:-contextverity}"
CONTEXT="kind-${CLUSTER}"
NS="${CV_KUBE_NAMESPACE:-contextverity}"
RELEASE="${CV_HELM_RELEASE:-lab}"
IMAGE="localhost/contextverity-lab:0.1.0"
export KIND_EXPERIMENTAL_PROVIDER=podman
YARN=(node "$ROOT/.yarn/releases/yarn-4.13.0.cjs")

echo "==> building the backend bundle (host build)"
"${YARN[@]}" tsc
"${YARN[@]}" workspace backend build

echo "==> building ${IMAGE} with Podman"
podman build -f deploy/container/Containerfile -t "$IMAGE" .

# `kind get clusters` is incompatible with Podman 6's `ps` template output, so
# check for the control-plane container directly.
if ! podman container exists "${CLUSTER}-control-plane"; then
  echo "==> creating kind cluster ${CLUSTER} (Podman provider)"
  kind create cluster --name "$CLUSTER" --wait 180s
fi

echo "==> loading the image into the cluster"
archive="$(mktemp -d)/image.tar"
podman save --format oci-archive -o "$archive" "$IMAGE"
kind load image-archive "$archive" --name "$CLUSTER"
rm -rf "$(dirname "$archive")"

echo "==> installing the Helm chart"
kubectl --context "$CONTEXT" create namespace "$NS" --dry-run=client -o yaml | kubectl --context "$CONTEXT" apply -f - >/dev/null
helm --kube-context "$CONTEXT" -n "$NS" upgrade --install "$RELEASE" deploy/helm/contextverity-lab --wait --timeout 6m
# Pick up a rebuilt image with the same tag.
kubectl --context "$CONTEXT" -n "$NS" rollout restart "deployment/${RELEASE}-contextverity-lab" >/dev/null
kubectl --context "$CONTEXT" -n "$NS" rollout status "deployment/${RELEASE}-contextverity-lab" --timeout=300s
helm --kube-context "$CONTEXT" -n "$NS" test "$RELEASE"

cat <<MSG

ContextVerity lab on Kubernetes (synthetic data, demo only):
  kubectl --context ${CONTEXT} -n ${NS} port-forward svc/${RELEASE}-contextverity-lab 7017:7007
  then open http://127.0.0.1:7017 and http://127.0.0.1:7017/contextverity
Next: make k8s-test
MSG
