#!/usr/bin/env bash
# Deploy TrekEasy onto the existing K3s + Traefik cluster.
#
# Applies the manifests already committed under k8s/ (this script creates no
# new resources of its own) in dependency order, then waits for each
# Deployment to become ready before moving on:
#
#   namespace -> config/secret -> Mongo (PVC+Deployment+Service)
#     -> backend (Deployment+Service+HPA) -> frontend (Deployment+Service)
#     -> the existing k3s Traefik Ingress (k8s/k3s/ingress-traefik.yaml)
#
# Does NOT apply k8s/ingress.yaml (the nginx-class Ingress for Minikube) —
# on K3s that IngressClass is never claimed by Traefik, so it would sit
# inert. Does NOT touch k8s/k3s/traefik-port.yaml either: that HelmChartConfig
# is one-time host-level Traefik setup (see k8s/k3s/README.md), not part of
# the application rollout.
#
# Usage:
#   ./scripts/deploy-k8s.sh
#
# Optional env:
#   ROLLOUT_TIMEOUT   passed to `kubectl rollout status --timeout` (default 180s)

set -euo pipefail

KUBECTL=(sudo k3s kubectl)
NAMESPACE="myapp"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-180s}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K8S_DIR="$REPO_ROOT/k8s"

kc() { "${KUBECTL[@]}" "$@"; }

require_manifest() {
  if [ ! -f "$1" ]; then
    echo "error: expected manifest not found: $1" >&2
    exit 1
  fi
}

apply() {
  local manifest="$1"
  require_manifest "$manifest"
  echo "==> Applying ${manifest#"$REPO_ROOT"/}"
  kc apply -f "$manifest"
}

wait_for_deployment() {
  local name="$1"
  echo "==> Waiting for deployment/$name to be ready (timeout ${ROLLOUT_TIMEOUT})"
  if ! kc rollout status "deployment/$name" -n "$NAMESPACE" --timeout="$ROLLOUT_TIMEOUT"; then
    echo "error: deployment/$name did not become ready in time." >&2
    echo "       Inspect it with: sudo k3s kubectl describe deployment/$name -n $NAMESPACE" >&2
    exit 1
  fi
}

echo "==> Step 1/6: Namespace"
apply "$K8S_DIR/namespace.yaml"

echo
echo "==> Step 2/6: Backend config/secret (required by the backend Deployment)"
apply "$K8S_DIR/app-config.yaml"
apply "$K8S_DIR/db-secret.yaml"

echo
echo "==> Step 3/6: Mongo (PVC + Deployment + Service)"
apply "$K8S_DIR/mongo-pvc.yaml"
apply "$K8S_DIR/mongo-deployment.yaml"
apply "$K8S_DIR/mongo-service.yaml"
wait_for_deployment "mongo"

echo
echo "==> Step 4/6: Backend (Deployment + Service + HPA)"
apply "$K8S_DIR/backend-deployment.yaml"
apply "$K8S_DIR/backend-service.yaml"
apply "$K8S_DIR/backend-hpa.yaml"
wait_for_deployment "backend"

echo
echo "==> Step 5/6: Frontend (Deployment + Service)"
apply "$K8S_DIR/frontend-deployment.yaml"
apply "$K8S_DIR/frontend-service.yaml"
wait_for_deployment "frontend"

echo
echo "==> Step 6/6: Existing Traefik Ingress"
apply "$K8S_DIR/k3s/ingress-traefik.yaml"

echo
echo "==> Deploy complete. Current state:"
kc get deployments,svc,hpa,ingress -n "$NAMESPACE"

echo
echo "==> Run ./scripts/verify-k8s.sh for a full health check."
